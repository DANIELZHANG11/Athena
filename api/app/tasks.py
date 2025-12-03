import json
import os
import io
import tempfile
import zipfile

from celery import shared_task
from sqlalchemy import text
from sqlalchemy import text as _text

from .db import engine
from .services import get_ocr
from .storage import make_object_key, read_head, read_full, upload_bytes, get_s3, ensure_bucket, presigned_get
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


def _optimize_cover_image(image_data: bytes, max_width: int = 400, quality: int = 80) -> tuple[bytes, str]:
    """
    优化封面图片：转换为 WebP 格式并压缩
    封面固定尺寸为 400x600 (2:3 比例)
    返回 (优化后的图片数据, content_type)
    """
    try:
        from PIL import Image
        
        img = Image.open(io.BytesIO(image_data))
        
        # 转换为 RGB 模式（WebP 不支持某些模式）
        if img.mode in ('RGBA', 'LA', 'P'):
            # 保留透明通道的转为 RGBA
            img = img.convert('RGBA')
        elif img.mode != 'RGB':
            img = img.convert('RGB')
        
        # 固定尺寸: 400x600 (2:3 比例，与前端 BookCard 一致)
        target_width = 400
        target_height = 600
        
        # 计算裁剪区域以保持比例
        img_ratio = img.width / img.height
        target_ratio = target_width / target_height
        
        if img_ratio > target_ratio:
            # 图片太宽，需要裁剪左右
            new_width = int(img.height * target_ratio)
            left = (img.width - new_width) // 2
            img = img.crop((left, 0, left + new_width, img.height))
        elif img_ratio < target_ratio:
            # 图片太高，需要裁剪上下
            new_height = int(img.width / target_ratio)
            top = (img.height - new_height) // 2
            img = img.crop((0, top, img.width, top + new_height))
        
        # 缩放到目标尺寸
        img = img.resize((target_width, target_height), Image.Resampling.LANCZOS)
        
        # 转换为 WebP
        output = io.BytesIO()
        if img.mode == 'RGBA':
            img.save(output, format='WEBP', quality=quality, lossless=False)
        else:
            img.save(output, format='WEBP', quality=quality, lossless=False)
        
        webp_data = output.getvalue()
        print(f"[Cover] Optimized: {len(image_data)} -> {len(webp_data)} bytes (400x600 WebP)")
        
        return webp_data, "image/webp"
    except Exception as e:
        print(f"[Cover] Failed to optimize image, using original: {e}")
        # 回退到原始格式
        if image_data[:8].startswith(b'\x89PNG'):
            return image_data, "image/png"
        return image_data, "image/jpeg"


def _extract_epub_metadata(epub_data: bytes) -> dict:
    """从 EPUB 文件中提取元数据 (title, author)"""
    metadata = {"title": None, "author": None}
    try:
        with zipfile.ZipFile(io.BytesIO(epub_data)) as zf:
            # 找到 OPF 文件
            opf_path = None
            for name in zf.namelist():
                if name.endswith('.opf'):
                    opf_path = name
                    break
            
            if opf_path:
                import re
                opf_content = zf.read(opf_path).decode('utf-8', errors='ignore')
                
                # 提取 title
                title_match = re.search(r'<dc:title[^>]*>([^<]+)</dc:title>', opf_content, re.IGNORECASE)
                if title_match:
                    metadata["title"] = title_match.group(1).strip()
                
                # 提取 author (creator)
                author_match = re.search(r'<dc:creator[^>]*>([^<]+)</dc:creator>', opf_content, re.IGNORECASE)
                if author_match:
                    metadata["author"] = author_match.group(1).strip()
                
                print(f"[Metadata] EPUB metadata extracted: title={metadata['title']}, author={metadata['author']}")
    except Exception as e:
        print(f"[Metadata] Failed to extract EPUB metadata: {e}")
    return metadata


def _extract_pdf_metadata(pdf_data: bytes) -> dict:
    """从 PDF 文件中提取元数据 (title, author)"""
    metadata = {"title": None, "author": None}
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(stream=pdf_data, filetype="pdf")
        pdf_meta = doc.metadata
        if pdf_meta:
            if pdf_meta.get("title"):
                metadata["title"] = pdf_meta["title"].strip()
            if pdf_meta.get("author"):
                metadata["author"] = pdf_meta["author"].strip()
        
        # 同时提取页数
        page_count = len(doc)
        doc.close()
        metadata["page_count"] = page_count
        print(f"[Metadata] PDF metadata extracted: title={metadata['title']}, author={metadata['author']}, pages={page_count}")
    except Exception as e:
        print(f"[Metadata] Failed to extract PDF metadata: {e}")
    return metadata


def _extract_epub_cover(epub_data: bytes) -> bytes | None:
    """从 EPUB 文件中提取封面图片"""
    try:
        with zipfile.ZipFile(io.BytesIO(epub_data)) as zf:
            # 尝试从 OPF 文件中找到封面
            opf_path = None
            for name in zf.namelist():
                if name.endswith('.opf'):
                    opf_path = name
                    break
            
            if opf_path:
                opf_content = zf.read(opf_path).decode('utf-8', errors='ignore')
                
                # 查找封面图片引用
                import re
                # 查找 cover-image 或 cover 的引用
                cover_patterns = [
                    r'<item[^>]*id\s*=\s*["\']cover["\'][^>]*href\s*=\s*["\']([^"\']+)["\']',
                    r'<item[^>]*href\s*=\s*["\']([^"\']+)["\'][^>]*id\s*=\s*["\']cover["\']',
                    r'<item[^>]*properties\s*=\s*["\']cover-image["\'][^>]*href\s*=\s*["\']([^"\']+)["\']',
                    r'<item[^>]*href\s*=\s*["\']([^"\']+)["\'][^>]*properties\s*=\s*["\']cover-image["\']',
                ]
                
                for pattern in cover_patterns:
                    match = re.search(pattern, opf_content, re.IGNORECASE)
                    if match:
                        cover_href = match.group(1)
                        # 构建完整路径
                        opf_dir = os.path.dirname(opf_path)
                        if opf_dir:
                            cover_path = f"{opf_dir}/{cover_href}"
                        else:
                            cover_path = cover_href
                        
                        # 尝试读取封面
                        for name in zf.namelist():
                            if name.endswith(cover_href) or name == cover_path:
                                return zf.read(name)
            
            # 后备方案：查找常见的封面文件名
            cover_names = ['cover.jpg', 'cover.jpeg', 'cover.png', 'Cover.jpg', 'Cover.jpeg', 'Cover.png']
            for name in zf.namelist():
                for cover_name in cover_names:
                    if name.endswith(cover_name):
                        return zf.read(name)
            
            # 最后方案：找第一个图片文件
            for name in zf.namelist():
                lower = name.lower()
                if lower.endswith(('.jpg', '.jpeg', '.png')) and 'cover' in lower:
                    return zf.read(name)
                    
    except Exception as e:
        print(f"[Cover] Failed to extract EPUB cover: {e}")
    return None


def _extract_pdf_cover(pdf_data: bytes) -> bytes | None:
    """从 PDF 文件中提取第一页作为封面"""
    try:
        import fitz  # PyMuPDF
        
        doc = fitz.open(stream=pdf_data, filetype="pdf")
        if len(doc) > 0:
            page = doc[0]
            # 渲染第一页为图片
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))  # 2x 缩放以获得更好的质量
            img_data = pix.tobytes("jpeg")
            doc.close()
            return img_data
    except Exception as e:
        print(f"[Cover] Failed to extract PDF cover: {e}")
    return None


# Calibre 容器地址（Docker 内部网络）
CALIBRE_HOST = os.getenv("CALIBRE_HOST", "calibre")


@shared_task(name="tasks.convert_to_epub")
def convert_to_epub(book_id: str, user_id: str):
    """
    使用 Calibre 容器将非 EPUB/PDF 格式的书籍转换为 EPUB
    通过共享卷与 Calibre 容器交互，然后轮询等待转换完成
    """
    import asyncio
    import uuid as _uuid
    import os
    import time
    from .celery_app import celery_app
    
    CALIBRE_BOOKS_DIR = os.environ.get("CALIBRE_CONVERT_DIR", "/calibre_books")
    
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
                print(f"[Convert] Book not found: {book_id}")
                return
            
            minio_key, original_format, title, existing_epub = row[0], row[1], row[2], row[3]
            fmt_lower = (original_format or '').lower()
            
            # 如果已经是 EPUB 或已有转换后的 EPUB，跳过
            if fmt_lower == 'epub':
                print(f"[Convert] Book is already EPUB, skipping: {book_id}")
                return
            if existing_epub:
                print(f"[Convert] Book already has converted EPUB, skipping: {book_id}")
                return
            
            # PDF 不需要转换
            if fmt_lower == 'pdf':
                print(f"[Convert] PDF format does not need conversion: {book_id}")
                return
            
            print(f"[Convert] Converting {fmt_lower} to EPUB: {title}")
            
            job_id = str(_uuid.uuid4())[:8]
            input_filename = f"input-{job_id}.{fmt_lower}"
            output_filename = f"output-{job_id}.epub"
            
            # Calibre 容器中的路径是 /books，Worker 容器中的路径是 /calibre_books
            worker_input_path = os.path.join(CALIBRE_BOOKS_DIR, input_filename)
            worker_output_path = os.path.join(CALIBRE_BOOKS_DIR, output_filename)
            calibre_input_path = f"/books/{input_filename}"
            calibre_output_path = f"/books/{output_filename}"
            
            try:
                # 从存储下载源文件
                client = get_s3()
                ensure_bucket(client, BUCKET)
                resp = client.get_object(Bucket=BUCKET, Key=minio_key)
                book_data = resp["Body"].read()
                
                # 写入共享卷
                os.makedirs(CALIBRE_BOOKS_DIR, exist_ok=True)
                with open(worker_input_path, 'wb') as f:
                    f.write(book_data)
                print(f"[Convert] Wrote source file: {worker_input_path} ({len(book_data)} bytes)")
                
                # 创建转换请求文件（Calibre 容器中的监控脚本会读取并执行）
                request_file = os.path.join(CALIBRE_BOOKS_DIR, f"convert-{job_id}.request")
                with open(request_file, 'w') as f:
                    f.write(f"{calibre_input_path}\n{calibre_output_path}\n")
                print(f"[Convert] Created conversion request: {request_file}")
                
                # 轮询等待转换完成（最多等待 5 分钟）
                done_file = os.path.join(CALIBRE_BOOKS_DIR, f"convert-{job_id}.done")
                error_file = os.path.join(CALIBRE_BOOKS_DIR, f"convert-{job_id}.error")
                
                max_wait = 300  # 5 分钟
                wait_interval = 2  # 每 2 秒检查一次
                waited = 0
                
                while waited < max_wait:
                    if os.path.exists(done_file):
                        print(f"[Convert] Conversion completed!")
                        break
                    if os.path.exists(error_file):
                        with open(error_file, 'r') as f:
                            error_msg = f.read()
                        print(f"[Convert] Conversion failed: {error_msg}")
                        # 清理
                        try:
                            os.remove(request_file)
                            os.remove(error_file)
                            os.remove(worker_input_path)
                        except:
                            pass
                        await conn.execute(
                            text("UPDATE books SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('conversion_error', :err) WHERE id = cast(:id as uuid)"),
                            {"err": error_msg[:500], "id": book_id},
                        )
                        return
                    
                    time.sleep(wait_interval)
                    waited += wait_interval
                    if waited % 30 == 0:
                        print(f"[Convert] Still waiting... ({waited}s)")
                
                if waited >= max_wait:
                    print(f"[Convert] Conversion timed out after {max_wait}s")
                    # 标记为需要手动转换
                    await conn.execute(
                        text("UPDATE books SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('needs_manual_conversion', true) WHERE id = cast(:id as uuid)"),
                        {"id": book_id},
                    )
                    return
                
                # 读取转换后的文件
                if not os.path.exists(worker_output_path):
                    print(f"[Convert] Output file not found: {worker_output_path}")
                    return
                
                with open(worker_output_path, 'rb') as f:
                    epub_data = f.read()
                print(f"[Convert] Read converted EPUB: {len(epub_data)} bytes")
                
                # 上传到存储
                epub_key = make_object_key(user_id, f"converted/{book_id}.epub")
                upload_bytes(BUCKET, epub_key, epub_data, "application/epub+zip")
                print(f"[Convert] Uploaded converted EPUB: {epub_key}")
                
                # 删除 S3 中的原始非 EPUB/PDF 文件（节省存储空间）
                try:
                    client.delete_object(Bucket=BUCKET, Key=minio_key)
                    print(f"[Convert] Deleted original file from S3: {minio_key}")
                except Exception as del_e:
                    print(f"[Convert] Warning: Failed to delete original file: {del_e}")
                
                # 更新数据库：minio_key 指向新的 EPUB，保留 converted_epub_key 作为标记
                await conn.execute(
                    text("UPDATE books SET minio_key = :key, converted_epub_key = :key, updated_at = now() WHERE id = cast(:id as uuid)"),
                    {"key": epub_key, "id": book_id},
                )
                print(f"[Convert] Updated book minio_key to converted EPUB: {book_id}")
                
                # 清理临时文件
                for f in [worker_input_path, worker_output_path, request_file, done_file]:
                    try:
                        os.remove(f)
                    except:
                        pass
                
                # 广播转换完成事件
                try:
                    import json as _j
                    asyncio.create_task(
                        ws_broadcast(
                            f"book:{book_id}",
                            _j.dumps({"event": "CONVERTED_TO_EPUB", "epub_key": epub_key}),
                        )
                    )
                except Exception:
                    pass
                
            except Exception as e:
                print(f"[Convert] Conversion error: {e}")
                import traceback
                traceback.print_exc()
                return
        
        # 转换完成后，触发封面和元数据提取
        print(f"[Convert] Triggering cover and metadata extraction for: {book_id}")
        celery_app.send_task("tasks.extract_book_cover", args=[book_id, user_id])
        celery_app.send_task("tasks.extract_book_metadata", args=[book_id, user_id])
    
    asyncio.get_event_loop().run_until_complete(_run())


@shared_task(name="tasks.extract_book_cover")
def extract_book_cover(book_id: str, user_id: str):
    """
    提取书籍封面并保存到存储
    仅支持 EPUB 和 PDF 格式，其他格式需先通过 Calibre 转换为 EPUB
    """
    import asyncio
    
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
                import json as _j
                asyncio.create_task(
                    ws_broadcast(
                        f"book:{book_id}",
                        _j.dumps({"event": "COVER_EXTRACTED", "cover_key": cover_key}),
                    )
                )
            except Exception:
                pass
    
    asyncio.get_event_loop().run_until_complete(_run())


@shared_task(name="tasks.extract_book_metadata")
def extract_book_metadata(book_id: str, user_id: str):
    """
    从书籍文件中提取元数据 (title, author, page_count) 并更新数据库
    仅支持 EPUB 和 PDF 格式，其他格式需先通过 Calibre 转换为 EPUB
    """
    import asyncio
    
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
                # 1. 当前标题为空
                # 2. 当前标题包含文件名特征（下划线、连字符分隔作者名、扩展名后缀）
                # 3. 当前标题与提取的标题不同，且提取的标题更短（可能是去除了作者名后缀）
                should_update = (
                    not current_title or 
                    current_title.strip() == "" or 
                    "_" in current_title or 
                    current_title.endswith(('.epub', '.pdf', '.mobi', '.azw3')) or
                    # 文件名格式通常是 "书名-作者名"，如果提取的标题不包含连字符且当前标题包含，说明需要更新
                    ("-" in (current_title or "") and "-" not in extracted_title and len(extracted_title) < len(current_title or ""))
                )
                if should_update:
                    updates.append("title = :title")
                    params["title"] = extracted_title
                    print(f"[Metadata] Will update title from '{current_title}' to: '{extracted_title}'")
                else:
                    print(f"[Metadata] Title not updated, current: '{current_title}', extracted: '{extracted_title}'")
            
            # 更新 page_count 到 meta
            if metadata.get("page_count"):
                updates.append("meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('page_count', cast(:page_count as integer), 'needs_manual', false)")
                params["page_count"] = int(metadata["page_count"])
                print(f"[Metadata] Will update page_count to: {metadata['page_count']}")
            
            if updates:
                updates.append("updated_at = now()")
                update_sql = f"UPDATE books SET {', '.join(updates)} WHERE id = cast(:id as uuid)"
                await conn.execute(text(update_sql), params)
                print(f"[Metadata] Updated book metadata for: {book_id}")
                
                # 广播更新事件
                try:
                    import json as _j
                    event_data = {
                        "event": "METADATA_EXTRACTED",
                        "title": metadata.get("title"),
                        "author": metadata.get("author"),
                        "page_count": metadata.get("page_count"),
                    }
                    asyncio.create_task(
                        ws_broadcast(
                            f"book:{book_id}",
                            _j.dumps(event_data),
                        )
                    )
                except Exception:
                    pass
            else:
                print(f"[Metadata] No updates needed for: {book_id}")
    
    asyncio.get_event_loop().run_until_complete(_run())


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


def _pdf_to_images(pdf_data: bytes, max_pages: int = 0, dpi: int = 150) -> tuple:
    """
    将 PDF 转换为图片列表，用于 OCR
    Args:
        pdf_data: PDF 文件二进制数据
        max_pages: 最大处理页数，0 表示处理所有页面
        dpi: 渲染分辨率
    Returns:
        (images, image_width, image_height)
        images: [(page_num, image_bytes, total_pages), ...]
        image_width, image_height: 渲染后的图片尺寸（像素）
    """
    import fitz  # PyMuPDF
    
    images = []
    image_width = 0
    image_height = 0
    try:
        doc = fitz.open(stream=pdf_data, filetype="pdf")
        total_pages = len(doc)
        pages_to_process = total_pages if max_pages <= 0 else min(total_pages, max_pages)
        
        print(f"[OCR] PDF has {total_pages} pages, will process {pages_to_process} pages")
        
        for page_num in range(pages_to_process):
            page = doc[page_num]
            # 渲染为像素图
            mat = fitz.Matrix(dpi / 72, dpi / 72)
            pix = page.get_pixmap(matrix=mat)
            
            # 记录图片尺寸（使用第一页的尺寸作为标准）
            if page_num == 0:
                image_width = pix.width
                image_height = pix.height
                print(f"[OCR] Page size at {dpi} DPI: {image_width} x {image_height} pixels")
            
            # 转换为 PNG 格式
            img_data = pix.tobytes("png")
            images.append((page_num + 1, img_data, total_pages))
        
        doc.close()
    except Exception as e:
        print(f"[OCR] Failed to convert PDF to images: {e}")
    
    return images, image_width, image_height


@shared_task(name="tasks.deep_analyze_book")
def deep_analyze_book(book_id: str, user_id: str):
    import asyncio
    import tempfile
    import os as _os

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
            
            # 图片尺寸变量（用于存入报告）
            ocr_image_width = 0
            ocr_image_height = 0
            
            if is_pdf:
                # PDF 文件：先转换为图片再 OCR（处理所有页面）
                print(f"[OCR] Processing PDF: {key}")
                pdf_data = read_full(BUCKET, key)
                if pdf_data:
                    # max_pages=0 表示处理所有页面
                    page_images, ocr_image_width, ocr_image_height = _pdf_to_images(pdf_data, max_pages=0, dpi=150)
                    all_text = []
                    all_regions = []
                    total_pages = page_images[0][2] if page_images else 0
                    
                    for page_num, img_bytes, _ in page_images:
                        # 将图片保存到临时文件
                        fd, temp_path = tempfile.mkstemp(suffix='.png')
                        try:
                            _os.write(fd, img_bytes)
                            _os.close(fd)
                            
                            # 对单页进行 OCR
                            page_result = ocr.recognize("", temp_path)  # 直接传本地路径
                            if page_result.get("text"):
                                all_text.append(f"--- Page {page_num} ---")
                                all_text.append(page_result["text"])
                                # 使用 regions（包含坐标信息）
                                for r in page_result.get("regions", []):
                                    r["page"] = page_num
                                    all_regions.append(r)
                            print(f"[OCR] Page {page_num}/{total_pages}: {len(page_result.get('text', ''))} chars, {len(page_result.get('regions', []))} regions")
                        except Exception as e:
                            print(f"[OCR] Page {page_num}/{total_pages} failed: {e}")
                        finally:
                            try:
                                _os.remove(temp_path)
                            except Exception:
                                pass
                    
                    print(f"[OCR] Completed: {len(all_regions)} text regions, {len(''.join(all_text))} total chars")
                    ocr_res = {"regions": all_regions, "text": "\n".join(all_text)}
                    
                    # 触发向量索引任务
                    from .search_sync import index_book_content
                    index_book_content(book_id, user_id, all_regions)
                    print(f"[OCR] Triggered search indexing for book {book_id}")
            else:
                # 图片文件：直接 OCR
                ocr_res = ocr.recognize(BUCKET, key)
            
            rep_key = make_object_key(user_id, f"digitalize-report-{book_id}.json")
            report_data = {
                "is_image_based": img, 
                "confidence": conf, 
                "ocr": ocr_res,
            }
            # 如果有图片尺寸信息，添加到报告中
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
