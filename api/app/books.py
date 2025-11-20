import os
import uuid

import redis
from fastapi import (
    APIRouter,
    Body,
    Depends,
    File,
    Header,
    HTTPException,
    Query,
    Response,
    UploadFile,
)
from sqlalchemy import text

from .auth import require_user
from .celery_app import celery_app
from .db import engine
from .search_sync import delete_book as delete_book_from_index, index_book
from .storage import (
    make_object_key,
    presigned_get,
    presigned_put,
    read_head,
    stat_etag,
    upload_bytes,
)
from .ws import broadcast as ws_broadcast

BOOKS_BUCKET = os.getenv("MINIO_BUCKET", "athena")
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)


router = APIRouter(prefix="/api/v1/books", tags=["books"])
shelves_router = APIRouter(prefix="/api/v1/shelves", tags=["shelves"])


async def _ensure_books_fields(conn):
    return


def _quick_confidence(bucket: str, key: str) -> tuple[bool, float]:
    try:
        head = None
        if isinstance(key, str) and key.startswith("http"):
            import urllib.request

            try:
                with urllib.request.urlopen(key) as resp:
                    head = resp.read(65536)
            except Exception:
                head = None
        else:
            head = read_head(bucket, key, 65536)
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


@router.post("/upload_init")
async def upload_init(body: dict = Body(...), auth=Depends(require_user)):
    user_id, _ = auth
    filename = body.get("filename")
    if not filename:
        raise HTTPException(status_code=400, detail="missing_filename")
    key = make_object_key(user_id, filename)
    url = presigned_put(BOOKS_BUCKET, key)
    return {"status": "success", "data": {"key": key, "upload_url": url}}


@router.post("/upload_complete")
async def upload_complete(
    body: dict = Body(...),
    idempotency_key: str | None = Header(None),
    auth=Depends(require_user),
):
    user_id, _ = auth
    key = body.get("key")
    if not key:
        raise HTTPException(status_code=400, detail="missing_key")
    title = body.get("title") or "Untitled"
    author = body.get("author") or ""
    language = body.get("language") or ""
    original_format = body.get("original_format") or ""
    size = body.get("size") or None
    if idempotency_key:
        idem_key = f"idem:books:upload_complete:{user_id}:{idempotency_key}"
        cached = r.get(idem_key)
        if cached:
            return {"status": "success", "data": eval(cached)}
    book_id = str(uuid.uuid4())
    # 计算ETag并进行去重
    etag = stat_etag(BOOKS_BUCKET, key)
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )

        if etag:
            res = await conn.execute(
                text(
                    "SELECT id::text FROM books WHERE user_id = current_setting('app.user_id')::uuid AND source_etag = :e"
                ),
                {"e": etag},
            )
            row = res.fetchone()
            if row:
                download_url = presigned_get(BOOKS_BUCKET, key)
                index_book(row[0], user_id, title, author)
                data = {"id": row[0], "download_url": download_url}
                if idempotency_key:
                    r.setex(idem_key, 24 * 3600, str(data))
                try:
                    celery_app.send_task(
                        "tasks.analyze_book_type", args=[row[0], user_id]
                    )
                    celery_app.send_task(
                        "tasks.deep_analyze_book", args=[row[0], user_id]
                    )
                except Exception:
                    pass
                return {"status": "success", "data": data}
        img_based, conf = _quick_confidence(BOOKS_BUCKET, key)
        await conn.execute(
            text(
                """
            INSERT INTO books(id, user_id, title, author, language, original_format, minio_key, size, is_digitalized, initial_digitalization_confidence, source_etag)
            VALUES (cast(:id as uuid), cast(:uid as uuid), :title, :author, :language, :fmt, :key, :size, :dig, :conf, :etag)
            """
            ),
            {
                "id": book_id,
                "uid": user_id,
                "title": title,
                "author": author,
                "language": language,
                "fmt": original_format,
                "key": key,
                "size": size,
                "dig": (conf >= 0.8),
                "conf": conf,
                "etag": etag,
            },
        )
    download_url = presigned_get(BOOKS_BUCKET, key)
    index_book(book_id, user_id, title, author)
    data = {"id": book_id, "download_url": download_url}
    if idempotency_key:
        r.setex(idem_key, 24 * 3600, str(data))
    try:
        celery_app.send_task("tasks.analyze_book_type", args=[book_id, user_id])
        celery_app.send_task("tasks.deep_analyze_book", args=[book_id, user_id])
    except Exception:
        pass
    return {"status": "success", "data": data}


async def _deep_analyze_and_standardize(book_id: str, user_id: str):
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await _ensure_books_fields(conn)
        res = await conn.execute(
            text(
                "SELECT minio_key, is_digitalized, original_format FROM books WHERE id = cast(:id as uuid)"
            ),
            {"id": book_id},
        )
        row = res.fetchone()
        if not row:
            return
        key = row[0]
        fmt = (row[2] or "").lower()
        img_based, conf = _quick_confidence(BOOKS_BUCKET, key)
        rep_key = make_object_key(user_id, f"digitalize-report-{book_id}.json")
        import json

        upload_bytes(
            BOOKS_BUCKET,
            rep_key,
            json.dumps({"is_image_based": img_based, "confidence": conf}).encode(
                "utf-8"
            ),
            "application/json",
        )
        await conn.execute(
            text(
                "UPDATE books SET is_digitalized = :dig, initial_digitalization_confidence = :conf, digitalize_report_key = :rk, updated_at = now() WHERE id = cast(:id as uuid)"
            ),
            {
                "dig": (not img_based and conf >= 0.8),
                "conf": conf,
                "rk": rep_key,
                "id": book_id,
            },
        )
    try:
        await ws_broadcast(
            f"book:{book_id}",
            json.dumps(
                {
                    "event": "DEEP_ANALYZED",
                    "digitalized": (not img_based and conf >= 0.8),
                    "confidence": conf,
                }
            ),
        )
    except Exception:
        pass
    if fmt != "pdf":
        std_key = make_object_key(user_id, f"converted/{book_id}.epub")
        upload_bytes(
            BOOKS_BUCKET, std_key, b"standardized-epub", "application/epub+zip"
        )
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "UPDATE books SET converted_epub_key = :k, updated_at = now() WHERE id = cast(:id as uuid)"
                ),
                {"k": std_key, "id": book_id},
            )
        try:
            await ws_broadcast(
                f"book:{book_id}",
                json.dumps({"event": "STANDARDIZED", "epub_key": std_key}),
            )
        except Exception:
            pass


@router.get("/{book_id}/processing/status")
async def processing_status(book_id: str, auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                "SELECT status FROM conversion_jobs WHERE owner_id = current_setting('app.user_id')::uuid AND book_id = cast(:bid as uuid) ORDER BY created_at DESC LIMIT 1"
            ),
            {"bid": book_id},
        )
        row = res.fetchone()
        if not row:
            return {"status": "success", "data": {"status": "ACTIVE"}}
        st = row[0]
        mapped = (
            "ACTIVE"
            if st in ("succeeded", "active")
            else ("FAILED" if st == "failed" else "PENDING")
        )
        return {"status": "success", "data": {"status": mapped}}


@router.get("/{book_id}/convert/output")
async def presign_convert_output(book_id: str, auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                "SELECT output_key FROM conversion_jobs WHERE owner_id = current_setting('app.user_id')::uuid AND book_id = cast(:bid as uuid) AND status = 'completed' ORDER BY updated_at DESC LIMIT 1"
            ),
            {"bid": book_id},
        )
        row = res.fetchone()
        if not row or not row[0]:
            raise HTTPException(status_code=404, detail="not_found")
        return {
            "status": "success",
            "data": {"download_url": presigned_get(BOOKS_BUCKET, row[0])},
        }


@router.post("/{book_id}/presign_put_converted")
async def presign_put_converted(book_id: str, auth=Depends(require_user)):
    user_id, _ = auth
    key = make_object_key(user_id, f"converted/{book_id}.epub")
    url = presigned_put(BOOKS_BUCKET, key)
    return {"status": "success", "data": {"put_url": url, "key": key}}


@router.post("/{book_id}/presign_get_source")
async def presign_get_source(book_id: str, auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                "SELECT minio_key, original_format FROM books WHERE id = cast(:id as uuid) AND user_id = current_setting('app.user_id')::uuid"
            ),
            {"id": book_id},
        )
        row = res.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="not_found")
        key, fmt = row[0], (row[1] or "").lower()
        if isinstance(key, str) and key.startswith("http"):
            try:
                from urllib.parse import urlparse, urlunparse

                u = urlparse(key)
                if u.hostname in ("127.0.0.1", "localhost"):
                    # 重写为主机网关域名，容器可达
                    host = "host.docker.internal" + (f":{u.port}" if u.port else "")
                    key = urlunparse(
                        (u.scheme, host, u.path, u.params, u.query, u.fragment)
                    )
                else:
                    # 直接外链下载并写入MinIO，保障后续内部访问
                    import urllib.request

                    with urllib.request.urlopen(key) as resp:
                        data = resp.read()
                    ext = ("." + fmt) if fmt else ""
                    new_key = make_object_key(user_id, f"ingested-{book_id}{ext}")
                    upload_bytes(
                        BOOKS_BUCKET, new_key, data, "application/octet-stream"
                    )
                    await conn.execute(
                        text(
                            "UPDATE books SET minio_key = :k, updated_at = now() WHERE id = cast(:id as uuid)"
                        ),
                        {"k": new_key, "id": book_id},
                    )
                    key = new_key
            except Exception:
                raise HTTPException(status_code=400, detail="ingest_failed")
        if isinstance(key, str) and key.startswith("http"):
            from urllib.parse import urlparse

            u = urlparse(key)
            # 解析 bucket 与 object key 并返回内部 presign GET，保证可访问
            path = u.path.lstrip("/")
            parts = path.split("/", 1)
            if len(parts) == 2:
                bkt, obj = parts[0], parts[1]
                url = presigned_get(bkt, obj)
                return {"status": "success", "data": {"get_url": url}}
            return {"status": "success", "data": {"get_url": key}}
        url = presigned_get(BOOKS_BUCKET, key)
    return {"status": "success", "data": {"get_url": url}}


@router.post("/{book_id}/set_converted")
async def set_converted(
    book_id: str, body: dict = Body(...), auth=Depends(require_user)
):
    user_id, _ = auth
    key = body.get("key")
    if not key:
        raise HTTPException(status_code=400, detail="missing_key")
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await _ensure_books_fields(conn)
        await conn.execute(
            text(
                "UPDATE books SET converted_epub_key = :k, updated_at = now() WHERE id = cast(:id as uuid) AND user_id = current_setting('app.user_id')::uuid"
            ),
            {"k": key, "id": book_id},
        )
    try:
        import json as _j

        await ws_broadcast(
            f"book:{book_id}", _j.dumps({"event": "STANDARDIZED", "epub_key": key})
        )
    except Exception:
        pass
    return {"status": "success"}


@router.get("")
async def list_books(
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = Query(None),
    auth=Depends(require_user),
):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await _ensure_books_fields(conn)
        cond = "WHERE user_id = current_setting('app.user_id')::uuid"
        order = "ORDER BY updated_at DESC, id DESC"
        params = {"limit": limit + 1}
        if cursor:
            try:
                ts_str, last_id = cursor.split("|", 1)
                cond += " AND (updated_at < cast(:ts as timestamptz) OR (updated_at = cast(:ts as timestamptz) AND id < cast(:id as uuid)))"
                params.update({"ts": ts_str, "id": last_id})
            except Exception:
                pass
        q = text(
            """
            SELECT id::text, title, author, language, original_format, minio_key, size, created_at, updated_at, version, COALESCE(is_digitalized,false), COALESCE(initial_digitalization_confidence,0)
            FROM books
            """
            + cond
            + "\n"
            + order
            + "\n"
            + "LIMIT :limit"
        )
        res = await conn.execute(q, params)
        rows = res.fetchall()
        take = rows[:limit]
        items = []

        def _hint(key: str, lang: str, size: int | None):
            try:
                head = read_head(BOOKS_BUCKET, key, 65536)
                if not head:
                    return None
                txt = None
                for enc in ("utf-8", "gb18030", "latin1"):
                    try:
                        txt = head.decode(enc, errors="ignore")
                        break
                    except Exception:
                        continue
                if not txt:
                    return None
                import re

                cjk = len(re.findall(r"[\u4e00-\u9fff]", txt))
                latin_words = len(re.findall(r"[A-Za-z]+", txt))
                if lang and lang.lower().startswith("zh"):
                    ratio = cjk / max(1, len(txt))
                    bpc = 2.0
                    est = int((ratio) * (size or 0) / bpc) if size else cjk
                    return f"约{est/10000.0:.1f}万字"
                else:
                    # 近似估算词数
                    return f"约{latin_words}词"
            except Exception:
                return None

        for r in take:
            download = r[5]
            if not (isinstance(download, str) and download.startswith("http")):
                download = presigned_get(BOOKS_BUCKET, r[5])
            hint = _hint(r[5], r[3] or "", r[6])
            items.append(
                {
                    "id": r[0],
                    "title": r[1],
                    "author": r[2],
                    "language": r[3],
                    "original_format": r[4],
                    "size": r[6],
                    "created_at": str(r[7]),
                    "updated_at": str(r[8]),
                    "etag": f'W/"{int(r[9])}"',
                    "download_url": download,
                    "text_hint": hint,
                    "is_digitalized": bool(r[10]),
                    "initial_digitalization_confidence": float(r[11]),
                }
            )
        next_cursor = None
        if len(rows) > limit:
            last = take[-1]
            next_cursor = f"{last[8]}|{last[0]}"
        return {
            "status": "success",
            "data": {
                "items": items,
                "next_cursor": next_cursor,
                "has_more": len(rows) > limit,
            },
        }


@router.get("/{book_id}")
async def get_book(book_id: str, auth=Depends(require_user), response: Response = None):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await _ensure_books_fields(conn)
        res = await conn.execute(
            text(
                """
            SELECT id::text, title, author, language, original_format, minio_key, size, created_at, updated_at, version,
                   COALESCE(is_digitalized,false), COALESCE(initial_digitalization_confidence,0), converted_epub_key, digitalize_report_key
            FROM books WHERE id = cast(:id as uuid)
            """
            ),
            {"id": book_id},
        )
        row = res.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="not_found")
        if response is not None:
            response.headers["ETag"] = f'W/"{int(row[9])}"'
        download = row[5]
        if not (isinstance(download, str) and download.startswith("http")):
            download = presigned_get(BOOKS_BUCKET, row[5])
        hint = None
        try:
            head = read_head(BOOKS_BUCKET, row[5], 65536)
            if head:
                for enc in ("utf-8", "gb18030", "latin1"):
                    try:
                        txt = head.decode(enc, errors="ignore")
                        break
                    except Exception:
                        txt = None
                if txt:
                    import re

                    cjk = len(re.findall(r"[\u4e00-\u9fff]", txt))
                    latin_words = len(re.findall(r"[A-Za-z]+", txt))
                    if (row[3] or "").lower().startswith("zh"):
                        hint = f"约{cjk/10000.0:.1f}万字"
                    else:
                        hint = f"约{latin_words}词"
        except Exception:
            hint = None
        return {
            "status": "success",
            "data": {
                "id": row[0],
                "title": row[1],
                "author": row[2],
                "language": row[3],
                "original_format": row[4],
                "size": row[6],
                "created_at": str(row[7]),
                "updated_at": str(row[8]),
                "etag": f'W/"{int(row[9])}"',
                "download_url": download,
                "text_hint": hint,
                "is_digitalized": bool(row[10]),
                "initial_digitalization_confidence": float(row[11]),
                "converted_epub_key": row[12],
                "digitalize_report_key": row[13],
            },
        }


@router.post("/register")
async def register_book(body: dict = Body(...), auth=Depends(require_user)):
    user_id, _ = auth
    object_url = body.get("object_url")
    if not object_url or not isinstance(object_url, str):
        raise HTTPException(status_code=400, detail="invalid_object_url")
    title = body.get("title") or "Untitled"
    author = body.get("author") or ""
    language = body.get("language") or ""
    original_format = (body.get("original_format") or "").lower()
    size = body.get("size") or None
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await _ensure_books_fields(conn)
        res = await conn.execute(
            text(
                "SELECT id::text FROM books WHERE user_id = current_setting('app.user_id')::uuid AND minio_key = :key"
            ),
            {"key": object_url},
        )
        row = res.fetchone()
        if row:
            return {
                "status": "success",
                "data": {"id": row[0], "download_url": object_url},
            }
        book_id = str(uuid.uuid4())
        img_based, conf = _quick_confidence(BOOKS_BUCKET, object_url)
        await conn.execute(
            text(
                """
            INSERT INTO books(id, user_id, title, author, language, original_format, minio_key, size, is_digitalized, initial_digitalization_confidence)
            VALUES (cast(:id as uuid), cast(:uid as uuid), :title, :author, :language, :fmt, :key, :size, :dig, :conf)
            """
            ),
            {
                "id": book_id,
                "uid": user_id,
                "title": title,
                "author": author,
                "language": language,
                "fmt": original_format,
                "key": object_url,
                "size": size,
                "dig": (conf >= 0.8),
                "conf": conf,
            },
        )
    index_book(book_id, user_id, title, author)
    return {"status": "success", "data": {"id": book_id, "download_url": object_url}}


@router.post("/{book_id}/deep_analyze")
async def deep_analyze(book_id: str, auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await _ensure_books_fields(conn)
        res = await conn.execute(
            text(
                "SELECT minio_key FROM books WHERE id = cast(:id as uuid) AND user_id = current_setting('app.user_id')::uuid"
            ),
            {"id": book_id},
        )
        row = res.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="not_found")
        key = row[0]
        img_based, conf = _quick_confidence(BOOKS_BUCKET, key)
        report = {"is_image_based": img_based, "confidence": conf}
        rep_key = make_object_key(user_id, f"digitalize-report-{book_id}.json")
        import json

        upload_bytes(
            BOOKS_BUCKET,
            rep_key,
            json.dumps(report).encode("utf-8"),
            "application/json",
        )
        await conn.execute(
            text(
                "UPDATE books SET is_digitalized = :dig, initial_digitalization_confidence = :conf, digitalize_report_key = :rk, updated_at = now() WHERE id = cast(:id as uuid)"
            ),
            {
                "dig": (not img_based and conf >= 0.8),
                "conf": conf,
                "rk": rep_key,
                "id": book_id,
            },
        )
    return {
        "status": "success",
        "data": {"is_digitalized": (not img_based and conf >= 0.8), "confidence": conf},
    }


@router.delete("/{book_id}")
async def delete_book(book_id: str, auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await conn.execute(
            text("DELETE FROM shelf_items WHERE book_id = cast(:id as uuid)"),
            {"id": book_id},
        )
        res = await conn.execute(
            text("DELETE FROM books WHERE id = cast(:id as uuid)"), {"id": book_id}
        )
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail="not_found")
    delete_book_from_index(book_id)
    return {"status": "success"}


@router.patch("/{book_id}")
async def update_book(
    book_id: str,
    body: dict = Body(...),
    if_match: str | None = Header(None),
    auth=Depends(require_user),
):
    user_id, _ = auth
    if not if_match or not if_match.startswith('W/"'):
        raise HTTPException(status_code=428, detail="missing_if_match")
    try:
        current_version = int(if_match.split('"')[1])
    except Exception:
        raise HTTPException(status_code=400, detail="invalid_if_match")
    title = body.get("title")
    author = body.get("author")
    language = body.get("language")
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                """
            UPDATE books SET
              title = COALESCE(:title, title),
              author = COALESCE(:author, author),
              language = COALESCE(:language, language),
              version = version + 1,
              updated_at = now()
            WHERE id = cast(:id as uuid) AND version = :ver
            """
            ),
            {
                "title": title,
                "author": author,
                "language": language,
                "id": book_id,
                "ver": current_version,
            },
        )
        if res.rowcount == 0:
            raise HTTPException(status_code=409, detail="version_conflict")
    return {"status": "success"}


@router.get("/{book_id}/presign")
async def presign_book_download(book_id: str, auth=Depends(require_user)):
    user_id, _ = auth
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
            raise HTTPException(status_code=404, detail="not_found")
        return {
            "status": "success",
            "data": {"download_url": presigned_get(BOOKS_BUCKET, row[0])},
        }


@router.post("/{book_id}/convert")
async def request_convert(
    book_id: str, body: dict = Body(...), auth=Depends(require_user)
):
    user_id, _ = auth
    target_format = (body.get("target_format") or "epub").lower()
    job_id = str(uuid.uuid4())
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
            raise HTTPException(status_code=404, detail="not_found")
        source_key = row[0]
        await conn.execute(
            text(
                """
            INSERT INTO conversion_jobs(id, owner_id, book_id, source_key, target_format, status)
            VALUES (cast(:id as uuid), cast(:uid as uuid), cast(:bid as uuid), :src, :fmt, 'pending')
            """
            ),
            {
                "id": job_id,
                "uid": user_id,
                "bid": book_id,
                "src": source_key,
                "fmt": target_format,
            },
        )
    return {"status": "success", "data": {"job_id": job_id, "status": "pending"}}


@router.get("/jobs/list")
async def list_jobs(status: str | None = Query(None), auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        if status:
            res = await conn.execute(
                text(
                    "SELECT id::text, book_id::text, target_format, status, created_at FROM conversion_jobs WHERE owner_id = current_setting('app.user_id')::uuid AND status = :st ORDER BY created_at DESC"
                ),
                {"st": status},
            )
        else:
            res = await conn.execute(
                text(
                    "SELECT id::text, book_id::text, target_format, status, created_at FROM conversion_jobs WHERE owner_id = current_setting('app.user_id')::uuid ORDER BY created_at DESC"
                )
            )
        rows = res.fetchall()
        return {
            "status": "success",
            "data": [
                {
                    "id": r[0],
                    "book_id": r[1],
                    "target_format": r[2],
                    "status": r[3],
                    "created_at": str(r[4]),
                }
                for r in rows
            ],
        }


@router.post("/jobs/{job_id}/complete")
async def complete_job(
    job_id: str, body: dict = Body(None), auth=Depends(require_user)
):
    user_id, _ = auth
    output_key = (body or {}).get("output_key") or ""
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await conn.execute(
            text(
                "UPDATE conversion_jobs SET status='completed', output_key = COALESCE(:out, output_key), updated_at = now() WHERE id = cast(:id as uuid) AND owner_id = current_setting('app.user_id')::uuid"
            ),
            {"id": job_id, "out": output_key},
        )
    return {"status": "success"}


@router.post("/jobs/{job_id}/fail")
async def fail_job(job_id: str, body: dict = Body(...), auth=Depends(require_user)):
    user_id, _ = auth
    message = body.get("error") or ""
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await conn.execute(
            text(
                "UPDATE conversion_jobs SET status='failed', error = :msg, updated_at = now() WHERE id = cast(:id as uuid) AND owner_id = current_setting('app.user_id')::uuid"
            ),
            {"id": job_id, "msg": message},
        )
    return {"status": "success"}


@router.post("/jobs/{job_id}/simulate")
async def simulate_job(job_id: str, auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                "SELECT book_id::text FROM conversion_jobs WHERE id = cast(:id as uuid) AND owner_id = current_setting('app.user_id')::uuid"
            ),
            {"id": job_id},
        )
        row = res.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="not_found")
        book_id = row[0]
        out_key = f"converted/{book_id}.epub"
        upload_bytes(
            BOOKS_BUCKET, out_key, b"converted content", "application/epub+zip"
        )
        res2 = await conn.execute(
            text(
                "SELECT price_amount, unit_size, currency FROM pricing_rules WHERE service_type = 'VECTORIZE' AND unit_type = 'CHARS' AND is_active = TRUE ORDER BY updated_at DESC LIMIT 1"
            )
        )
        rule = res2.fetchone()
        if rule:
            import math

            qty = 100000
            max(1, math.ceil(qty / int(rule[1])))
            sres = await conn.execute(
                text("SELECT key, value FROM system_settings WHERE key LIKE 'free_%'")
            )
            settings = {r[0]: r[1] for r in sres.fetchall()}
            mtres = await conn.execute(
                text(
                    "SELECT membership_tier FROM users WHERE id = current_setting('app.user_id')::uuid"
                )
            )
            mtrow = mtres.fetchone()
            tier = (mtrow and mtrow[0]) or "FREE"
            tres = await conn.execute(
                text("SELECT value FROM system_settings WHERE key = 'membership_tiers'")
            )
            trow = tres.fetchone()
            mconf = trow and trow[0]
            free_chars = None
            if isinstance(mconf, dict) and tier in mconf:
                try:
                    free_chars = int((mconf[tier] or {}).get("free_vector_chars") or 0)
                except Exception:
                    free_chars = 0
            if free_chars is None:
                free_chars = int(settings.get("free_vector_chars", 0))

            ures = await conn.execute(
                text(
                    "SELECT used_units FROM free_quota_usage WHERE owner_id = current_setting('app.user_id')::uuid AND service_type = 'VECTORIZE' AND period_start = current_date"
                )
            )
            urow = ures.fetchone()
            used = int(urow[0]) if urow else 0
            remain = max(0, free_chars - used)
            payable_chars = max(0, qty - remain)
            if remain > 0:
                await conn.execute(
                    text(
                        "INSERT INTO free_quota_usage(owner_id, service_type, used_units) VALUES (current_setting('app.user_id')::uuid, 'VECTORIZE', :u) ON CONFLICT (owner_id, service_type, period_start) DO UPDATE SET used_units = free_quota_usage.used_units + EXCLUDED.used_units"
                    ),
                    {"u": min(qty, remain)},
                )
            if payable_chars > 0:
                units_pay = max(1, math.ceil(payable_chars / int(rule[1])))
                amt = int(round(float(rule[0]) * 100)) * units_pay
                await conn.execute(
                    text(
                        "INSERT INTO credit_accounts(owner_id) VALUES (current_setting('app.user_id')::uuid) ON CONFLICT (owner_id) DO NOTHING"
                    )
                )
                bal = await conn.execute(
                    text(
                        "SELECT balance FROM credit_accounts WHERE owner_id = current_setting('app.user_id')::uuid"
                    )
                )
                b = bal.fetchone()
                if not b or int(b[0]) < amt:
                    await conn.execute(
                        text(
                            "UPDATE conversion_jobs SET status='failed', updated_at = now() WHERE id = cast(:id as uuid) AND owner_id = current_setting('app.user_id')::uuid"
                        ),
                        {"id": job_id},
                    )
                    raise HTTPException(status_code=400, detail="insufficient_balance")
                await conn.execute(
                    text(
                        "UPDATE credit_accounts SET balance = balance - :amt, updated_at = now() WHERE owner_id = current_setting('app.user_id')::uuid"
                    ),
                    {"amt": amt},
                )
                lid = str(uuid.uuid4())
                await conn.execute(
                    text(
                        "INSERT INTO credit_ledger(id, owner_id, amount, currency, reason, related_id, direction) VALUES (cast(:id as uuid), current_setting('app.user_id')::uuid, :amt, :cur, 'vectorize', cast(:rid as uuid), 'debit')"
                    ),
                    {"id": lid, "amt": amt, "cur": rule[2], "rid": job_id},
                )
        await conn.execute(
            text(
                "UPDATE conversion_jobs SET status='completed', output_key = :out, updated_at = now() WHERE id = cast(:id as uuid) AND owner_id = current_setting('app.user_id')::uuid"
            ),
            {"id": job_id, "out": out_key},
        )
    return {"status": "success", "data": {"output_key": out_key}}


@shelves_router.post("")
async def create_shelf(
    body: dict = Body(...),
    idempotency_key: str | None = Header(None),
    auth=Depends(require_user),
):
    user_id, _ = auth
    name = body.get("name")
    if not name:
        raise HTTPException(status_code=400, detail="missing_name")
    description = body.get("description") or ""
    if idempotency_key:
        idem_key = f"idem:shelves:create:{user_id}:{idempotency_key}"
        cached = r.get(idem_key)
        if cached:
            return {"status": "success", "data": {"id": cached}}
    shelf_id = str(uuid.uuid4())
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await conn.execute(
            text(
                "INSERT INTO shelves(id, user_id, name, description) VALUES (cast(:id as uuid), cast(:uid as uuid), :name, :desc)"
            ),
            {"id": shelf_id, "uid": user_id, "name": name, "desc": description},
        )
    if idempotency_key:
        r.setex(idem_key, 24 * 3600, shelf_id)
    return {"status": "success", "data": {"id": shelf_id}}


@shelves_router.get("")
async def list_shelves(
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = Query(None),
    auth=Depends(require_user),
):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        cond = "WHERE user_id = current_setting('app.user_id')::uuid"
        order = "ORDER BY updated_at DESC, id DESC"
        params = {"limit": limit + 1}
        if cursor:
            try:
                ts_str, last_id = cursor.split("|", 1)
                cond += " AND (updated_at < cast(:ts as timestamptz) OR (updated_at = cast(:ts as timestamptz) AND id < cast(:id as uuid)))"
                params.update({"ts": ts_str, "id": last_id})
            except Exception:
                pass
        q = text(
            """
            SELECT id::text, name, description, updated_at, version
            FROM shelves
            """
            + cond
            + "\n"
            + order
            + "\n"
            + "LIMIT :limit"
        )
        res = await conn.execute(q, params)
        rows = res.fetchall()
        take = rows[:limit]
        items = [
            {
                "id": r[0],
                "name": r[1],
                "description": r[2],
                "updated_at": str(r[3]),
                "etag": f'W/"{int(r[4])}"',
            }
            for r in take
        ]
        next_cursor = None
        if len(rows) > limit:
            last = take[-1]
            next_cursor = f"{last[3]}|{last[0]}"
        return {
            "status": "success",
            "data": {
                "items": items,
                "next_cursor": next_cursor,
                "has_more": len(rows) > limit,
            },
        }


@shelves_router.patch("/{shelf_id}")
async def update_shelf(
    shelf_id: str,
    body: dict = Body(...),
    if_match: str | None = Header(None),
    auth=Depends(require_user),
):
    user_id, _ = auth
    if not if_match or not if_match.startswith('W/"'):
        raise HTTPException(status_code=428, detail="missing_if_match")
    try:
        current_version = int(if_match.split('"')[1])
    except Exception:
        raise HTTPException(status_code=400, detail="invalid_if_match")
    name = body.get("name")
    description = body.get("description")
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                """
            UPDATE shelves SET
              name = COALESCE(:name, name),
              description = COALESCE(:desc, description),
              version = version + 1,
              updated_at = now()
            WHERE id = cast(:id as uuid) AND version = :ver
            """
            ),
            {"name": name, "desc": description, "id": shelf_id, "ver": current_version},
        )
        if res.rowcount == 0:
            raise HTTPException(status_code=409, detail="version_conflict")
    return {"status": "success"}


@shelves_router.post("/{shelf_id}/items")
async def add_item(
    shelf_id: str,
    body: dict = Body(...),
    idempotency_key: str | None = Header(None),
    auth=Depends(require_user),
):
    user_id, _ = auth
    book_id = body.get("book_id")
    if not book_id:
        raise HTTPException(status_code=400, detail="missing_book_id")
    if idempotency_key:
        idem_key = (
            f"idem:shelves:add_item:{user_id}:{shelf_id}:{book_id}:{idempotency_key}"
        )
        if r.get(idem_key):
            return {"status": "success"}
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await conn.execute(
            text(
                "INSERT INTO shelf_items(shelf_id, book_id) VALUES (cast(:sid as uuid), cast(:bid as uuid)) ON CONFLICT DO NOTHING"
            ),
            {"sid": shelf_id, "bid": book_id},
        )
    if idempotency_key:
        r.setex(idem_key, 24 * 3600, "1")
    return {"status": "success"}


@shelves_router.get("/{shelf_id}/items")
async def list_items(shelf_id: str, auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                """
            SELECT b.id::text, b.title, b.author, b.language, b.minio_key
            FROM shelf_items si
            JOIN books b ON b.id = si.book_id
            WHERE si.shelf_id = cast(:sid as uuid)
            ORDER BY b.updated_at DESC
            """
            ),
            {"sid": shelf_id},
        )
        rows = res.fetchall()
        return {
            "status": "success",
            "data": [
                {
                    "id": r[0],
                    "title": r[1],
                    "author": r[2],
                    "language": r[3],
                    "download_url": presigned_get(BOOKS_BUCKET, r[4]),
                }
                for r in rows
            ],
        }


@shelves_router.delete("/{shelf_id}/items/{book_id}")
async def remove_item(
    shelf_id: str,
    book_id: str,
    idempotency_key: str | None = Header(None),
    auth=Depends(require_user),
):
    user_id, _ = auth
    if idempotency_key:
        idem_key = (
            f"idem:shelves:remove_item:{user_id}:{shelf_id}:{book_id}:{idempotency_key}"
        )
        if r.get(idem_key):
            return {"status": "success"}
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await conn.execute(
            text(
                "DELETE FROM shelf_items WHERE shelf_id = cast(:sid as uuid) AND book_id = cast(:bid as uuid)"
            ),
            {"sid": shelf_id, "bid": book_id},
        )
    if idempotency_key:
        r.setex(idem_key, 24 * 3600, "1")
    return {"status": "success"}


@router.post("/upload_proxy")
async def upload_proxy(
    title: str | None = None, file: UploadFile = File(...), auth=Depends(require_user)
):
    user_id, _ = auth
    name = file.filename or "upload.bin"
    fmt = (name.split(".")[-1] or "bin").lower()
    key = make_object_key(user_id, name)
    content = await file.read()
    from .storage import upload_bytes

    upload_bytes(
        os.getenv("MINIO_BUCKET", "athena"),
        key,
        content,
        file.content_type or "application/octet-stream",
    )
    # 轻量置信度
    img_based, conf = _quick_confidence(os.getenv("MINIO_BUCKET", "athena"), key)
    etag = stat_etag(os.getenv("MINIO_BUCKET", "athena"), key)
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await _ensure_books_fields(conn)
        if etag:
            res = await conn.execute(
                text(
                    "SELECT id::text FROM books WHERE user_id = current_setting('app.user_id')::uuid AND source_etag = :e"
                ),
                {"e": etag},
            )
            row = res.fetchone()
            if row:
                download_url = presigned_get(os.getenv("MINIO_BUCKET", "athena"), key)
                return {
                    "status": "success",
                    "data": {"id": row[0], "download_url": download_url},
                }
        book_id = str(uuid.uuid4())
        await conn.execute(
            text(
                """
            INSERT INTO books(id, user_id, title, original_format, minio_key, is_digitalized, initial_digitalization_confidence, source_etag)
            VALUES (cast(:id as uuid), current_setting('app.user_id')::uuid, :t, :f, :k, :dig, :conf, :etag)
            """
            ),
            {
                "id": book_id,
                "t": title or name.replace(f".{fmt}", ""),
                "k": key,
                "f": fmt,
                "dig": (conf >= 0.8),
                "conf": conf,
                "etag": etag,
            },
        )
    download_url = presigned_get(os.getenv("MINIO_BUCKET", "athena"), key)
    return {"status": "success", "data": {"id": book_id, "download_url": download_url}}
