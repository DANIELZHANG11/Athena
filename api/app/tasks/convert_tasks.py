"""
格式转换任务模块

包含使用 Calibre 进行格式转换的 Celery 任务
"""
import asyncio
import json
import os
import time

from celery import shared_task
from sqlalchemy import text

from ..db import engine
from ..celery_app import celery_app
from ..storage import (
    get_s3,
    ensure_bucket,
    upload_bytes,
    make_object_key,
    BUCKET,
)
from ..realtime import ws_broadcast

# Calibre 共享卷目录
CALIBRE_BOOKS_DIR = os.environ.get("CALIBRE_CONVERT_DIR", "/calibre_books")


@shared_task(name="tasks.convert_to_epub")
def convert_to_epub(book_id: str, user_id: str):
    """
    使用 Calibre 容器将非 EPUB/PDF 格式的书籍转换为 EPUB
    通过共享卷与 Calibre 容器交互，然后轮询等待转换完成
    
    状态流转：pending -> processing -> completed/failed
    
    【重要】每个数据库操作使用独立事务，避免长事务问题
    """
    import uuid as _uuid
    
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
                asyncio.create_task(
                    ws_broadcast(
                        f"book:{book_id}",
                        json.dumps({"event": "CONVERTED_TO_EPUB", "epub_key": epub_key}),
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
