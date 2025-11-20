import json
import os

from celery import shared_task
from sqlalchemy import text
from sqlalchemy import text as _text

from .db import engine
from .services import get_ocr
from .storage import make_object_key, read_head, upload_bytes
from .ws import broadcast as ws_broadcast

BUCKET = os.getenv("MINIO_BUCKET", "athena")


def _quick_confidence(key: str) -> tuple[bool, float]:
    try:
        head = None
        if isinstance(key, str) and key.startswith("http"):
            import urllib.request

            with urllib.request.urlopen(key) as resp:
                head = resp.read(65536)
        else:
            head = read_head(BUCKET, key, 65536)
        if not head:
            return (False, 0.0)
        txt = None
        for enc in ("utf-8", "gb18030", "latin1"):
            try:
                txt = head.decode(enc, errors="ignore")
                break
            except Exception:
                continue
        if not txt:
            return (False, 0.0)
        import re

        cjk = len(re.findall(r"[\u4e00-\u9fff]", txt))
        latin = len(re.findall(r"[A-Za-z]", txt))
        total = max(1, len(txt))
        ratio = (cjk + latin) / total
        is_image_based = ratio < 0.02
        conf = max(0.0, min(1.0, ratio * 5.0))
        return (is_image_based, conf)
    except Exception:
        return (False, 0.0)


@shared_task(name="tasks.analyze_book_type")
def analyze_book_type(book_id: str, user_id: str):
    import asyncio

    async def _run():
        async with engine.begin() as conn:
            await conn.execute(
                text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
            )
            res = await conn.execute(
                text("SELECT minio_key FROM books WHERE id = cast(:id as uuid)"),
                {"id": book_id},
            )
            row = res.fetchone()
            if not row:
                return
            key = row[0]
            img, conf = _quick_confidence(key)
            await conn.execute(
                text(
                    "UPDATE books SET initial_digitalization_confidence = :c, updated_at = now() WHERE id = cast(:id as uuid)"
                ),
                {"c": conf, "id": book_id},
            )
        try:
            import json as _j

            asyncio.create_task(
                ws_broadcast(
                    f"book:{book_id}",
                    _j.dumps({"event": "ANALYZED", "confidence": conf}),
                )
            )
        except Exception:
            pass
        try:
            async with engine.begin() as conn2:
                await conn2.execute(
                    _text(
                        "INSERT INTO audit_logs(id, owner_id, action, details) VALUES (gen_random_uuid(), cast(:uid as uuid), :act, cast(:det as jsonb))"
                    ),
                    {
                        "uid": user_id,
                        "act": "task_analyze_book_type",
                        "det": _j.dumps({"book_id": book_id, "confidence": conf}),
                    },
                )
        except Exception:
            pass

    asyncio.get_event_loop().run_until_complete(_run())


@shared_task(name="tasks.deep_analyze_book")
def deep_analyze_book(book_id: str, user_id: str):
    import asyncio

    async def _run():
        async with engine.begin() as conn:
            await conn.execute(
                text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
            )
            res = await conn.execute(
                text("SELECT minio_key FROM books WHERE id = cast(:id as uuid)"),
                {"id": book_id},
            )
            row = res.fetchone()
            if not row:
                return
            key = row[0]
            img, conf = _quick_confidence(key)
            ocr = get_ocr()
            ocr_res = ocr.recognize(BUCKET, key)
            rep_key = make_object_key(user_id, f"digitalize-report-{book_id}.json")
            upload_bytes(
                BUCKET,
                rep_key,
                json.dumps(
                    {"is_image_based": img, "confidence": conf, "ocr": ocr_res}
                ).encode("utf-8"),
                "application/json",
            )
            await conn.execute(
                text(
                    "UPDATE books SET is_digitalized = :dig, digitalize_report_key = :rk, updated_at = now() WHERE id = cast(:id as uuid)"
                ),
                {"dig": (not img and conf >= 0.8), "rk": rep_key, "id": book_id},
            )
        try:
            import json as _j

            asyncio.create_task(
                ws_broadcast(
                    f"book:{book_id}",
                    _j.dumps(
                        {
                            "event": "DEEP_ANALYZED",
                            "digitalized": (not img and conf >= 0.8),
                            "confidence": conf,
                        }
                    ),
                )
            )
        except Exception:
            pass
        try:
            async with engine.begin() as conn2:
                await conn2.execute(
                    _text(
                        "INSERT INTO audit_logs(id, owner_id, action, details) VALUES (gen_random_uuid(), cast(:uid as uuid), :act, cast(:det as jsonb))"
                    ),
                    {
                        "uid": user_id,
                        "act": "task_deep_analyze_book",
                        "det": json.dumps(
                            {
                                "book_id": book_id,
                                "digitalized": (not img and conf >= 0.8),
                                "confidence": conf,
                            }
                        ),
                    },
                )
        except Exception:
            pass

    asyncio.get_event_loop().run_until_complete(_run())


@shared_task(name="tasks.generate_srs_card")
def generate_srs_card(highlight_id: str):
    import asyncio

    async def _run():
        async with engine.begin() as conn:
            res = await conn.execute(
                text(
                    "SELECT user_id::text, comment FROM highlights WHERE id = cast(:id as uuid)"
                ),
                {"id": highlight_id},
            )
            row = res.fetchone()
            if not row:
                return
            user_id = row[0]
            comment = row[1] or ""
            if len(comment) <= 20:
                return
            question = "这段高亮主要表达了什么？"
            answer = comment.strip()
            import uuid as _uuid

            card_id = str(_uuid.uuid4())
            await conn.execute(
                text(
                    "INSERT INTO srs_cards(id, owner_id, highlight_id, question, answer) VALUES (cast(:id as uuid), cast(:uid as uuid), cast(:hid as uuid), :q, :a) ON CONFLICT (highlight_id) DO NOTHING"
                ),
                {
                    "id": card_id,
                    "uid": user_id,
                    "hid": highlight_id,
                    "q": question,
                    "a": answer,
                },
            )
            try:
                import json as _j

                asyncio.create_task(
                    ws_broadcast(
                        f"highlight:{highlight_id}",
                        _j.dumps({"event": "SRS_CARD_CREATED", "card_id": card_id}),
                    )
                )
            except Exception:
                pass

    asyncio.get_event_loop().run_until_complete(_run())
