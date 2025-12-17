"""
Celery 任务模块 - 共享基础设施

包含：
- 共享导入
- 配置常量
- 工具函数（图片优化、元数据提取等）
"""
import json
import os
import io
import tempfile
import zipfile

from celery import shared_task
from sqlalchemy import text
from sqlalchemy import text as _text

from ..db import engine
from ..services import get_ocr
from ..storage import make_object_key, read_head, read_full, upload_bytes, get_s3, ensure_bucket, presigned_get
from ..ws import broadcast as ws_broadcast

# ============================================================================
# 配置常量
# ============================================================================

BUCKET = os.getenv("MINIO_BUCKET", "athena")
CALIBRE_HOST = os.getenv("CALIBRE_HOST", "calibre")
CALIBRE_BOOKS_DIR = os.getenv("CALIBRE_CONVERT_DIR", "/calibre_books")

# ============================================================================
# 工具函数
# ============================================================================

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
            opf_path = None
            for name in zf.namelist():
                if name.endswith('.opf'):
                    opf_path = name
                    break
            
            if opf_path:
                opf_content = zf.read(opf_path).decode('utf-8', errors='ignore')
                
                import re
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
                        opf_dir = os.path.dirname(opf_path)
                        if opf_dir:
                            cover_path = f"{opf_dir}/{cover_href}"
                        else:
                            cover_path = cover_href
                        
                        for name in zf.namelist():
                            if name.endswith(cover_href) or name == cover_path:
                                return zf.read(name)
            
            cover_names = ['cover.jpg', 'cover.jpeg', 'cover.png', 'Cover.jpg', 'Cover.jpeg', 'Cover.png']
            for name in zf.namelist():
                for cover_name in cover_names:
                    if name.endswith(cover_name):
                        return zf.read(name)
            
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
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
            img_data = pix.tobytes("jpeg")
            doc.close()
            return img_data
    except Exception as e:
        print(f"[Cover] Failed to extract PDF cover: {e}")
    return None


def run_async(coro):
    """在同步任务中运行异步代码"""
    import asyncio
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)
