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
    """Quick heuristic to guess whether a file is image based."""
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
    """Convert a cover image to a normalized WebP rendition."""
    try:
        from PIL import Image

        img = Image.open(io.BytesIO(image_data))

        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
        elif img.mode != "RGB":
            img = img.convert("RGB")

        target_width = max_width
        target_height = int(max_width * 1.5)  # 2:3 ratio
        img_ratio = img.width / img.height
        target_ratio = target_width / target_height

        if img_ratio > target_ratio:
            new_width = int(img.height * target_ratio)
            left = (img.width - new_width) // 2
            img = img.crop((left, 0, left + new_width, img.height))
        elif img_ratio < target_ratio:
            new_height = int(img.width / target_ratio)
            top = (img.height - new_height) // 2
            img = img.crop((0, top, img.width, top + new_height))

        resample = getattr(Image, "Resampling", Image).LANCZOS
        img = img.resize((target_width, target_height), resample)

        output = io.BytesIO()
        img.save(output, format="WEBP", quality=quality, lossless=False)
        webp_data = output.getvalue()
        print(f"[Cover] Optimized: {len(image_data)} -> {len(webp_data)} bytes (400x600 WebP)")
        return webp_data, "image/webp"
    except Exception as e:
        print(f"[Cover] Failed to optimize image, using original: {e}")
        if image_data[:8].startswith(b"\x89PNG"):
            return image_data, "image/png"
        return image_data, "image/jpeg"


def _extract_epub_metadata(epub_data: bytes) -> dict:
    """Extract title/author information from an EPUB file."""
    metadata = {"title": None, "author": None}
    try:
        with zipfile.ZipFile(io.BytesIO(epub_data)) as zf:
            opf_path = None
            for name in zf.namelist():
                if name.endswith(".opf"):
                    opf_path = name
                    break

            if opf_path:
                import re

                opf_content = zf.read(opf_path).decode("utf-8", errors="ignore")
                title_match = re.search(r"<dc:title[^>]*>([^<]+)</dc:title>", opf_content, re.IGNORECASE)
                if title_match:
                    metadata["title"] = title_match.group(1).strip()

                author_match = re.search(r"<dc:creator[^>]*>([^<]+)</dc:creator>", opf_content, re.IGNORECASE)
                if author_match:
                    metadata["author"] = author_match.group(1).strip()

                print(f"[Metadata] EPUB metadata extracted: title={metadata['title']}, author={metadata['author']}")
    except Exception as e:
        print(f"[Metadata] Failed to extract EPUB metadata: {e}")
    return metadata


def _extract_pdf_metadata(pdf_data: bytes) -> dict:
    """Extract metadata (title, author, page count) and a quick digitalization score."""
    metadata = {"title": None, "author": None, "page_count": None, "is_image_based": False, "digitalization_confidence": 1.0}
    try:
        import fitz  # PyMuPDF

        doc = fitz.open(stream=pdf_data, filetype="pdf")
        pdf_meta = doc.metadata
        if pdf_meta:
            if pdf_meta.get("title"):
                metadata["title"] = pdf_meta["title"].strip()
            if pdf_meta.get("author"):
                metadata["author"] = pdf_meta["author"].strip()

        page_count = len(doc)
        metadata["page_count"] = page_count

        sample_pages = min(5, page_count)
        total_text_chars = 0
        total_cjk_chars = 0

        import re

        for i in range(sample_pages):
            page = doc[i]
            text = page.get_text("text")
            if text:
                clean_text = text.strip()
                total_text_chars += len(clean_text)
                total_cjk_chars += len(re.findall(r"[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]", clean_text))

        avg_chars_per_page = total_text_chars / sample_pages if sample_pages > 0 else 0

        if avg_chars_per_page < 50:
            metadata["is_image_based"] = True
            metadata["digitalization_confidence"] = 0.1
            print(f"[Metadata] PDF detected as IMAGE-BASED: avg {avg_chars_per_page:.1f} chars/page (threshold: 50)")
        elif avg_chars_per_page < 200:
            metadata["is_image_based"] = True
            metadata["digitalization_confidence"] = 0.3
            print(f"[Metadata] PDF detected as PARTIALLY IMAGE-BASED: avg {avg_chars_per_page:.1f} chars/page")
        else:
            metadata["is_image_based"] = False
            metadata["digitalization_confidence"] = min(1.0, avg_chars_per_page / 500)
            print(f"[Metadata] PDF detected as DIGITAL: avg {avg_chars_per_page:.1f} chars/page")

        doc.close()
        print(
            f"[Metadata] PDF metadata extracted: title={metadata['title']}, author={metadata['author']}, pages={page_count}, is_image_based={metadata['is_image_based']}"
        )
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
CALIBRE_BOOKS_DIR = os.getenv("CALIBRE_CONVERT_DIR", "/calibre_books")


@shared_task(name="tasks.extract_ebook_metadata_calibre")
def extract_ebook_metadata_calibre(book_id: str, user_id: str):
    """
    使用 Calibre ebook-meta 命令即时提取电子书的元数据和封面。
    
    支持所有格式：PDF, EPUB, MOBI, AZW3, FB2 等 20+ 格式。
    
    对于 PDF：
    - 提取元数据和封面
    - 额外检测是否为图片型 PDF（需要 OCR）
    
    通过共享卷与 calibre-metadata 容器交互：
    1. Worker 将电子书写入共享卷
    2. Worker 创建 .metadata.request 请求文件
    3. calibre-metadata 容器执行 ebook-meta
    4. Worker 轮询等待 .done 文件
    """
    import asyncio
    import time
    import re
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


@shared_task(name="tasks.convert_to_epub")
def convert_to_epub(book_id: str, user_id: str):
    """
    使用 Calibre 容器将非 EPUB/PDF 格式的书籍转换为 EPUB
    通过共享卷与 Calibre 容器交互，然后轮询等待转换完成
    
    状态流转：pending -> processing -> completed/failed
    
    【重要】每个数据库操作使用独立事务，避免长事务问题
    """
    import asyncio
    import uuid as _uuid
    import os
    import time
    from .celery_app import celery_app
    
    CALIBRE_BOOKS_DIR = os.environ.get("CALIBRE_CONVERT_DIR", "/calibre_books")
    
    async def _update_status(status: str, extra_sql: str = "", extra_params: dict = None):
        """独立事务更新状态"""
        async with engine.begin() as conn:
            await conn.execute(
                text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
            )
            params = {"id": book_id, **(extra_params or {})}
            if extra_sql:
                sql = f"UPDATE books SET conversion_status = '{status}', {extra_sql}, updated_at = now() WHERE id = cast(:id as uuid)"
            else:
                sql = f"UPDATE books SET conversion_status = '{status}', updated_at = now() WHERE id = cast(:id as uuid)"
            await conn.execute(text(sql), params)
            print(f"[Convert] Status updated to '{status}' for book: {book_id}")
    
    async def _get_book_info():
        """独立事务获取书籍信息"""
        async with engine.begin() as conn:
            await conn.execute(
                text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
            )
            res = await conn.execute(
                text("SELECT minio_key, original_format, title, converted_epub_key FROM books WHERE id = cast(:id as uuid)"),
                {"id": book_id},
            )
            return res.fetchone()
    
    async def _update_converted_epub(epub_key: str):
        """独立事务更新转换后的 EPUB 信息"""
        async with engine.begin() as conn:
            await conn.execute(
                text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
            )
            await conn.execute(
                text("UPDATE books SET minio_key = :key, converted_epub_key = :key, conversion_status = 'completed', updated_at = now() WHERE id = cast(:id as uuid)"),
                {"key": epub_key, "id": book_id},
            )
            print(f"[Convert] Updated book with converted EPUB, status='completed': {book_id}")
    
    async def _run():
        # 步骤1：更新状态为 processing
        await _update_status('processing')
        
        # 步骤2：获取书籍信息
        row = await _get_book_info()
        if not row:
            print(f"[Convert] Book not found: {book_id}")
            return
        
        minio_key, original_format, title, existing_epub = row[0], row[1], row[2], row[3]
        fmt_lower = (original_format or '').lower()
        
        # 如果已经是 EPUB 或已有转换后的 EPUB，跳过
        if fmt_lower == 'epub':
            print(f"[Convert] Book is already EPUB, skipping: {book_id}")
            await _update_status('completed')
            return
        if existing_epub:
            print(f"[Convert] Book already has converted EPUB, skipping: {book_id}")
            await _update_status('completed')
            return
        
        # PDF 不需要转换
        if fmt_lower == 'pdf':
            print(f"[Convert] PDF format does not need conversion: {book_id}")
            await _update_status('completed')
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
                    # 标记转换失败
                    await _update_status('failed', 
                        "meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('conversion_error', :err)",
                        {"err": error_msg[:500]})
                    return
                
                time.sleep(wait_interval)
                waited += wait_interval
                if waited % 30 == 0:
                    print(f"[Convert] Still waiting... ({waited}s)")
            
            if waited >= max_wait:
                print(f"[Convert] Conversion timed out after {max_wait}s")
                # 标记为转换失败（超时）
                await _update_status('failed',
                    "meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('needs_manual_conversion', true, 'conversion_error', 'timeout')")
                return
            
            # 读取转换后的文件
            if not os.path.exists(worker_output_path):
                print(f"[Convert] Output file not found: {worker_output_path}")
                await _update_status('failed',
                    "meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('conversion_error', 'output_not_found')")
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
            
            # 【关键】使用独立事务更新数据库
            await _update_converted_epub(epub_key)
            
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
            # 标记为失败
            try:
                await _update_status('failed',
                    "meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('conversion_error', :err)",
                    {"err": str(e)[:500]})
            except:
                pass
            return
        
        # 【架构变更】转换完成后，检查是否已有封面
        # extract_ebook_metadata_calibre 任务已经并行提取了元数据和封面
        # 只有在封面不存在时才触发补充提取
        async with engine.begin() as conn:
            await conn.execute(
                text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
            )
            res = await conn.execute(
                text("SELECT cover_image_key FROM books WHERE id = cast(:id as uuid)"),
                {"id": book_id},
            )
            row = res.fetchone()
            has_cover = row and row[0]
        
        if not has_cover:
            # 封面还没有，使用转换后的 EPUB 提取封面
            print(f"[Convert] No cover found, triggering EPUB cover extraction for: {book_id}")
            celery_app.send_task("tasks.extract_book_cover_and_metadata", args=[book_id, user_id])
        else:
            print(f"[Convert] Cover already exists, skipping extraction for: {book_id}")
    
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
            
            # 更新 meta 字段：page_count 和 metadata_extracted
            # 合并成一个语句避免 "multiple assignments to same column" 错误
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
                    import json as _j
                    event_data = {
                        "event": "METADATA_EXTRACTED",
                        "title": metadata.get("title"),
                        "author": metadata.get("author"),
                        "page_count": metadata.get("page_count"),
                        "metadata_extracted": True,  # 标记任务完成
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
                # 即使没有其他更新，也要标记 metadata_extracted
                await conn.execute(
                    text("UPDATE books SET meta = COALESCE(meta, '{}'::jsonb) || '{\"metadata_extracted\": true}'::jsonb, updated_at = now() WHERE id = cast(:id as uuid)"),
                    {"id": book_id},
                )
                print(f"[Metadata] No metadata updates, but marked metadata_extracted=true for: {book_id}")
    
    asyncio.get_event_loop().run_until_complete(_run())


@shared_task(name="tasks.extract_book_cover_and_metadata")
def extract_book_cover_and_metadata(book_id: str, user_id: str):
    """
    合并的封面+元数据提取任务
    只下载一次文件，同时提取封面和元数据，提高 PDF 处理效率
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
                import json as _j
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
                    _j.dumps(event_data),
                )
                print(f"[CoverMeta] WebSocket event broadcasted: COVER_AND_METADATA_EXTRACTED")
            except Exception as e:
                print(f"[CoverMeta] Failed to broadcast WebSocket event: {e}")
    
    asyncio.get_event_loop().run_until_complete(_run())


@shared_task(name="tasks.analyze_book_type")
def analyze_book_type(book_id: str, user_id: str):
    """
    【已废弃】此任务已被 extract_book_cover_and_metadata 取代
    
    保留此函数仅为向后兼容，实际 PDF 类型检测已整合到元数据提取流程中。
    如果仍被调用，使用 _quick_confidence 快速检测并设置 is_digitalized 标志。
    """
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
            is_image_based, conf = _quick_confidence(key)
            
            # 【关键修复】设置 is_digitalized = true 以标记检测完成
            await conn.execute(
                text(
                    "UPDATE books SET is_digitalized = true, initial_digitalization_confidence = :c, updated_at = now() WHERE id = cast(:id as uuid)"
                ),
                {"c": conf, "id": book_id},
            )
            print(f"[AnalyzeBookType] Book {book_id}: is_image_based={is_image_based}, confidence={conf:.2f}")
        
        try:
            import json as _j

            # 【关键修复】WebSocket 事件包含完整检测信息，使用 await 确保发送
            await ws_broadcast(
                f"book:{book_id}",
                _j.dumps({
                    "event": "ANALYZED",
                    "confidence": conf,
                    "is_image_based": is_image_based,
                    "is_digitalized": True,
                }),
            )
            print(f"[AnalyzeBookType] WebSocket event broadcasted: ANALYZED")
        except Exception as e:
            print(f"[AnalyzeBookType] Failed to broadcast WebSocket event: {e}")
        try:
            async with engine.begin() as conn2:
                await conn2.execute(
                    _text(
                        "INSERT INTO audit_logs(id, owner_id, action, details) VALUES (gen_random_uuid(), cast(:uid as uuid), :act, cast(:det as jsonb))"
                    ),
                    {
                        "uid": user_id,
                        "act": "task_analyze_book_type",
                        "det": _j.dumps({"book_id": book_id, "confidence": conf, "is_image_based": is_image_based}),
                    },
                )
        except Exception:
            pass

    asyncio.get_event_loop().run_until_complete(_run())


def _pdf_to_images_with_sizes(pdf_data: bytes, max_pages: int = 0, dpi: int = 150) -> list:
    """
    将 PDF 转换为图片列表，用于 OCR
    **每页单独记录尺寸**，因为 PDF 每页尺寸可能不同
    
    Args:
        pdf_data: PDF 文件二进制数据
        max_pages: 最大处理页数，0 表示处理所有页面
        dpi: 渲染分辨率
    Returns:
        list of dict: [
            {
                "page_num": 1,
                "image_bytes": bytes,
                "width": 1200,   # 该页渲染后的像素宽度
                "height": 1600,  # 该页渲染后的像素高度
                "pdf_width": 595.0,   # PDF 原始宽度 (points, 72 DPI)
                "pdf_height": 842.0,  # PDF 原始高度 (points)
            },
            ...
        ]
    """
    import fitz  # PyMuPDF
    
    pages = []
    try:
        doc = fitz.open(stream=pdf_data, filetype="pdf")
        total_pages = len(doc)
        pages_to_process = total_pages if max_pages <= 0 else min(total_pages, max_pages)
        
        print(f"[OCR] PDF has {total_pages} pages, will process {pages_to_process} pages")
        
        for page_num in range(pages_to_process):
            page = doc[page_num]
            
            # 获取 PDF 原始页面尺寸 (points, 1 point = 1/72 inch)
            pdf_rect = page.rect
            pdf_width = pdf_rect.width
            pdf_height = pdf_rect.height
            
            # 渲染为像素图
            mat = fitz.Matrix(dpi / 72, dpi / 72)
            pix = page.get_pixmap(matrix=mat)
            
            # 渲染后的像素尺寸
            pixel_width = pix.width
            pixel_height = pix.height
            
            if page_num == 0:
                print(f"[OCR] First page: PDF size {pdf_width:.1f}x{pdf_height:.1f} pt -> {pixel_width}x{pixel_height} px at {dpi} DPI")
            
            # 转换为 PNG 格式
            img_data = pix.tobytes("png")
            
            pages.append({
                "page_num": page_num + 1,
                "total_pages": total_pages,
                "image_bytes": img_data,
                "width": pixel_width,
                "height": pixel_height,
                "pdf_width": pdf_width,
                "pdf_height": pdf_height,
                "dpi": dpi,
            })
        
        doc.close()
    except Exception as e:
        print(f"[OCR] Failed to convert PDF to images: {e}")
    
    return pages


def _pdf_page_to_image(doc, page_num: int, total_pages: int, dpi: int = 150) -> dict:
    """
    将单个 PDF 页面转换为图片（供流水线模式使用）
    """
    page = doc[page_num]
    
    # 获取 PDF 原始页面尺寸
    pdf_rect = page.rect
    pdf_width = pdf_rect.width
    pdf_height = pdf_rect.height
    
    # 渲染为像素图
    import fitz
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat)
    
    # 转换为 PNG 格式
    img_data = pix.tobytes("png")
    
    return {
        "page_num": page_num + 1,
        "total_pages": total_pages,
        "image_bytes": img_data,
        "width": pix.width,
        "height": pix.height,
        "pdf_width": pdf_width,
        "pdf_height": pdf_height,
        "dpi": dpi,
    }


def _get_optimal_workers(reserved_cores: int = 2, max_workers: int = 8) -> int:
    """
    动态计算最优工作线程数
    
    考虑因素：
    1. 系统总 CPU 核心数
    2. 当前 CPU 使用率
    3. 预留核心给其他任务（API、其他 Celery 任务）
    4. 最大工作线程数限制（避免内存过高）
    
    Args:
        reserved_cores: 预留给其他任务的核心数，默认 2
        max_workers: 最大工作线程数，默认 8
    
    Returns:
        int: 推荐的工作线程数
    """
    import os
    import psutil
    
    # 获取 CPU 核心数
    cpu_count = os.cpu_count() or 4
    
    # 获取当前 CPU 使用率
    try:
        cpu_percent = psutil.cpu_percent(interval=0.1)
        # 估算空闲核心数
        idle_cores = int(cpu_count * (100 - cpu_percent) / 100)
    except Exception:
        # 如果 psutil 不可用，假设 50% 空闲
        idle_cores = cpu_count // 2
    
    # 计算可用核心数：空闲核心 - 预留核心
    available_cores = max(1, idle_cores - reserved_cores)
    
    # 取 available_cores 和 max_workers 的较小值
    workers = min(available_cores, max_workers)
    
    # 至少 1 个 worker
    return max(1, workers)


def _pipeline_ocr_process(
    pdf_data: bytes,
    ocr_instance,
    max_pages: int = 0,
    dpi: int = 150,
    batch_size: int = 20,
    progress_callback=None,
) -> tuple:
    """
    流水线模式处理 PDF OCR
    
    使用生产者-消费者模式，CPU 图片转换和 OCR 识别并行执行：
    - 生产者：将 PDF 页面转换为图片（CPU 密集）
    - 消费者：对图片执行 OCR（CPU/GPU 密集）
    
    优化策略：
    1. 动态计算工作线程数，预留核心给其他任务
    2. 批量处理，控制内存占用
    3. 使用队列实现流水线，减少等待时间
    
    Args:
        pdf_data: PDF 文件二进制数据
        ocr_instance: PaddleOCR 实例
        max_pages: 最大处理页数，0 表示所有
        dpi: 渲染 DPI
        batch_size: 每批处理的页数
        progress_callback: 进度回调函数 (processed, total) -> None
    
    Returns:
        tuple: (ocr_pages, full_text, total_pages, processed_pages)
    """
    import fitz
    import tempfile
    import os as _os
    from queue import Queue
    from threading import Thread, Event
    from concurrent.futures import ThreadPoolExecutor
    
    # 打开 PDF
    doc = fitz.open(stream=pdf_data, filetype="pdf")
    total_pages = len(doc)
    pages_to_process = total_pages if max_pages <= 0 else min(total_pages, max_pages)
    
    print(f"[OCR Pipeline] PDF has {total_pages} pages, will process {pages_to_process} pages")
    
    # 获取最优工作线程数
    image_workers = _get_optimal_workers(reserved_cores=2, max_workers=6)
    print(f"[OCR Pipeline] Using {image_workers} workers for image conversion")
    
    # 结果存储
    ocr_pages = [None] * pages_to_process  # 预分配，保持页面顺序
    all_text_parts = []
    processed_count = 0
    
    # 队列：图片转换结果
    image_queue = Queue(maxsize=batch_size * 2)  # 限制队列大小，控制内存
    
    # 完成信号
    conversion_done = Event()
    
    def convert_page(page_num: int) -> dict:
        """转换单个页面为图片"""
        try:
            page = doc[page_num]
            pdf_rect = page.rect
            pdf_width = pdf_rect.width
            pdf_height = pdf_rect.height
            
            mat = fitz.Matrix(dpi / 72, dpi / 72)
            pix = page.get_pixmap(matrix=mat)
            img_data = pix.tobytes("png")
            
            return {
                "page_num": page_num + 1,
                "image_bytes": img_data,
                "width": pix.width,
                "height": pix.height,
                "pdf_width": pdf_width,
                "pdf_height": pdf_height,
                "dpi": dpi,
                "error": None,
            }
        except Exception as e:
            return {
                "page_num": page_num + 1,
                "image_bytes": None,
                "width": 0,
                "height": 0,
                "pdf_width": 0,
                "pdf_height": 0,
                "dpi": dpi,
                "error": str(e),
            }
    
    def image_producer():
        """生产者：批量转换 PDF 页面为图片"""
        
        with ThreadPoolExecutor(max_workers=image_workers) as executor:
            # 分批提交任务
            for batch_start in range(0, pages_to_process, batch_size):
                batch_end = min(batch_start + batch_size, pages_to_process)
                batch_pages = range(batch_start, batch_end)
                
                # 并行转换这一批页面
                futures = {executor.submit(convert_page, p): p for p in batch_pages}
                
                # 收集结果并放入队列
                for future in futures:
                    try:
                        result = future.result(timeout=60)
                        image_queue.put(result)
                    except Exception as e:
                        page_num = futures[future]
                        image_queue.put({
                            "page_num": page_num + 1,
                            "image_bytes": None,
                            "error": str(e),
                        })
        
        conversion_done.set()
        print(f"[OCR Pipeline] Image conversion completed for {pages_to_process} pages")
    
    def ocr_consumer():
        """消费者：对图片执行 OCR"""
        nonlocal processed_count
        
        while True:
            # 检查是否所有图片都已处理完
            if conversion_done.is_set() and image_queue.empty():
                break
            
            try:
                # 从队列获取图片（带超时，避免死锁）
                page_info = image_queue.get(timeout=1)
            except Exception:
                continue
            
            page_num = page_info["page_num"]
            page_idx = page_num - 1
            
            # 如果图片转换失败，记录错误
            if page_info.get("error") or not page_info.get("image_bytes"):
                ocr_pages[page_idx] = {
                    "page_num": page_num,
                    "width": page_info.get("width", 0),
                    "height": page_info.get("height", 0),
                    "pdf_width": page_info.get("pdf_width", 0),
                    "pdf_height": page_info.get("pdf_height", 0),
                    "dpi": page_info.get("dpi", dpi),
                    "regions": [],
                    "text": "",
                    "error": page_info.get("error", "Unknown error"),
                }
                processed_count += 1
                image_queue.task_done()
                continue
            
            # 保存临时文件并执行 OCR
            fd, temp_path = tempfile.mkstemp(suffix='.png')
            try:
                _os.write(fd, page_info["image_bytes"])
                _os.close(fd)
                
                # 执行 OCR
                page_result = ocr_instance.recognize("", temp_path)
                
                # 构建页面结果
                page_data = {
                    "page_num": page_num,
                    "width": page_info["width"],
                    "height": page_info["height"],
                    "pdf_width": page_info["pdf_width"],
                    "pdf_height": page_info["pdf_height"],
                    "dpi": page_info["dpi"],
                    "regions": page_result.get("regions", []),
                    "text": page_result.get("text", ""),
                }
                ocr_pages[page_idx] = page_data
                
                if page_result.get("text"):
                    all_text_parts.append((page_num, page_result["text"]))
                
                processed_count += 1
                
                # 进度回调
                if progress_callback:
                    progress_callback(processed_count, pages_to_process)
                
                # 日志（每 10 页输出一次）
                if processed_count % 10 == 0 or processed_count == pages_to_process:
                    print(f"[OCR Pipeline] Progress: {processed_count}/{pages_to_process} pages ({processed_count * 100 // pages_to_process}%)")
                
            except Exception as e:
                ocr_pages[page_idx] = {
                    "page_num": page_num,
                    "width": page_info["width"],
                    "height": page_info["height"],
                    "pdf_width": page_info["pdf_width"],
                    "pdf_height": page_info["pdf_height"],
                    "dpi": page_info["dpi"],
                    "regions": [],
                    "text": "",
                    "error": str(e),
                }
                processed_count += 1
            finally:
                try:
                    _os.remove(temp_path)
                except Exception:
                    pass
                image_queue.task_done()
    
    # 启动生产者和消费者线程
    producer_thread = Thread(target=image_producer, name="OCR-ImageProducer")
    consumer_thread = Thread(target=ocr_consumer, name="OCR-Consumer")
    
    print(f"[OCR Pipeline] Starting pipeline processing...")
    start_time = __import__('time').time()
    
    producer_thread.start()
    consumer_thread.start()
    
    # 等待完成
    producer_thread.join()
    consumer_thread.join()
    
    # 关闭 PDF 文档
    doc.close()
    
    elapsed = __import__('time').time() - start_time
    print(f"[OCR Pipeline] Completed in {elapsed:.1f}s, avg {elapsed / pages_to_process:.2f}s per page")
    
    # 整理文本（按页码排序）
    all_text_parts.sort(key=lambda x: x[0])
    full_text_parts = []
    for page_num, text in all_text_parts:
        full_text_parts.append(f"--- Page {page_num} ---")
        full_text_parts.append(text)
    
    # 过滤掉 None（理论上不应该有）
    ocr_pages = [p for p in ocr_pages if p is not None]
    
    return ocr_pages, "\n".join(full_text_parts), total_pages, len(ocr_pages)


def _pdf_to_images(pdf_data: bytes, max_pages: int = 0, dpi: int = 150) -> tuple:
    """
    将 PDF 转换为图片列表，用于 OCR（兼容旧接口）
    Args:
        pdf_data: PDF 文件二进制数据
        max_pages: 最大处理页数，0 表示处理所有页面
        dpi: 渲染分辨率
    Returns:
        (images, image_width, image_height)
        images: [(page_num, image_bytes, total_pages), ...]
        image_width, image_height: 第一页的渲染尺寸（像素）
    """
    pages = _pdf_to_images_with_sizes(pdf_data, max_pages, dpi)
    if not pages:
        return [], 0, 0
    
    images = [(p["page_num"], p["image_bytes"], p["total_pages"]) for p in pages]
    return images, pages[0]["width"], pages[0]["height"]


@shared_task(name="tasks.process_book_ocr")
def process_book_ocr(book_id: str, user_id: str):
    """
    处理书籍 OCR 任务（双层 PDF 生成模式）
    
    **架构重构说明**：
    - 旧方案：生成 JSON，前端渲染透明 DOM（存在文字对齐问题）
    - 新方案：后端生成双层 PDF (Invisible Text Layer)，前端直接使用 react-pdf 渲染
    
    优化策略：
    1. 使用生产者-消费者模式：CPU 图片转换和 OCR 识别并行执行
    2. 动态计算工作线程数，预留核心给其他任务
    3. 借助 OCRmyPDF-PaddleOCR 插件生成透明文字层（pikepdf + ContentStreamBuilder）
    4. 生成的双层 PDF 替换原文件，前端无需额外处理
    
    流程:
    1. 更新状态为 processing
    2. 下载原始 PDF 文件
    3. 流水线处理：图片转换 → OCR（并行）
    4. OCRmyPDF 插件写入透明文字层，保持 PaddleOCR 原始坐标
    5. 上传新的双层 PDF 到 MinIO (layered/{book_id}.pdf)
    6. 更新数据库：minio_key 指向新文件，备份原始 key
    7. 触发搜索索引
    8. WebSocket 通知前端清理旧缓存
    
    双层 PDF 优势：
    - 文字位置由 PDF 引擎精确控制，完美对齐
    - 前端无需维护 OCR 层组件
    - 支持所有 PDF 阅读器的标准文字选择
    """
    import asyncio
    
    print(f"[OCR] Starting OCR task for book {book_id} (Layered PDF Mode)")

    def _embed_ocr_text_to_pdf_with_paddle_plugin(pdf_data: bytes, ocr_pages: list) -> bytes:
        """
        使用 OCRmyPDF-PaddleOCR 插件将 PaddleOCR 识别的文字嵌入 PDF 作为透明文字层
        
        核心优势（完全参照 OCRmyPDF-EasyOCR 实现）：
        1. 使用 pikepdf + ContentStreamBuilder 精确控制 PDF 文本流
        2. 使用 PaddleOCR 的精确多边形坐标（polygon）
        3. 支持旋转文本（使用 Tm 文本矩阵）
        4. 透明文字层（Rendering Mode 3）完美覆盖原图
        5. 行业验证的坐标映射算法（从 OCRmyPDF-EasyOCR）
        
        Args:
            pdf_data: 原始 PDF 二进制数据
            ocr_pages: OCR 结果列表（PaddleOCR格式，包含精确坐标）
        
        Returns:
            bytes: 嵌入文字层后的 PDF 二进制数据
        """
        import tempfile
        import time as _time
        from pathlib import Path
        from app.services.ocrmypdf_paddle import create_layered_pdf_with_paddle
        
        start_time = _time.time()
        print(f"[PaddleOCR Plugin] Starting to embed text layer using OCRmyPDF-PaddleOCR plugin...")
        
        try:
            # 保存原始 PDF 到临时文件
            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as temp_in:
                temp_in.write(pdf_data)
                temp_in_path = temp_in.name
            
            # 输出文件路径
            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as temp_out:
                temp_out_path = temp_out.name
            
            # 使用 PaddleOCR 插件生成双层 PDF
            success = create_layered_pdf_with_paddle(
                pdf_path=temp_in_path,
                output_path=temp_out_path,
                ocr_pages=ocr_pages
            )
            
            if not success:
                raise Exception("Failed to create layered PDF with PaddleOCR plugin")
            
            # 读取结果
            with open(temp_out_path, 'rb') as f:
                result_data = f.read()
            
            # 清理临时文件
            import os
            try:
                os.remove(temp_in_path)
                os.remove(temp_out_path)
            except Exception:
                pass
            
            elapsed = _time.time() - start_time
            total_regions = sum(len(p.get('regions', [])) for p in ocr_pages)
            print(f"[PaddleOCR Plugin] Successfully embedded {total_regions} text regions in {elapsed:.1f}s")
            
            return result_data
            
        except Exception as e:
            import traceback
            print(f"[PaddleOCR Plugin] Failed to embed text layer: {e}")
            traceback.print_exc()
            raise Exception(f"PaddleOCR Plugin text embedding failed: {e}")

    async def _run():
        # 【关键修复】先获取书籍信息并更新状态为 processing，立即提交
        async with engine.begin() as conn:
            await conn.execute(
                text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
            )
            
            # 获取书籍信息
            res = await conn.execute(
                text("SELECT minio_key, title FROM books WHERE id = cast(:id as uuid)"),
                {"id": book_id},
            )
            row = res.fetchone()
            if not row:
                print(f"[OCR] Book not found: {book_id}")
                return
            
            minio_key, book_title = row
            
            # 更新状态为 processing（此事务结束后立即提交）
            await conn.execute(
                text("""
                    UPDATE books 
                    SET ocr_status = 'processing', updated_at = now() 
                    WHERE id = cast(:id as uuid)
                """),
                {"id": book_id}
            )
        # 事务已提交，状态更新对前端可见
        
        original_minio_key = minio_key  # 保存原始 key 用于备份
        print(f"[OCR] Processing: {book_title} ({minio_key})")
        
        # 【关键优化】下载和 OCR 处理在事务外进行，避免长事务
        # 3. 下载 PDF
        pdf_data = read_full(BUCKET, minio_key)
        if not pdf_data:
            print(f"[OCR] Failed to download PDF: {minio_key}")
            async with engine.begin() as conn:
                await conn.execute(
                    text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
                )
                await conn.execute(
                    text("UPDATE books SET ocr_status = 'failed', updated_at = now() WHERE id = cast(:id as uuid)"),
                    {"id": book_id}
                )
            return
        
        print(f"[OCR] Downloaded PDF: {len(pdf_data)} bytes")
        
        # 4. 使用流水线模式处理 OCR
        ocr = get_ocr()
        
        try:
            ocr_pages, full_text, total_pages, processed_pages = _pipeline_ocr_process(
                pdf_data=pdf_data,
                ocr_instance=ocr,
                max_pages=0,  # 处理所有页面
                dpi=150,
                batch_size=20,  # 每批 20 页
                progress_callback=None,  # 可以后续添加进度回调
            )
        except Exception as e:
            print(f"[OCR] Pipeline processing failed: {e}")
            async with engine.begin() as conn:
                await conn.execute(
                    text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
                )
                await conn.execute(
                    text("UPDATE books SET ocr_status = 'failed', updated_at = now() WHERE id = cast(:id as uuid)"),
                    {"id": book_id}
                )
            return
        
        if not ocr_pages:
            print(f"[OCR] No pages processed")
            async with engine.begin() as conn:
                await conn.execute(
                    text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
                )
                await conn.execute(
                    text("UPDATE books SET ocr_status = 'failed', updated_at = now() WHERE id = cast(:id as uuid)"),
                    {"id": book_id}
                )
            return
        
        print(f"[OCR] Pipeline completed: {processed_pages}/{total_pages} pages")
        
        # 5. 【核心】生成双层 PDF（使用 OCRmyPDF-PaddleOCR 插件）
        print(f"[OCR] Generating layered PDF with PaddleOCR Plugin (OCRmyPDF-EasyOCR style)...")
        try:
            layered_pdf_data = _embed_ocr_text_to_pdf_with_paddle_plugin(pdf_data, ocr_pages)
            print(f"[OCR] Layered PDF generated: {len(layered_pdf_data)} bytes")
        except Exception as e:
            print(f"[OCR] Failed to generate layered PDF: {e}")
            import traceback
            traceback.print_exc()
            async with engine.begin() as conn:
                await conn.execute(
                    text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
                )
                await conn.execute(
                    text("UPDATE books SET ocr_status = 'failed', updated_at = now() WHERE id = cast(:id as uuid)"),
                    {"id": book_id}
                )
            return
        
        # 6. 上传双层 PDF 到 MinIO
        layered_pdf_key = f"users/{user_id}/layered/{book_id}.pdf"
        try:
            upload_bytes(BUCKET, layered_pdf_key, layered_pdf_data, "application/pdf")
            print(f"[OCR] Uploaded layered PDF: {layered_pdf_key}")
        except Exception as e:
            print(f"[OCR] Failed to upload layered PDF: {e}")
            async with engine.begin() as conn:
                await conn.execute(
                    text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
                )
                await conn.execute(
                    text("UPDATE books SET ocr_status = 'failed', updated_at = now() WHERE id = cast(:id as uuid)"),
                    {"id": book_id}
                )
            return
        
        # 7. 备份原始 PDF 文件
        backup_key = f"users/{user_id}/backups/{book_id}_original.pdf"
        try:
            # 先备份原始文件，然后更新 minio_key 指向双层 PDF
            from .storage import copy_object
            
            # 备份原文件（如果还没备份过）
            try:
                read_head(BUCKET, backup_key)
                print(f"[OCR] Backup already exists: {backup_key}")
            except Exception:
                # 备份不存在，创建备份
                upload_bytes(BUCKET, backup_key, pdf_data, "application/pdf")
                print(f"[OCR] Created backup: {backup_key}")
        except Exception as e:
            print(f"[OCR] Warning: Failed to create backup: {e}")
            # 备份失败不影响后续流程
        
        # 8. 更新数据库记录
        async with engine.begin() as conn:
            await conn.execute(
                text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
            )
            
            # 更新书籍记录：指向双层PDF，并标记OCR完成
            await conn.execute(
                text("""
                    UPDATE books 
                    SET 
                        minio_key = :layered_key,
                        ocr_status = 'completed',
                        ocr_text = :ocr_text,
                        updated_at = now()
                    WHERE id = cast(:id as uuid)
                """),
                {
                    "id": book_id,
                    "layered_key": layered_pdf_key,
                    "ocr_text": full_text[:50000] if full_text else "",  # 限制大小
                }
            )
            
            print(f"[OCR] Successfully completed OCR for book {book_id}")
            print(f"[OCR]   Original: {original_minio_key}")
            print(f"[OCR]   Backup: {backup_key}")
            print(f"[OCR]   Layered PDF: {layered_pdf_key}")
        
        # 9. 触发搜索索引（关键！使书籍内容可搜索）
        try:
            from .search_sync import index_book_content
            # 将 OCR 结果转换为搜索索引需要的格式
            # ocr_pages 格式: [{"page_num": 1, "regions": [{"text": "...", "page": 1}, ...], ...}]
            search_regions = []
            for page_info in ocr_pages:
                page_num = page_info.get("page_num", 1)
                for region in page_info.get("regions", []):
                    search_regions.append({
                        "text": region.get("text", ""),
                        "page": page_num
                    })
            index_book_content(book_id, user_id, search_regions)
            print(f"[OCR] Triggered search indexing for book {book_id} with {len(search_regions)} regions")
        except Exception as e:
            print(f"[OCR] Warning: Failed to index book content for search: {e}")
            # 搜索索引失败不影响整体流程
        
        # 10. 通过 WebSocket 通知前端
        try:
            await ws_broadcast(
                f"book:{book_id}",
                json.dumps({
                    "event": "OCR_COMPLETED",
                    "book_id": book_id,
                    "ocr_status": "completed",
                    "layered_pdf_key": layered_pdf_key,
                    "message": "OCR processing completed successfully"
                })
            )
        except Exception as e:
            print(f"[OCR] Warning: Failed to broadcast WebSocket message: {e}")
            # WebSocket 失败不影响整体流程
        
    
    # 调用异步运行函数
    try:
        asyncio.get_event_loop().run_until_complete(_run())
    except Exception as e:
        print(f"[OCR] Task failed with error: {e}")
        import traceback
        traceback.print_exc()
        # 更新状态为失败
        async def _mark_failed():
            async with engine.begin() as conn:
                await conn.execute(
                    text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
                )
                await conn.execute(
                    text("UPDATE books SET ocr_status = 'failed', updated_at = now() WHERE id = cast(:id as uuid)"),
                    {"id": book_id}
                )
        asyncio.get_event_loop().run_until_complete(_mark_failed())
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
