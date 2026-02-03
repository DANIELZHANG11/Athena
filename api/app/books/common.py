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
    
    【重要】不能只检查前几页，因为封面、版权页、目录等通常没有正文文字。
    采用固定页码抽样：第5、6、7、15、20页（0-indexed: 4、5、6、14、19）
    这样既跳过了前几页，又避免了大面积抽取。
    
    返回 (is_image_based, confidence):
    - is_image_based: 是否为图片型 PDF
    - confidence: 置信度，用于前端判断（confidence < 0.8 表示图片型）
    """
    try:
        import fitz  # PyMuPDF
        import re
        
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
        
        # 使用 PyMuPDF 打开 PDF
        doc = fitz.open(stream=pdf_data, filetype="pdf")
        total_pages = len(doc)
        
        if total_pages == 0:
            doc.close()
            return (True, 0.1)  # 空 PDF
        
        # 【固定页码抽样】第5、6、7、15、20页 (0-indexed: 4、5、6、14、19)
        # 跳过前4页（封面、版权、目录），检查正文区域
        SAMPLE_PAGES = [4, 5, 6, 14, 19]  # 0-indexed
        
        # 过滤掉超出范围的页码
        pages_to_check = [p for p in SAMPLE_PAGES if p < total_pages]
        
        # 如果 PDF 页数太少（< 5页），回退到检查所有页
        if len(pages_to_check) == 0:
            pages_to_check = list(range(total_pages))
        
        total_chars = 0
        meaningful_chars = 0
        pages_with_text = 0  # 有实质文字的页面数
        
        for page_idx in pages_to_check:
            page = doc[page_idx]
            text_content = page.get_text()
            
            if text_content:
                page_chars = len(text_content)
                total_chars += page_chars
                
                # 统计有意义的字符（中文、日文、韩文、英文字母）
                cjk = len(re.findall(r'[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]', text_content))
                latin = len(re.findall(r'[A-Za-z]', text_content))
                page_meaningful = cjk + latin
                meaningful_chars += page_meaningful
                
                # 每页超过 100 个有意义字符算有实质文字
                if page_meaningful > 100:
                    pages_with_text += 1
        
        doc.close()
        
        checked_count = len(pages_to_check)
        
        # 计算比例
        if total_chars == 0:
            # 完全没有文本，是纯图片型
            print(f"[PDF Detection] {key}: checked pages {[p+1 for p in pages_to_check]}/{total_pages}, NO TEXT → Image-based")
            return (True, 0.1)
        
        ratio = meaningful_chars / max(1, total_chars)
        avg_chars_per_page = total_chars / checked_count
        text_page_ratio = pages_with_text / checked_count  # 有文字页面的比例
        
        # 【判断标准】
        # 主要依据：有实质文字页面的比例
        # - 如果 >= 50% 的采样页面有实质内容（> 100 字符），认为是文字型
        # - 或者平均每页字符数 >= 200 且有意义字符比例 >= 10%
        is_text_based = text_page_ratio >= 0.5 or (ratio >= 0.1 and avg_chars_per_page >= 200)
        is_image_based = not is_text_based
        
        # confidence 规则：
        # - 图片型：confidence < 0.8
        # - 数字型：confidence >= 0.8
        if is_image_based:
            conf = max(0.1, min(0.7, text_page_ratio * 0.8))
        else:
            conf = max(0.8, min(1.0, 0.8 + text_page_ratio * 0.2))
        
        sample_pages_display = [p + 1 for p in pages_to_check]  # 显示为1-indexed
        print(f"[PDF Detection] {key}: checked pages {sample_pages_display}/{total_pages}, "
              f"chars={total_chars}, meaningful_ratio={ratio:.3f}, avg={avg_chars_per_page:.0f}, "
              f"text_pages={pages_with_text}/{checked_count}, is_image={is_image_based}, conf={conf:.2f}")
        return (is_image_based, conf)
        
    except Exception as e:
        print(f"[PDF Detection] Error: {e}")
        import traceback
        traceback.print_exc()
        return (False, 0.0)
