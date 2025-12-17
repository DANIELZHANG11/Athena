"""
书籍模块共享基础设施

包含：
- 共享导入
- 配置常量
- 工具函数
"""
import os
import uuid
import hashlib

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

from ..auth import require_user
from ..celery_app import celery_app
from ..db import engine
from ..dependencies import require_upload_permission, require_write_permission
from ..search_sync import delete_book as delete_book_from_index
from ..search_sync import index_book
from ..storage import (
    delete_object,
    ensure_bucket,
    get_s3,
    make_object_key,
    presigned_get,
    presigned_put,
    read_head,
    read_full,
    stat_etag,
    upload_bytes,
)
from ..services.book_service import get_upload_url as svc_get_upload_url, create_book as svc_create_book
from ..ws import broadcast as ws_broadcast

# ============================================================================
# 配置常量
# ============================================================================

BOOKS_BUCKET = os.getenv("MINIO_BUCKET", "athena")
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)

# ============================================================================
# 工具函数
# ============================================================================

def _quick_confidence(bucket: str, key: str) -> tuple[bool, float]:
    """
    快速检测 PDF 是否为图片型。
    
    使用 PyMuPDF 检查前 6 页的文本内容，这比检查字节头更可靠。
    
    返回 (is_image_based, confidence):
    - is_image_based: 是否为图片型 PDF
    - confidence: 置信度，用于前端判断（confidence < 0.8 表示图片型）
    """
    try:
        import fitz  # PyMuPDF
        
        # 获取文件数据
        pdf_data = None
        if isinstance(key, str) and key.startswith("http"):
            import urllib.request
            try:
                with urllib.request.urlopen(key) as resp:
                    pdf_data = resp.read()
            except Exception:
                pdf_data = None
        else:
            pdf_data = read_full(bucket, key)
        
        if not pdf_data:
            return (False, 0.0)
        
        # 非 PDF 文件直接返回数字型
        if not key.lower().endswith('.pdf'):
            return (False, 1.0)  # 非 PDF 默认是数字型
        
        # 使用 PyMuPDF 提取前 6 页文本
        doc = fitz.open(stream=pdf_data, filetype="pdf")
        total_pages = len(doc)
        pages_to_check = min(6, total_pages)
        
        total_chars = 0
        meaningful_chars = 0
        
        for i in range(pages_to_check):
            page = doc[i]
            text_content = page.get_text()
            
            if text_content:
                total_chars += len(text_content)
                # 统计有意义的字符（中文、英文字母）
                import re
                cjk = len(re.findall(r'[\u4e00-\u9fff]', text_content))
                latin = len(re.findall(r'[A-Za-z]', text_content))
                meaningful_chars += cjk + latin
        
        doc.close()
        
        # 计算比例
        if total_chars == 0:
            # 完全没有文本，是纯图片型
            return (True, 0.1)
        
        ratio = meaningful_chars / max(1, total_chars)
        
        # 判断标准：
        # - 如果有意义字符占比 < 5%，认为是图片型
        # - 每页平均文本少于 50 字符，也认为是图片型
        avg_chars_per_page = total_chars / pages_to_check
        
        is_image_based = ratio < 0.05 or avg_chars_per_page < 50
        
        # confidence 规则：
        # - 图片型：confidence < 0.8
        # - 数字型：confidence >= 0.8
        if is_image_based:
            conf = max(0.1, min(0.5, ratio * 5.0))  # 图片型 conf 最高 0.5
        else:
            conf = max(0.8, min(1.0, 0.8 + ratio * 0.2))  # 数字型 conf 最低 0.8
        
        print(f"[PDF Detection] {key}: {pages_to_check} pages, {total_chars} chars, ratio={ratio:.3f}, avg={avg_chars_per_page:.0f}, is_image={is_image_based}, conf={conf:.2f}")
        return (is_image_based, conf)
        
    except Exception as e:
        print(f"[PDF Detection] Error: {e}")
        return (False, 0.0)
