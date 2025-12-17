"""
封面提取任务模块

包含书籍封面提取相关的 Celery 任务
"""
import asyncio
import json

from celery import shared_task
from sqlalchemy import text

from ..db import engine
from ..storage import (
    get_s3,
    ensure_bucket,
    upload_bytes,
    make_object_key,
    BUCKET,
)
from ..realtime import ws_broadcast
from .common import (
    _optimize_cover_image,
    _extract_epub_cover,
    _extract_pdf_cover,
    _extract_epub_metadata,
    _extract_pdf_metadata,
)


@shared_task(name="tasks.extract_book_cover")
def extract_book_cover(book_id: str, user_id: str):
    """
    提取书籍封面并保存到存储
    仅支持 EPUB 和 PDF 格式，其他格式需先通过 Calibre 转换为 EPUB
    """
    async def _run():
        async with engine.begin() as conn:
            await conn.execute(
                text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
            )
            res = await conn.execute(
                text("SELECT minio_key, original_format, title, converted_epub_key FROM books WHERE id = cast(:id as uuid)"),
                {"id": book_id},
            )
            row = res.fetchone()
            if not row:
                print(f"[Cover] Book not found: {book_id}")
                return
            
            minio_key, original_format, title, converted_epub_key = row[0], row[1], row[2], row[3]
            fmt_lower = (original_format or '').lower()
            
            # 对于非 EPUB/PDF 格式，优先使用转换后的 EPUB
            if fmt_lower not in ('epub', 'pdf'):
                if converted_epub_key:
                    print(f"[Cover] Using converted EPUB for: {title}")
                    minio_key = converted_epub_key
                    fmt_lower = 'epub'
                else:
                    print(f"[Cover] Non-EPUB/PDF format ({fmt_lower}) needs conversion first: {book_id}")
                    return
            
            if not minio_key:
                print(f"[Cover] No minio_key for book: {book_id}")
                return
            
            print(f"[Cover] Extracting cover for: {title} ({fmt_lower})")
            
            # 下载书籍文件
            try:
                client = get_s3()
                ensure_bucket(client, BUCKET)
                resp = client.get_object(Bucket=BUCKET, Key=minio_key)
                book_data = resp["Body"].read()
            except Exception as e:
                print(f"[Cover] Failed to download book: {e}")
                return
            
            # 根据格式提取封面（只支持 EPUB 和 PDF）
            cover_data = None
            if fmt_lower == 'epub':
                cover_data = _extract_epub_cover(book_data)
            elif fmt_lower == 'pdf':
                cover_data = _extract_pdf_cover(book_data)
            
            if not cover_data:
                print(f"[Cover] No cover found for: {book_id}")
                return
            
            # 优化封面图片：转换为 WebP 并压缩
            optimized_data, content_type = _optimize_cover_image(cover_data, max_width=400, quality=80)
            
            # 上传封面到存储
            cover_key = make_object_key(user_id, f"covers/{book_id}.webp")
            
            try:
                upload_bytes(BUCKET, cover_key, optimized_data, content_type)
                print(f"[Cover] Uploaded cover: {cover_key} ({len(optimized_data)} bytes)")
            except Exception as e:
                print(f"[Cover] Failed to upload cover: {e}")
                return
            
            # 更新数据库
            await conn.execute(
                text("UPDATE books SET cover_image_key = :key, updated_at = now() WHERE id = cast(:id as uuid)"),
                {"key": cover_key, "id": book_id},
            )
            print(f"[Cover] Updated book with cover: {book_id}")
            
            # 广播更新事件
            try:
                asyncio.create_task(
                    ws_broadcast(
                        f"book:{book_id}",
                        json.dumps({"event": "COVER_EXTRACTED", "cover_key": cover_key}),
                    )
                )
            except Exception:
                pass
    
    asyncio.get_event_loop().run_until_complete(_run())


@shared_task(name="tasks.extract_book_cover_and_metadata")
def extract_book_cover_and_metadata(book_id: str, user_id: str):
    """
    合并的封面+元数据提取任务
    只下载一次文件，同时提取封面和元数据，提高 PDF 处理效率
    """
    async def _run():
        async with engine.begin() as conn:
            await conn.execute(
                text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
            )
            res = await conn.execute(
                text("SELECT minio_key, original_format, title, author, converted_epub_key FROM books WHERE id = cast(:id as uuid)"),
                {"id": book_id},
            )
            row = res.fetchone()
            if not row:
                print(f"[CoverMeta] Book not found: {book_id}")
                return
            
            minio_key, original_format, current_title, current_author, converted_epub_key = row[0], row[1], row[2], row[3], row[4]
            fmt_lower = (original_format or '').lower()
            
            # 对于非 EPUB/PDF 格式，优先使用转换后的 EPUB
            if fmt_lower not in ('epub', 'pdf'):
                if converted_epub_key:
                    print(f"[CoverMeta] Using converted EPUB")
                    minio_key = converted_epub_key
                    fmt_lower = 'epub'
                else:
                    print(f"[CoverMeta] Non-EPUB/PDF format ({fmt_lower}) needs conversion first: {book_id}")
                    return
            
            if not minio_key:
                print(f"[CoverMeta] No minio_key for book: {book_id}")
                return
            
            print(f"[CoverMeta] Extracting cover and metadata for: {book_id} (format: {fmt_lower})")
            
            # 下载书籍文件（只下载一次）
            try:
                client = get_s3()
                ensure_bucket(client, BUCKET)
                resp = client.get_object(Bucket=BUCKET, Key=minio_key)
                book_data = resp["Body"].read()
                print(f"[CoverMeta] Downloaded {len(book_data)} bytes")
            except Exception as e:
                print(f"[CoverMeta] Failed to download book: {e}")
                return
            
            # ============ 提取封面 ============
            cover_data = None
            if fmt_lower == 'epub':
                cover_data = _extract_epub_cover(book_data)
            elif fmt_lower == 'pdf':
                cover_data = _extract_pdf_cover(book_data)
            
            cover_key = None
            if cover_data:
                # 优化封面图片
                optimized_data, content_type = _optimize_cover_image(cover_data, max_width=400, quality=80)
                cover_key = make_object_key(user_id, f"covers/{book_id}.webp")
                try:
                    upload_bytes(BUCKET, cover_key, optimized_data, content_type)
                    print(f"[CoverMeta] Uploaded cover: {cover_key} ({len(optimized_data)} bytes)")
                except Exception as e:
                    print(f"[CoverMeta] Failed to upload cover: {e}")
                    cover_key = None
            else:
                print(f"[CoverMeta] No cover found for: {book_id}")
            
            # ============ 提取元数据 ============
            metadata = {"title": None, "author": None, "page_count": None}
            if fmt_lower == 'epub':
                metadata = _extract_epub_metadata(book_data)
            elif fmt_lower == 'pdf':
                metadata = _extract_pdf_metadata(book_data)
            
            # ============ 构建数据库更新 ============
            updates = []
            params = {"id": book_id}
            
            # 更新封面
            if cover_key:
                updates.append("cover_image_key = :cover_key")
                params["cover_key"] = cover_key
            
            # 更新作者（如果当前为空且提取到了）
            if metadata.get("author") and (not current_author or current_author.strip() == ""):
                updates.append("author = :author")
                params["author"] = metadata["author"]
                print(f"[CoverMeta] Will update author to: {metadata['author']}")
            
            # 更新标题（如果需要）
            if metadata.get("title"):
                extracted_title = metadata["title"].strip()
                should_update = (
                    not current_title or 
                    current_title.strip() == "" or 
                    "_" in current_title or 
                    current_title.endswith(('.epub', '.pdf', '.mobi', '.azw3')) or
                    ("-" in (current_title or "") and "-" not in extracted_title and len(extracted_title) < len(current_title or ""))
                )
                if should_update:
                    updates.append("title = :title")
                    params["title"] = extracted_title
                    print(f"[CoverMeta] Will update title to: '{extracted_title}'")
            
            # 更新 meta 字段：page_count + metadata_extracted
            if metadata.get("page_count"):
                updates.append("meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('page_count', cast(:page_count as integer), 'needs_manual', false, 'metadata_extracted', true)")
                params["page_count"] = int(metadata["page_count"])
                print(f"[CoverMeta] Will update page_count to: {metadata['page_count']}")
            else:
                updates.append("meta = COALESCE(meta, '{}'::jsonb) || '{\"metadata_extracted\": true}'::jsonb")
            
            # ============ 更新图片型 PDF 检测结果（仅对 PDF 格式）============
            if fmt_lower == 'pdf' and 'is_image_based' in metadata:
                is_image_based = metadata.get("is_image_based", False)
                confidence = metadata.get("digitalization_confidence", 1.0)
                # is_digitalized = true 表示"已检测"，confidence < 0.8 表示是图片型
                updates.append("is_digitalized = true")
                updates.append("initial_digitalization_confidence = :confidence")
                params["confidence"] = confidence
                print(f"[CoverMeta] PDF type detection: is_image_based={is_image_based}, confidence={confidence}")
            
            # 执行更新
            if updates:
                updates.append("updated_at = now()")
                update_sql = f"UPDATE books SET {', '.join(updates)} WHERE id = cast(:id as uuid)"
                await conn.execute(text(update_sql), params)
                print(f"[CoverMeta] Updated book: {book_id}")
            
            # 广播更新事件
            try:
                event_data = {
                    "event": "COVER_AND_METADATA_EXTRACTED",
                    "cover_key": cover_key,
                    "title": metadata.get("title"),
                    "author": metadata.get("author"),
                    "page_count": metadata.get("page_count"),
                    "metadata_extracted": True,
                    "is_image_based": metadata.get("is_image_based", False),
                    "digitalization_confidence": metadata.get("digitalization_confidence", 1.0),
                }
                # 【关键修复】使用 await 而不是 create_task，确保广播消息立即发送
                await ws_broadcast(
                    f"book:{book_id}",
                    json.dumps(event_data),
                )
                print(f"[CoverMeta] WebSocket event broadcasted: COVER_AND_METADATA_EXTRACTED")
            except Exception as e:
                print(f"[CoverMeta] Failed to broadcast WebSocket event: {e}")
    
    asyncio.get_event_loop().run_until_complete(_run())
