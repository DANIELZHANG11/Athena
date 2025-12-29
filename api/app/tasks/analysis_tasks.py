"""
分析与 SRS 卡片任务模块

包含深度分析和 SRS 卡片生成的 Celery 任务
"""
import asyncio
import json
import tempfile
import os

from celery import shared_task
from sqlalchemy import text

from ..db import engine
from ..storage import (
    upload_bytes,
    read_full,
    make_object_key,
    BUCKET,
)
from ..realtime import ws_broadcast
from ..services.ocr import get_ocr
from .common import _quick_confidence
from .ocr_tasks import _pdf_to_images


@shared_task(name="tasks.deep_analyze_book")
def deep_analyze_book(book_id: str, user_id: str):
    """
    对书籍进行深度分析：类型检测 + OCR
    
    用于手动触发的完整分析，生成详细报告
    """
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
            ocr_res = {"regions": [], "text": ""}
            
            # 判断文件类型
            is_pdf = key.lower().endswith('.pdf')
            
            # 图片尺寸变量
            ocr_image_width = 0
            ocr_image_height = 0
            
            if is_pdf:
                # PDF 文件：先转换为图片再 OCR（处理所有页面）
                print(f"[OCR] Processing PDF: {key}")
                pdf_data = read_full(BUCKET, key)
                if pdf_data:
                    page_images, ocr_image_width, ocr_image_height = _pdf_to_images(pdf_data, max_pages=0, dpi=150)
                    all_text = []
                    all_regions = []
                    total_pages = page_images[0][2] if page_images else 0
                    
                    for page_num, img_bytes, _ in page_images:
                        fd, temp_path = tempfile.mkstemp(suffix='.png')
                        try:
                            os.write(fd, img_bytes)
                            os.close(fd)
                            
                            page_result = ocr.recognize("", temp_path)
                            if page_result.get("text"):
                                all_text.append(f"--- Page {page_num} ---")
                                all_text.append(page_result["text"])
                                for r in page_result.get("regions", []):
                                    r["page"] = page_num
                                    all_regions.append(r)
                            print(f"[OCR] Page {page_num}/{total_pages}: {len(page_result.get('text', ''))} chars, {len(page_result.get('regions', []))} regions")
                        except Exception as e:
                            print(f"[OCR] Page {page_num}/{total_pages} failed: {e}")
                        finally:
                            try:
                                os.remove(temp_path)
                            except Exception:
                                pass
                    
                    print(f"[OCR] Completed: {len(all_regions)} text regions, {len(''.join(all_text))} total chars")
                    ocr_res = {"regions": all_regions, "text": "\n".join(all_text)}
                    
                    # 触发搜索索引
                    try:
                        from ..search_sync import index_book_content
                        index_book_content(book_id, user_id, all_regions)
                        print(f"[OCR] Triggered search indexing for book {book_id}")
                    except Exception as e:
                        print(f"[OCR] Warning: Failed to index book content: {e}")
            else:
                # 图片文件：直接 OCR
                ocr_res = ocr.recognize(BUCKET, key)
            
            # 生成报告
            rep_key = make_object_key(user_id, f"digitalize-report-{book_id}.json")
            report_data = {
                "is_image_based": img, 
                "confidence": conf, 
                "ocr": ocr_res,
            }
            if ocr_image_width > 0 and ocr_image_height > 0:
                report_data["image_width"] = ocr_image_width
                report_data["image_height"] = ocr_image_height
            
            upload_bytes(
                BUCKET,
                rep_key,
                json.dumps(report_data).encode("utf-8"),
                "application/json",
            )
            
            await conn.execute(
                text(
                    "UPDATE books SET is_digitalized = :dig, digitalize_report_key = :rk, updated_at = now() WHERE id = cast(:id as uuid)"
                ),
                {"dig": (not img and conf >= 0.8), "rk": rep_key, "id": book_id},
            )
        
        # WebSocket 通知
        try:
            asyncio.create_task(
                ws_broadcast(
                    f"book:{book_id}",
                    json.dumps(
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
        
        # 审计日志
        try:
            async with engine.begin() as conn2:
                await conn2.execute(
                    text(
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
    """
    根据高亮内容自动生成 SRS 复习卡片
    """
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
            
            # 只有足够长的评论才生成卡片
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
            
            # WebSocket 通知
            try:
                asyncio.create_task(
                    ws_broadcast(
                        f"highlight:{highlight_id}",
                        json.dumps({"event": "SRS_CARD_CREATED", "card_id": card_id}),
                    )
                )
            except Exception:
                pass

    asyncio.get_event_loop().run_until_complete(_run())
