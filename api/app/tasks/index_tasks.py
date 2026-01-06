"""
书籍向量索引 Celery 任务

在书籍上传完成后自动创建向量索引，支持：
- EPUB 文本提取
- PDF 文本提取（文字型）
- OCR 完成后的 PDF 索引
"""

import asyncio
import io
import logging
import os
import zipfile

from celery import shared_task
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.services.llama_rag import index_book_chunks, delete_book_index
from app.storage import get_storage_client, read_full, BUCKET

logger = logging.getLogger(__name__)

# 数据库连接配置
DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql+asyncpg://athena:athena_dev@postgres:5432/athena"
)


def _create_task_engine():
    """
    为 Celery 任务创建独立的数据库引擎
    
    每个任务使用独立的引擎，避免与全局 engine 的 Event Loop 冲突
    """
    return create_async_engine(DATABASE_URL, pool_pre_ping=True)




# ============================================================================
# 文本提取工具
# ============================================================================


def extract_epub_text(epub_bytes: bytes) -> str:
    """从 EPUB 提取文本"""
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        logger.error("[IndexBook] BeautifulSoup not installed")
        return ""
    
    text_content = []
    
    try:
        with zipfile.ZipFile(io.BytesIO(epub_bytes), 'r') as zf:
            for name in zf.namelist():
                if name.endswith(('.html', '.xhtml', '.htm')):
                    try:
                        html_content = zf.read(name).decode('utf-8', errors='ignore')
                        soup = BeautifulSoup(html_content, 'html.parser')
                        
                        # 移除脚本和样式
                        for tag in soup(['script', 'style', 'nav', 'head']):
                            tag.decompose()
                        
                        text = soup.get_text(separator='\n', strip=True)
                        if text:
                            text_content.append(text)
                    except Exception as e:
                        logger.warning(f"[IndexBook] Failed to parse {name}: {e}")
    except Exception as e:
        logger.error(f"[IndexBook] Failed to extract EPUB: {e}")
    
    return '\n\n'.join(text_content)


def extract_pdf_text(pdf_bytes: bytes) -> str:
    """从 PDF 提取文本（仅文字型 PDF）"""
    try:
        import fitz  # PyMuPDF
        
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        text_content = []
        
        for page_num in range(len(doc)):
            page = doc[page_num]
            text = page.get_text()
            if text.strip():
                text_content.append(f"--- Page {page_num + 1} ---\n{text}")
        
        doc.close()
        return '\n\n'.join(text_content)
    except ImportError:
        logger.error("[IndexBook] PyMuPDF not installed")
        return ""
    except Exception as e:
        logger.error(f"[IndexBook] Failed to extract PDF: {e}")
        return ""


# ============================================================================
# 异步索引逻辑
# ============================================================================


async def _index_book_async(book_id: str) -> dict:
    """异步索引单本书籍"""
    # 为每个任务创建独立的数据库引擎，避免 Event Loop 冲突
    task_engine = _create_task_engine()
    try:
        async with task_engine.begin() as conn:
            # 获取书籍信息
            result = await conn.execute(
                text("""
                    SELECT id, user_id, title, author, minio_key, original_format,
                           is_digitalized, ocr_status, vector_indexed_at
                    FROM books 
                    WHERE id = :book_id AND deleted_at IS NULL
                """),
                {"book_id": book_id}
            )
            book = result.fetchone()
            
            if not book:
                return {"status": "error", "message": "Book not found"}
            
            (
                book_uuid, user_id, title, author, minio_key, 
                original_format, is_digitalized, ocr_status, vector_indexed_at
            ) = book
            
            # 检查是否需要索引
            # 图片型 PDF 需要先完成 OCR
            if original_format == 'pdf' and is_digitalized is False and ocr_status != 'completed':
                return {"status": "skipped", "message": "Image-based PDF needs OCR first"}
            
            # 下载文件
            try:
                file_bytes = await asyncio.to_thread(
                    read_full,
                    BUCKET,
                    minio_key
                )
                if not file_bytes:
                    raise Exception("Empty file content")
            except Exception as e:
                logger.error(f"[IndexBook] Failed to download {minio_key}: {e}")
                return {"status": "error", "message": f"Download failed: {e}"}
            
            # 提取文本
            if original_format == 'epub' or (minio_key and minio_key.endswith('.epub')):
                text_content = extract_epub_text(file_bytes)
            elif original_format == 'pdf' or (minio_key and minio_key.endswith('.pdf')):
                text_content = extract_pdf_text(file_bytes)
            else:
                return {"status": "skipped", "message": f"Unsupported format: {original_format}"}
            
            if not text_content or len(text_content) < 100:
                return {"status": "skipped", "message": "Insufficient text content"}
            
            # 创建向量索引
            try:
                chunks_count = await index_book_chunks(
                    book_id=str(book_uuid),
                    user_id=str(user_id),
                    text_content=text_content,
                    book_title=title,
                )
                
                # 更新 vector_indexed_at
                await conn.execute(
                    text("""
                        UPDATE books 
                        SET vector_indexed_at = NOW()
                        WHERE id = :book_id
                    """),
                    {"book_id": book_uuid}
                )
                
                return {
                    "status": "success",
                    "book_id": str(book_uuid),
                    "title": title,
                    "chunks_indexed": chunks_count,
                }
            except Exception as e:
                logger.error(f"[IndexBook] Indexing failed for {book_id}: {e}")
                return {"status": "error", "message": str(e)}
    finally:
        # 确保关闭引擎连接
        await task_engine.dispose()



# ============================================================================
# Celery 任务
# ============================================================================


@shared_task(name="tasks.index_book_vectors", bind=True)
def index_book_vectors(self, book_id: str) -> dict:
    """
    为书籍创建向量索引
    
    触发时机：
    1. EPUB 书籍上传完成
    2. 文字型 PDF 元数据提取完成
    3. 格式转换 (MOBI/AZW3 → EPUB) 完成
    4. OCR 任务完成
    """
    logger.info(f"[IndexBook] Starting vector indexing for book {book_id}")
    
    try:
        # 【修复】使用新的 Event Loop 避免连接复用问题
        # Celery worker 中 asyncio.run() 可能复用旧的数据库/OpenSearch 连接
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result = loop.run_until_complete(_index_book_async(book_id))
        finally:
            loop.close()
        logger.info(f"[IndexBook] Result for {book_id}: {result}")
        return result
    except Exception as e:
        logger.error(f"[IndexBook] Task failed: {e}")
        raise


@shared_task(name="tasks.delete_book_vectors", bind=True)
def delete_book_vectors(self, book_id: str) -> dict:
    """删除书籍的向量索引"""
    logger.info(f"[IndexBook] Deleting vectors for book {book_id}")
    
    try:
        # 使用新的 Event Loop 避免连接复用问题
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            success = loop.run_until_complete(delete_book_index(book_id))
        finally:
            loop.close()
        return {"status": "success" if success else "error", "book_id": book_id}
    except Exception as e:
        logger.error(f"[IndexBook] Task failed: {e}")
        raise
