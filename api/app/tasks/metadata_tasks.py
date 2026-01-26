"""
元数据提取任务模块

包含书籍元数据提取相关的 Celery 任务（Calibre 和本地方法）
"""
import asyncio
import json
import os
import re
import time

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
    _extract_epub_metadata,
    _extract_pdf_metadata,
)

# Calibre 共享卷目录
CALIBRE_BOOKS_DIR = os.environ.get("CALIBRE_CONVERT_DIR", "/calibre_books")


@shared_task(name="tasks.extract_ebook_metadata_calibre")
def extract_ebook_metadata_calibre(book_id: str, user_id: str):
    """
    使用 Calibre 容器从书籍中提取元数据（标题、作者、封面）
    
    通过共享卷与 Calibre 容器交互：
    1. 将书籍下载到共享卷
    2. 创建元数据提取请求文件
    3. 轮询等待提取完成
    4. 读取结果并更新数据库
    
    优势：
    - 支持更多格式（mobi, azw3, epub, pdf 等）
    - 更准确的元数据提取
    - PDF 类型检测集成
    """
    import uuid as _uuid
    
    async def _run():
        # 获取书籍信息
        async with engine.begin() as conn:
            await conn.execute(
                text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
            )
            res = await conn.execute(
                text("SELECT minio_key, original_format, title, author FROM books WHERE id = cast(:id as uuid)"),
                {"id": book_id},
            )
            row = res.fetchone()
            if not row:
                print(f"[CalibreMeta] Book not found: {book_id}")
                return
            
            minio_key, original_format, current_title, current_author = row[0], row[1], row[2], row[3]
            fmt_lower = (original_format or '').lower()
            
            print(f"[CalibreMeta] Extracting metadata for {book_id} (format: {fmt_lower})")
        
        # 下载文件到共享卷
        job_id = str(_uuid.uuid4())[:8]
        input_filename = f"meta-{job_id}.{fmt_lower}"
        cover_filename = f"cover-{job_id}.jpg"
        
        # Worker 容器中的路径 (/calibre_books) 和 Calibre 容器中的路径 (/books) 不同
        worker_input_path = os.path.join(CALIBRE_BOOKS_DIR, input_filename)
        worker_cover_path = os.path.join(CALIBRE_BOOKS_DIR, cover_filename)
        worker_metadata_path = os.path.join(CALIBRE_BOOKS_DIR, f"metadata-{job_id}.txt")
        worker_request_path = os.path.join(CALIBRE_BOOKS_DIR, f"metadata-{job_id}.metadata.request")
        worker_done_path = os.path.join(CALIBRE_BOOKS_DIR, f"metadata-{job_id}.done")
        worker_error_path = os.path.join(CALIBRE_BOOKS_DIR, f"metadata-{job_id}.error")
        
        # Calibre 容器中的路径
        calibre_input_path = f"/books/{input_filename}"
        calibre_cover_path = f"/books/{cover_filename}"
        
        # 用于存储下载的文件数据（PDF 需要额外分析）
        book_data = None
        
        try:
            # 从 S3 下载文件
            client = get_s3()
            ensure_bucket(client, BUCKET)
            resp = client.get_object(Bucket=BUCKET, Key=minio_key)
            book_data = resp["Body"].read()
            
            os.makedirs(CALIBRE_BOOKS_DIR, exist_ok=True)
            with open(worker_input_path, 'wb') as f:
                f.write(book_data)
            print(f"[CalibreMeta] Downloaded {len(book_data)} bytes to {worker_input_path}")
            
            # 创建元数据提取请求文件
            with open(worker_request_path, 'w') as f:
                f.write(f"{calibre_input_path}\n{calibre_cover_path}\n")
            print(f"[CalibreMeta] Created request file: {worker_request_path}")
            
            # 轮询等待完成（最多等待 60 秒，PDF 可能较慢）
            max_wait = 60
            wait_interval = 0.5
            waited = 0
            
            while waited < max_wait:
                if os.path.exists(worker_done_path):
                    print(f"[CalibreMeta] Metadata extraction completed!")
                    break
                if os.path.exists(worker_error_path):
                    with open(worker_error_path, 'r') as f:
                        error_msg = f.read()
                    print(f"[CalibreMeta] Extraction failed: {error_msg}")
                    # 清理文件
                    for p in [worker_request_path, worker_error_path, worker_input_path]:
                        try:
                            if os.path.exists(p):
                                os.remove(p)
                        except:
                            pass
                    return
                
                time.sleep(wait_interval)
                waited += wait_interval
            
            if waited >= max_wait:
                print(f"[CalibreMeta] Timeout waiting for metadata extraction")
                # 继续处理，可能部分成功
            
            # 解析元数据输出
            metadata = {"title": None, "author": None, "page_count": None}
            if os.path.exists(worker_metadata_path):
                with open(worker_metadata_path, 'r', encoding='utf-8', errors='ignore') as f:
                    output = f.read()
                print(f"[CalibreMeta] ebook-meta output:\n{output}")
                
                # 解析元数据
                title_match = re.search(r'^Title\s*:\s*(.+)$', output, re.MULTILINE)
                if title_match:
                    metadata["title"] = title_match.group(1).strip()
                
                author_match = re.search(r'^Author\(s\)\s*:\s*(.+)$', output, re.MULTILINE)
                if author_match:
                    author_str = author_match.group(1).strip()
                    # 移除排序名称部分 [xxx]
                    author_str = re.sub(r'\s*\[.*?\]', '', author_str)
                    metadata["author"] = author_str.strip()
                
                # 尝试提取页数
                pages_match = re.search(r'^Pages?\s*:\s*(\d+)', output, re.MULTILINE | re.IGNORECASE)
                if pages_match:
                    metadata["page_count"] = int(pages_match.group(1))
            
            # 读取封面
            cover_key = None
            if os.path.exists(worker_cover_path):
                with open(worker_cover_path, 'rb') as f:
                    cover_data = f.read()
                
                if cover_data and len(cover_data) > 1000:  # 至少 1KB
                    # 优化封面
                    optimized_data, content_type = _optimize_cover_image(cover_data, max_width=400, quality=80)
                    cover_key = make_object_key(user_id, f"covers/{book_id}.webp")
                    upload_bytes(BUCKET, cover_key, optimized_data, content_type)
                    print(f"[CalibreMeta] Uploaded cover: {cover_key} ({len(optimized_data)} bytes)")
                else:
                    print(f"[CalibreMeta] Cover too small or empty, skipping")
            else:
                print(f"[CalibreMeta] No cover file found")
            
            # 【PDF 特殊处理】检测是否为图片型 PDF（需要 OCR）
            is_image_based = False
            digitalization_confidence = 1.0
            
            if fmt_lower == 'pdf' and book_data:
                print(f"[CalibreMeta] Analyzing PDF for OCR requirement...")
                pdf_analysis = _extract_pdf_metadata(book_data)
                is_image_based = pdf_analysis.get("is_image_based", False)
                digitalization_confidence = pdf_analysis.get("digitalization_confidence", 1.0)
                if pdf_analysis.get("page_count"):
                    metadata["page_count"] = pdf_analysis["page_count"]
                print(f"[CalibreMeta] PDF analysis: is_image_based={is_image_based}, confidence={digitalization_confidence:.2f}")
            
            # 更新数据库
            updates = []
            params = {"id": book_id}
            
            if cover_key:
                updates.append("cover_image_key = :cover_key")
                params["cover_key"] = cover_key
            
            # 更新作者（如果当前为空）
            if metadata.get("author") and (not current_author or current_author.strip() == ""):
                updates.append("author = :author")
                params["author"] = metadata["author"]
                print(f"[CalibreMeta] Will update author to: {metadata['author']}")
            
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
                    print(f"[CalibreMeta] Will update title to: '{extracted_title}'")
            
            # 更新页数
            meta_updates = []
            if metadata.get("page_count"):
                meta_updates.append(f"'page_count', {metadata['page_count']}::int")
            
            # PDF 特殊：更新图片型检测结果
            if fmt_lower == 'pdf':
                updates.append("is_digitalized = true")
                updates.append("initial_digitalization_confidence = :confidence")
                params["confidence"] = digitalization_confidence
            
            # 标记元数据已提取（合并所有 meta 更新，使用 JSON 字面量避免类型推断问题）
            meta_updates.append("'metadata_extracted', true::boolean")
            meta_updates.append("'extraction_method', 'calibre'::text")
            updates.append(f"meta = COALESCE(meta, '{{}}'::jsonb) || jsonb_build_object({', '.join(meta_updates)})")
            
            if updates:
                updates.append("updated_at = now()")
                update_sql = f"UPDATE books SET {', '.join(updates)} WHERE id = cast(:id as uuid)"
                async with engine.begin() as conn:
                    await conn.execute(
                        text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
                    )
                    await conn.execute(text(update_sql), params)
                    print(f"[CalibreMeta] Updated book: {book_id}")
            
            # 【向量索引触发】EPUB 和 PDF 文字型在后台任务完成后触发
            # - 图片型 PDF：等待 OCR 完成后触发（在 ocr_tasks.py）
            # - AZW3/MOBI 等：转换完成后触发（在 convert_tasks.py）
            print(f"[CalibreMeta] Checking vector index trigger: format={fmt_lower}, confidence={digitalization_confidence}")
            should_index_vectors = False
            if fmt_lower == 'epub':
                # EPUB 始终可以索引
                should_index_vectors = True
                print(f"[CalibreMeta] EPUB format, will trigger vector indexing")
            elif fmt_lower == 'pdf' and digitalization_confidence >= 0.8:
                # PDF 文字型可以索引
                should_index_vectors = True
                print(f"[CalibreMeta] PDF is text-based (confidence={digitalization_confidence:.2f}), will trigger vector indexing")
            elif fmt_lower == 'pdf':
                # PDF 图片型需要等 OCR
                print(f"[CalibreMeta] PDF is image-based (confidence={digitalization_confidence:.2f}), waiting for OCR")
            # AZW3/MOBI 等格式：由 convert_tasks.py 处理
            
            if should_index_vectors:
                try:
                    from ..celery_app import celery_app
                    celery_app.send_task("tasks.index_book_vectors", args=[book_id])
                    print(f"[CalibreMeta] ✓ Triggered vector indexing for book: {book_id}")
                except Exception as e:
                    print(f"[CalibreMeta] ✗ Failed to trigger vector indexing: {e}")
            
            # 广播更新事件
            try:
                event_data = {
                    "event": "METADATA_EXTRACTED",
                    "cover_key": cover_key,
                    "title": metadata.get("title"),
                    "author": metadata.get("author"),
                    "extraction_method": "calibre",
                    "format": fmt_lower,
                }
                # PDF 特殊：包含 OCR 检测信息
                if fmt_lower == 'pdf':
                    event_data["is_image_based"] = is_image_based
                    event_data["digitalization_confidence"] = digitalization_confidence
                    event_data["needs_ocr"] = is_image_based and digitalization_confidence < 0.8
                
                await ws_broadcast(f"book:{book_id}", json.dumps(event_data))
                print(f"[CalibreMeta] WebSocket event broadcasted")
            except Exception as e:
                print(f"[CalibreMeta] Failed to broadcast: {e}")
            
        except Exception as e:
            print(f"[CalibreMeta] Error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            # 清理临时文件
            for path in [worker_input_path, worker_cover_path, worker_metadata_path, 
                         worker_request_path, worker_done_path, worker_error_path]:
                try:
                    if os.path.exists(path):
                        os.remove(path)
                except:
                    pass
    
    asyncio.get_event_loop().run_until_complete(_run())


@shared_task(name="tasks.extract_book_metadata")
def extract_book_metadata(book_id: str, user_id: str):
    """
    从书籍文件中提取元数据 (title, author, page_count) 并更新数据库
    仅支持 EPUB 和 PDF 格式，其他格式需先通过 Calibre 转换为 EPUB
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
                print(f"[Metadata] Book not found: {book_id}")
                return
            
            minio_key, original_format, current_title, current_author, converted_epub_key = row[0], row[1], row[2], row[3], row[4]
            fmt_lower = (original_format or '').lower()
            
            # 对于非 EPUB/PDF 格式，优先使用转换后的 EPUB
            if fmt_lower not in ('epub', 'pdf'):
                if converted_epub_key:
                    print(f"[Metadata] Using converted EPUB for metadata extraction")
                    minio_key = converted_epub_key
                    fmt_lower = 'epub'
                else:
                    print(f"[Metadata] Non-EPUB/PDF format ({fmt_lower}) needs conversion first: {book_id}")
                    return
            
            if not minio_key:
                print(f"[Metadata] No minio_key for book: {book_id}")
                return
            
            print(f"[Metadata] Extracting metadata for book: {book_id} (format: {fmt_lower})")
            
            # 下载书籍文件
            try:
                client = get_s3()
                ensure_bucket(client, BUCKET)
                resp = client.get_object(Bucket=BUCKET, Key=minio_key)
                book_data = resp["Body"].read()
            except Exception as e:
                print(f"[Metadata] Failed to download book: {e}")
                return
            
            # 根据格式提取元数据（只支持 EPUB 和 PDF）
            metadata = {"title": None, "author": None, "page_count": None}
            
            if fmt_lower == 'epub':
                metadata = _extract_epub_metadata(book_data)
            elif fmt_lower == 'pdf':
                metadata = _extract_pdf_metadata(book_data)
            
            # 构建更新语句
            updates = []
            params = {"id": book_id}
            
            # 只有在当前 author 为空且提取到了 author 时才更新
            if metadata.get("author") and (not current_author or current_author.strip() == ""):
                updates.append("author = :author")
                params["author"] = metadata["author"]
                print(f"[Metadata] Will update author to: {metadata['author']}")
            
            # 只有在当前 title 是文件名格式（或为空）且提取到了更好的 title 时才更新
            if metadata.get("title"):
                extracted_title = metadata["title"].strip()
                # 检查是否需要更新标题
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
                    print(f"[Metadata] Will update title from '{current_title}' to: '{extracted_title}'")
                else:
                    print(f"[Metadata] Title not updated, current: '{current_title}', extracted: '{extracted_title}'")
            
            # 更新 meta 字段：page_count 和 metadata_extracted
            if metadata.get("page_count"):
                updates.append("meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('page_count', cast(:page_count as integer), 'needs_manual', false, 'metadata_extracted', true)")
                params["page_count"] = int(metadata["page_count"])
                print(f"[Metadata] Will update page_count to: {metadata['page_count']}")
            else:
                # 无论是否提取到有效数据，都标记元数据提取任务已完成
                updates.append("meta = COALESCE(meta, '{}'::jsonb) || '{\"metadata_extracted\": true}'::jsonb")
            
            if updates:
                updates.append("updated_at = now()")
                update_sql = f"UPDATE books SET {', '.join(updates)} WHERE id = cast(:id as uuid)"
                await conn.execute(text(update_sql), params)
                print(f"[Metadata] Updated book metadata for: {book_id}, metadata_extracted=true")
                
                # 广播更新事件
                try:
                    event_data = {
                        "event": "METADATA_EXTRACTED",
                        "title": metadata.get("title"),
                        "author": metadata.get("author"),
                        "page_count": metadata.get("page_count"),
                        "metadata_extracted": True,
                    }
                    asyncio.create_task(
                        ws_broadcast(
                            f"book:{book_id}",
                            json.dumps(event_data),
                        )
                    )
                except Exception:
                    pass
            else:
                # 即使没有其他更新，也要标记 metadata_extracted
                await conn.execute(
                    text("UPDATE books SET meta = COALESCE(meta, '{}'::jsonb) || '{\"metadata_extracted\": true}'::jsonb, updated_at = now() WHERE id = cast(:id as uuid)"),
                    {"id": book_id},
                )
                print(f"[Metadata] No metadata updates, but marked metadata_extracted=true for: {book_id}")
    
    asyncio.get_event_loop().run_until_complete(_run())
