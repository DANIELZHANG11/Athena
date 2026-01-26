"""
OCR 处理任务模块

包含 PDF OCR 识别相关的 Celery 任务和辅助函数
"""
import asyncio
import json
import os
import tempfile
import time

from celery import shared_task
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from ..db import engine
from ..storage import (
    upload_bytes,
    read_full,
    read_head,
    BUCKET,
)
from ..realtime import ws_broadcast
from .common import _quick_confidence

# 【修复 Event Loop 冲突】为 Celery 任务创建独立的数据库引擎
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://athena:athena_dev@postgres:5432/athena")
def _create_task_engine():
    return create_async_engine(DATABASE_URL, pool_pre_ping=True)


def _get_optimal_workers(reserved_cores: int = 2, max_workers: int = 8) -> int:
    """
    动态计算最优工作线程数
    
    考虑因素：
    1. 系统总 CPU 核心数
    2. 当前 CPU 使用率
    3. 预留核心给其他任务（API、其他 Celery 任务）
    4. 最大工作线程数限制（避免内存过高）
    """
    import psutil
    
    cpu_count = os.cpu_count() or 4
    
    try:
        cpu_percent = psutil.cpu_percent(interval=0.1)
        idle_cores = int(cpu_count * (100 - cpu_percent) / 100)
    except Exception:
        idle_cores = cpu_count // 2
    
    available_cores = max(1, idle_cores - reserved_cores)
    workers = min(available_cores, max_workers)
    
    return max(1, workers)


def _pdf_to_images_with_sizes(pdf_data: bytes, max_pages: int = 0, dpi: int = 150) -> list:
    """
    将 PDF 转换为图片列表，用于 OCR
    **每页单独记录尺寸**，因为 PDF 每页尺寸可能不同
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
            
            pdf_rect = page.rect
            pdf_width = pdf_rect.width
            pdf_height = pdf_rect.height
            
            mat = fitz.Matrix(dpi / 72, dpi / 72)
            pix = page.get_pixmap(matrix=mat)
            
            pixel_width = pix.width
            pixel_height = pix.height
            
            if page_num == 0:
                print(f"[OCR] First page: PDF size {pdf_width:.1f}x{pdf_height:.1f} pt -> {pixel_width}x{pixel_height} px at {dpi} DPI")
            
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


def _pdf_to_images(pdf_data: bytes, max_pages: int = 0, dpi: int = 150) -> tuple:
    """
    将 PDF 转换为图片列表（兼容旧接口）
    Returns:
        (images, image_width, image_height)
        images: [(page_num, image_bytes, total_pages), ...]
    """
    pages = _pdf_to_images_with_sizes(pdf_data, max_pages, dpi)
    if not pages:
        return [], 0, 0
    
    images = [(p["page_num"], p["image_bytes"], p["total_pages"]) for p in pages]
    return images, pages[0]["width"], pages[0]["height"]


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
    """
    import fitz
    from queue import Queue
    from threading import Thread, Event
    from concurrent.futures import ThreadPoolExecutor
    
    doc = fitz.open(stream=pdf_data, filetype="pdf")
    total_pages = len(doc)
    pages_to_process = total_pages if max_pages <= 0 else min(total_pages, max_pages)
    
    print(f"[OCR Pipeline] PDF has {total_pages} pages, will process {pages_to_process} pages")
    
    image_workers = _get_optimal_workers(reserved_cores=2, max_workers=6)
    print(f"[OCR Pipeline] Using {image_workers} workers for image conversion")
    
    ocr_pages = [None] * pages_to_process
    all_text_parts = []
    processed_count = 0
    
    image_queue = Queue(maxsize=batch_size * 2)
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
            for batch_start in range(0, pages_to_process, batch_size):
                batch_end = min(batch_start + batch_size, pages_to_process)
                batch_pages = range(batch_start, batch_end)
                
                futures = {executor.submit(convert_page, p): p for p in batch_pages}
                
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
            if conversion_done.is_set() and image_queue.empty():
                break
            
            try:
                page_info = image_queue.get(timeout=1)
            except Exception:
                continue
            
            page_num = page_info["page_num"]
            page_idx = page_num - 1
            
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
            
            fd, temp_path = tempfile.mkstemp(suffix='.png')
            try:
                os.write(fd, page_info["image_bytes"])
                os.close(fd)
                
                page_result = ocr_instance.recognize("", temp_path)
                
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
                
                if progress_callback:
                    progress_callback(processed_count, pages_to_process)
                
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
                    os.remove(temp_path)
                except Exception:
                    pass
                image_queue.task_done()
    
    producer_thread = Thread(target=image_producer, name="OCR-ImageProducer")
    consumer_thread = Thread(target=ocr_consumer, name="OCR-Consumer")
    
    print(f"[OCR Pipeline] Starting pipeline processing...")
    start_time = time.time()
    
    producer_thread.start()
    consumer_thread.start()
    
    producer_thread.join()
    consumer_thread.join()
    
    doc.close()
    
    elapsed = time.time() - start_time
    print(f"[OCR Pipeline] Completed in {elapsed:.1f}s, avg {elapsed / pages_to_process:.2f}s per page")
    
    all_text_parts.sort(key=lambda x: x[0])
    full_text_parts = []
    for page_num, text in all_text_parts:
        full_text_parts.append(f"--- Page {page_num} ---")
        full_text_parts.append(text)
    
    ocr_pages = [p for p in ocr_pages if p is not None]
    
    return ocr_pages, "\n".join(full_text_parts), total_pages, len(ocr_pages)


@shared_task(name="tasks.analyze_book_type")
def analyze_book_type(book_id: str, user_id: str):
    """
    【已废弃】此任务已被 extract_book_cover_and_metadata 取代
    
    保留此函数仅为向后兼容，实际 PDF 类型检测已整合到元数据提取流程中。
    """
    async def _run():
        engine = _create_task_engine()  # 覆盖全局 engine，避免 Event Loop 冲突
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
            
            await conn.execute(
                text(
                    "UPDATE books SET is_digitalized = true, initial_digitalization_confidence = :c, updated_at = now() WHERE id = cast(:id as uuid)"
                ),
                {"c": conf, "id": book_id},
            )
            print(f"[AnalyzeBookType] Book {book_id}: is_image_based={is_image_based}, confidence={conf:.2f}")
        
        try:
            await ws_broadcast(
                f"book:{book_id}",
                json.dumps({
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
                    text(
                        "INSERT INTO audit_logs(id, owner_id, action, details) VALUES (gen_random_uuid(), cast(:uid as uuid), :act, cast(:det as jsonb))"
                    ),
                    {
                        "uid": user_id,
                        "act": "task_analyze_book_type",
                        "det": json.dumps({"book_id": book_id, "confidence": conf, "is_image_based": is_image_based}),
                    },
                )
        except Exception:
            pass

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_run())
    finally:
        loop.close()


@shared_task(name="tasks.process_book_ocr")
def process_book_ocr(book_id: str, user_id: str):
    """
    处理书籍 OCR 任务（OCRmyPDF + PaddleOCR 插件模式）
    
    **架构重构说明**：
    - 旧方案：手动 PaddleOCR 识别 + 自定义 PDF 文字层生成（存在对齐问题）
    - 新方案：使用 OCRmyPDF + PaddleOCR 官方插件一步到位生成双层 PDF
    
    核心优势：
    1. 使用 OCRmyPDF 的 hocrtransform 生成精确对齐的透明文字层
    2. 支持 return_word_box=True 获取单词级边界框
    3. 自动处理页面旋转、DPI 转换等复杂问题
    4. 代码简洁，维护成本低
    
    参考：
    - https://github.com/ocrmypdf/OCRmyPDF (GitHub 30k+ stars)
    - https://github.com/clefru/ocrmypdf-paddleocr
    """
    from ..services.ocrmypdf_paddleocr_service import ocr_pdf_bytes
    
    print(f"[OCR] Starting OCR task for book {book_id} (OCRmyPDF + PaddleOCR Plugin Mode)")

    async def _run():
        engine = _create_task_engine()  # 覆盖全局 engine，避免 Event Loop 冲突
        # 获取书籍信息并更新状态
        async with engine.begin() as conn:
            await conn.execute(
                text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
            )
            
            res = await conn.execute(
                text("SELECT minio_key, title FROM books WHERE id = cast(:id as uuid)"),
                {"id": book_id},
            )
            row = res.fetchone()
            if not row:
                print(f"[OCR] Book not found: {book_id}")
                return
            
            minio_key, book_title = row
            
            await conn.execute(
                text("""
                    UPDATE books 
                    SET ocr_status = 'processing', updated_at = now() 
                    WHERE id = cast(:id as uuid)
                """),
                {"id": book_id}
            )
        
        original_minio_key = minio_key
        print(f"[OCR] Processing: {book_title} ({minio_key})")
        
        # 下载 PDF
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
        
        # 【新方案】使用 OCRmyPDF + PaddleOCR 插件一步到位生成双层 PDF
        print(f"[OCR] Generating layered PDF with OCRmyPDF + PaddleOCR Plugin...")
        start_time = time.time()
        
        try:
            layered_pdf_data = ocr_pdf_bytes(
                pdf_data=pdf_data,
                language="chi_sim",  # 默认简体中文，可根据书籍语言调整
                use_gpu=False,  # Docker 环境暂不使用 GPU
                force_ocr=True,  # 强制 OCR 所有页面
            )
            
            if not layered_pdf_data:
                raise Exception("OCR returned empty result")
                
            elapsed = time.time() - start_time
            print(f"[OCR] Layered PDF generated in {elapsed:.1f}s: {len(layered_pdf_data)} bytes")
            
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
        
        # 上传双层 PDF
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
        
        # 备份原始 PDF
        backup_key = f"users/{user_id}/backups/{book_id}_original.pdf"
        try:
            try:
                read_head(BUCKET, backup_key)
                print(f"[OCR] Backup already exists: {backup_key}")
            except Exception:
                upload_bytes(BUCKET, backup_key, pdf_data, "application/pdf")
                print(f"[OCR] Created backup: {backup_key}")
        except Exception as e:
            print(f"[OCR] Warning: Failed to create backup: {e}")
        
        # 更新数据库
        async with engine.begin() as conn:
            await conn.execute(
                text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
            )
            
            # 注意：全文搜索通过 OpenSearch 实现，不需要在数据库中存储 ocr_text
            await conn.execute(
                text("""
                    UPDATE books 
                    SET 
                        minio_key = :layered_key,
                        ocr_status = 'completed',
                        updated_at = now()
                    WHERE id = cast(:id as uuid)
                """),
                {
                    "id": book_id,
                    "layered_key": layered_pdf_key,
                }
            )
            
            print(f"[OCR] Successfully completed OCR for book {book_id}")
            print(f"[OCR]   Original: {original_minio_key}")
            print(f"[OCR]   Backup: {backup_key}")
            print(f"[OCR]   Layered PDF: {layered_pdf_key}")
        
        # 触发搜索索引 - 从生成的双层 PDF 中提取文字
        try:
            from ..search_sync import index_book_content
            import fitz  # PyMuPDF
            
            # 从双层 PDF 中提取文字用于搜索索引
            search_regions = []
            try:
                doc = fitz.open(stream=layered_pdf_data, filetype="pdf")
                for page_num in range(len(doc)):
                    page = doc[page_num]
                    text = page.get_text()
                    if text.strip():
                        search_regions.append({
                            "text": text.strip(),
                            "page": page_num + 1
                        })
                doc.close()
            except Exception as extract_err:
                print(f"[OCR] Warning: Failed to extract text from PDF for indexing: {extract_err}")
            
            if search_regions:
                index_book_content(book_id, user_id, search_regions)
                print(f"[OCR] Triggered search indexing for book {book_id} with {len(search_regions)} pages")
            else:
                print(f"[OCR] Warning: No text extracted for search indexing")
        except Exception as e:
            print(f"[OCR] Warning: Failed to index book content for search: {e}")
        
        # WebSocket 通知
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
    
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_run())
    except Exception as e:
        print(f"[OCR] Task failed with error: {e}")
        import traceback
        traceback.print_exc()
        
        async def _mark_failed():
            async with engine.begin() as conn:
                await conn.execute(
                    text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
                )
                await conn.execute(
                    text("UPDATE books SET ocr_status = 'failed', updated_at = now() WHERE id = cast(:id as uuid)"),
                    {"id": book_id}
                )
        loop_fallback = asyncio.new_event_loop()
        asyncio.set_event_loop(loop_fallback)
        try:
            loop_fallback.run_until_complete(_mark_failed())
        finally:
            loop_fallback.close()
