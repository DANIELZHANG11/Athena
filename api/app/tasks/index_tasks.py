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
# EPUB 标准解析工具（支持 EPUB 2.x/3.x）
# ============================================================================

import xml.etree.ElementTree as ET
import re


def _parse_toc_ncx(zf: zipfile.ZipFile) -> dict:
    """
    解析 toc.ncx 获取章节映射（EPUB 2.x 标准，EPUB 3.x 向后兼容）
    
    NCX (Navigation Center eXtended) 是 DAISY 标准的一部分，被 EPUB 2.x 采用。
    即使在 EPUB 3.x 中，大多数生成工具也会保留 toc.ncx 以兼容旧阅读器。
    
    Returns:
        dict: {normalized_href: chapter_title, ...}
              href 会被规范化为不含锚点的相对路径
    """
    chapter_map = {}
    
    # 查找 toc.ncx
    ncx_path = None
    for name in zf.namelist():
        if name.lower().endswith('toc.ncx'):
            ncx_path = name
            break
    
    if not ncx_path:
        logger.debug("[EPUB-NCX] toc.ncx not found")
        return {}
    
    try:
        ncx_content = zf.read(ncx_path).decode('utf-8', errors='ignore')
        root = ET.fromstring(ncx_content)
        
        # NCX 命名空间
        ns = {'ncx': 'http://www.daisy.org/z3986/2005/ncx/'}
        
        # 获取 ncx 文件的目录，用于解析相对路径
        ncx_dir = os.path.dirname(ncx_path)
        
        # 解析 navMap 中的 navPoint
        for navpoint in root.findall('.//ncx:navPoint', ns):
            # 获取标题
            label = navpoint.find('.//ncx:text', ns)
            if label is None or not label.text:
                continue
            title = label.text.strip()
            
            # 获取 href
            content = navpoint.find('ncx:content', ns)
            if content is None:
                continue
            src = content.get('src', '')
            if not src:
                continue
            
            # 规范化 href：
            # 1. 移除锚点（#section1 等）
            # 2. 解析相对路径（相对于 ncx 文件位置）
            href = src.split('#')[0]
            if ncx_dir and not href.startswith('/'):
                href = os.path.normpath(os.path.join(ncx_dir, href)).replace('\\', '/')
            
            # 存储映射（只保留第一次出现的标题，避免子章节覆盖父章节）
            if href not in chapter_map:
                chapter_map[href] = title
                logger.debug(f"[EPUB-NCX] {href} -> {title[:30]}")
        
        logger.info(f"[EPUB-NCX] Parsed {len(chapter_map)} chapters from toc.ncx")
    except Exception as e:
        logger.warning(f"[EPUB-NCX] Failed to parse toc.ncx: {e}")
    
    return chapter_map


def _parse_nav_xhtml(zf: zipfile.ZipFile) -> dict:
    """
    解析 nav.xhtml 获取章节映射（EPUB 3.x 标准）
    
    Navigation Document 使用 HTML5 的 <nav> 元素，包含 epub:type="toc" 属性。
    
    Returns:
        dict: {normalized_href: chapter_title, ...}
    """
    chapter_map = {}
    
    # 查找 nav.xhtml 或类似文件
    nav_path = None
    for name in zf.namelist():
        lower_name = name.lower()
        # 标准命名
        if 'nav.xhtml' in lower_name or 'nav.html' in lower_name:
            nav_path = name
            break
        # 某些出版社使用 toc.html
        elif 'toc.xhtml' in lower_name or 'toc.html' in lower_name:
            nav_path = name
    
    if not nav_path:
        logger.debug("[EPUB-NAV] nav.xhtml not found")
        return {}
    
    try:
        from bs4 import BeautifulSoup
        
        nav_content = zf.read(nav_path).decode('utf-8', errors='ignore')
        soup = BeautifulSoup(nav_content, 'html.parser')
        
        nav_dir = os.path.dirname(nav_path)
        
        # 查找 <nav epub:type="toc"> 或 <nav role="doc-toc">
        toc_nav = soup.find('nav', attrs={'epub:type': 'toc'})
        if not toc_nav:
            toc_nav = soup.find('nav', attrs={'role': 'doc-toc'})
        if not toc_nav:
            # 回退：查找任意 nav 元素
            toc_nav = soup.find('nav')
        
        if not toc_nav:
            logger.debug("[EPUB-NAV] No <nav> element found")
            return {}
        
        # 解析所有链接
        for a_tag in toc_nav.find_all('a', href=True):
            href = a_tag.get('href', '')
            title = a_tag.get_text(strip=True)
            
            if not href or not title:
                continue
            
            # 规范化 href
            href = href.split('#')[0]
            if nav_dir and not href.startswith('/') and not href.startswith('http'):
                href = os.path.normpath(os.path.join(nav_dir, href)).replace('\\', '/')
            
            if href not in chapter_map:
                chapter_map[href] = title
                logger.debug(f"[EPUB-NAV] {href} -> {title[:30]}")
        
        logger.info(f"[EPUB-NAV] Parsed {len(chapter_map)} chapters from nav.xhtml")
    except Exception as e:
        logger.warning(f"[EPUB-NAV] Failed to parse nav.xhtml: {e}")
    
    return chapter_map


def _extract_title_from_html(soup, html_content: str, fallback_index: int) -> str:
    """
    从 HTML 内容中提取章节标题（回退方案）
    
    当 toc.ncx 和 nav.xhtml 都不可用时使用此方法。
    
    优先级：
    1. <body> 中的 <h1>
    2. <body> 中的 <h2>
    3. 带有 chapter/title/heading class 的元素
    4. 正文开头的章节模式匹配
    5. 默认 "Section {index}"
    """
    from bs4 import BeautifulSoup
    
    section_title = None
    
    # 1. 在 body 中查找 h1/h2
    body = soup.find('body')
    if body:
        h1_tag = body.find('h1')
        if h1_tag:
            section_title = h1_tag.get_text(strip=True)
        else:
            h2_tag = body.find('h2')
            if h2_tag:
                section_title = h2_tag.get_text(strip=True)
            else:
                # 尝试查找带有特定 class 的标题元素
                for cls in ['chapter-title', 'chapter', 'title', 'heading', 'head']:
                    title_elem = body.find(class_=lambda x: x and cls in str(x).lower())
                    if title_elem:
                        section_title = title_elem.get_text(strip=True)
                        break
    
    # 2. 从正文开头提取章节标题
    if not section_title:
        temp_soup = BeautifulSoup(html_content, 'html.parser')
        for tag in temp_soup(['script', 'style', 'nav', 'head']):
            tag.decompose()
        first_lines = temp_soup.get_text(strip=True)[:200]
        
        # 扩展的章节匹配模式：
        # - 第X章/节/篇/回/卷/集/部
        # - 第X讲/课/单元（教材类）
        # - Chapter X / Lesson X（英文）
        # - 数字编号（1. / 1、/ 一、）
        chapter_patterns = [
            r'^(第[一二三四五六七八九十百千万零\d]+[章节篇回卷集部讲课单元][\s\S]{0,50})',  # 中文章节
            r'^(Chapter\s+\d+[\s\S]{0,50})',  # 英文 Chapter
            r'^(Lesson\s+\d+[\s\S]{0,50})',   # 英文 Lesson
            r'^(第[一二三四五六七八九十\d]+[单元][\s\S]{0,50})',  # 单元
            r'^([一二三四五六七八九十]+[、\.]\s*[\s\S]{0,50})',  # 中文数字编号
            r'^(\d+[、\.]\s*[\s\S]{0,50})',   # 阿拉伯数字编号
        ]
        
        for pattern in chapter_patterns:
            match = re.match(pattern, first_lines, re.IGNORECASE)
            if match:
                section_title = match.group(1).split('\n')[0].strip()
                break
    
    # 3. 最终兜底
    if not section_title or len(section_title) < 2:
        section_title = f"Section {fallback_index}"
    
    return section_title[:100]  # 限制长度


def extract_epub_text_with_sections(epub_bytes: bytes) -> list:
    """
    从 EPUB 提取文本，保留章节信息
    
    【EPUB 标准兼容】遵循 EPUB 2.x/3.x 标准的多层回退策略：
    
    优先级 1: 解析 toc.ncx (EPUB 2.x 标准，EPUB 3.x 保留以向后兼容)
    优先级 2: 解析 nav.xhtml (EPUB 3.x Navigation Document 标准)
    优先级 3: 从 HTML 内容中提取 (h1/h2/正则匹配)
    
    Returns:
        list of dict: [{"section_index": 0, "text": "...", "title": "第一章 开始", "section_href": "..."}, ...]
    """
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        logger.error("[IndexBook] BeautifulSoup not installed")
        return []
    
    sections = []
    
    try:
        with zipfile.ZipFile(io.BytesIO(epub_bytes), 'r') as zf:
            all_files = zf.namelist()
            
            # ================================================================
            # 第一步：尝试从 EPUB 标准导航文件获取章节映射
            # ================================================================
            
            # 优先解析 toc.ncx (覆盖率更高，约 100% 的 EPUB 都有)
            chapter_map = _parse_toc_ncx(zf)
            nav_source = "toc.ncx"
            
            # 如果 toc.ncx 为空，尝试 nav.xhtml
            if not chapter_map:
                chapter_map = _parse_nav_xhtml(zf)
                nav_source = "nav.xhtml"
            
            if chapter_map:
                logger.info(f"[IndexBook] Using chapter titles from {nav_source}")
            else:
                logger.info("[IndexBook] No navigation file found, using HTML extraction")
            
            # ================================================================
            # 第二步：识别 HTML 文件
            # ================================================================
            
            html_files = []
            for name in all_files:
                lower_name = name.lower()
                if lower_name.endswith(('.html', '.xhtml', '.htm')):
                    html_files.append(name)
                elif '/xhtml/' in lower_name and '.' not in name.split('/')[-1]:
                    html_files.append(name)
            
            html_files = sorted(html_files)
            logger.info(f"[IndexBook] EPUB contains {len(all_files)} files, {len(html_files)} HTML files")
            
            # ================================================================
            # 第三步：提取每个 HTML 文件的内容和章节标题
            # ================================================================
            
            for section_index, name in enumerate(html_files):
                try:
                    html_content = zf.read(name).decode('utf-8', errors='ignore')
                    soup = BeautifulSoup(html_content, 'html.parser')
                    
                    # 获取章节标题：优先使用导航文件中的映射
                    normalized_name = name.replace('\\', '/')
                    section_title = chapter_map.get(normalized_name)
                    
                    # 如果导航文件中没有，尝试不同的路径格式匹配
                    if not section_title:
                        # 尝试只用文件名匹配
                        filename = os.path.basename(normalized_name)
                        for href, title in chapter_map.items():
                            if os.path.basename(href) == filename:
                                section_title = title
                                break
                    
                    # 如果还是没有，使用 HTML 内容提取
                    if not section_title:
                        section_title = _extract_title_from_html(soup, html_content, section_index)
                    
                    # 移除脚本、样式和导航元素
                    for tag in soup(['script', 'style', 'nav', 'head']):
                        tag.decompose()
                    
                    text = soup.get_text(separator='\n', strip=True)
                    
                    # 过滤太短的章节（可能是目录、版权页等）
                    if text and len(text) > 50:
                        sections.append({
                            "section_index": section_index,
                            "section_href": name,
                            "title": section_title,
                            "text": text,
                        })
                        logger.debug(f"[IndexBook] Section {section_index}: '{section_title[:30]}' ({len(text)} chars)")
                        
                except Exception as e:
                    logger.warning(f"[IndexBook] Failed to parse {name}: {e}")
            
            logger.info(f"[IndexBook] Extracted {len(sections)} sections from EPUB")
            
    except Exception as e:
        logger.error(f"[IndexBook] Failed to extract EPUB: {e}")
        import traceback
        traceback.print_exc()
    
    return sections


def extract_pdf_with_docling(pdf_bytes: bytes) -> list:
    """
    使用 Docling 从 PDF 提取结构化内容
    
    【优化 2026-01-12】Docling 可以识别 PDF 中的章节结构，
    提取标题、段落等语义信息，比 PyMuPDF 的纯文本提取更精准。
    
    Returns:
        list of dict: [{"page": 1, "text": "...", "title": "Chapter 1"}, ...]
        如果失败返回空列表
    """
    try:
        from docling.document_converter import DocumentConverter
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        import tempfile
        import os
        
        # Docling 需要文件路径，创建临时文件
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
            tmp.write(pdf_bytes)
            tmp_path = tmp.name
        
        try:
            # 配置 Docling Pipeline
            pipeline_options = PdfPipelineOptions()
            pipeline_options.do_ocr = False  # 不使用OCR（我们有单独的OCR流程）
            
            converter = DocumentConverter()
            result = converter.convert(tmp_path)
            
            if not result or not result.document:
                logger.warning("[IndexBook] Docling returned empty result")
                return []
            
            doc = result.document
            structured_pages = []
            current_chapter = ""
            
            # 遍历文档元素，提取结构化内容
            for item in doc.iterate_items():
                text = item.text if hasattr(item, 'text') else str(item)
                if not text or len(text.strip()) < 5:
                    continue
                
                page_num = getattr(item, 'page_no', 1) or 1
                item_type = type(item).__name__.lower()
                
                # 检测章节标题
                if 'heading' in item_type or 'title' in item_type:
                    current_chapter = text.strip()[:100]
                
                structured_pages.append({
                    "page": page_num,
                    "text": text.strip(),
                    "title": current_chapter,
                })
            
            logger.info(f"[IndexBook] Docling extracted {len(structured_pages)} items from PDF")
            return structured_pages
            
        finally:
            # 清理临时文件
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
                
    except ImportError:
        logger.debug("[IndexBook] Docling not installed, will use PyMuPDF fallback")
        return []
    except Exception as e:
        logger.warning(f"[IndexBook] Docling extraction failed: {e}, will use PyMuPDF fallback")
        return []


def extract_pdf_text_with_pages(pdf_bytes: bytes) -> list:
    """
    从 PDF 提取文本，保留页码信息
    
    【优化 2026-01-12】优先尝试 Docling 提取结构化内容，
    如果失败则回退到 PyMuPDF 纯文本提取。
    
    Returns:
        list of dict: [{"page": 1, "text": "...", "title": "..."}, ...]
    """
    # Step 1: 尝试使用 Docling 提取结构化内容
    docling_result = extract_pdf_with_docling(pdf_bytes)
    if docling_result:
        return docling_result
    
    # Step 2: 回退到 PyMuPDF
    logger.info("[IndexBook] Falling back to PyMuPDF for PDF extraction")
    try:
        import fitz  # PyMuPDF
        
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        pages = []
        
        for page_num in range(len(doc)):
            page = doc[page_num]
            text = page.get_text()
            if text.strip() and len(text.strip()) > 20:
                pages.append({
                    "page": page_num + 1,  # 1-based page number
                    "text": text.strip(),
                    "title": "",  # PyMuPDF 无法提取章节标题
                })
        
        doc.close()
        logger.info(f"[IndexBook] PyMuPDF extracted {len(pages)} pages from PDF")
        return pages
    except ImportError:
        logger.error("[IndexBook] PyMuPDF not installed")
        return []
    except Exception as e:
        logger.error(f"[IndexBook] Failed to extract PDF: {e}")
        return []


def extract_epub_text(epub_bytes: bytes) -> str:
    """从 EPUB 提取文本（兼容旧接口）"""
    sections = extract_epub_text_with_sections(epub_bytes)
    return '\n\n'.join([s['text'] for s in sections])


def extract_pdf_text(pdf_bytes: bytes) -> str:
    """从 PDF 提取文本（兼容旧接口）"""
    pages = extract_pdf_text_with_pages(pdf_bytes)
    return '\n\n'.join([f"--- Page {p['page']} ---\n{p['text']}" for p in pages])


# ============================================================================
# 异步索引逻辑
# ============================================================================


async def _index_book_async(book_id: str) -> dict:
    """异步索引单本书籍"""
    # 为每个任务创建独立的数据库引擎，避免 Event Loop 冲突
    task_engine = _create_task_engine()
    try:
        async with task_engine.begin() as conn:
            # 获取书籍信息（包括 content_sha256 用于向量索引匹配）
            result = await conn.execute(
                text("""
                    SELECT id, user_id, title, author, minio_key, original_format,
                           is_digitalized, ocr_status, vector_indexed_at, content_sha256
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
                original_format, is_digitalized, ocr_status, vector_indexed_at, content_sha256
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
                logger.info(f"[IndexBook] Downloaded {len(file_bytes)} bytes from {minio_key}")
            except Exception as e:
                logger.error(f"[IndexBook] Failed to download {minio_key}: {e}")
                return {"status": "error", "message": f"Download failed: {e}"}
            
            # 提取文本（结构化：保留章节/页码信息）
            structured_content = None
            text_content = ""
            
            # 确定实际文件格式（可能与original_format不同，如MOBI转换为EPUB）
            actual_format = 'epub' if minio_key and minio_key.endswith('.epub') else \
                           'pdf' if minio_key and minio_key.endswith('.pdf') else \
                           original_format
            
            if actual_format == 'epub':
                logger.info(f"[IndexBook] Extracting structured text from EPUB (original: {original_format})...")
                structured_content = extract_epub_text_with_sections(file_bytes)
                text_content = '\n\n'.join([s['text'] for s in structured_content]) if structured_content else ""
            elif actual_format == 'pdf':
                logger.info(f"[IndexBook] Extracting structured text from PDF...")
                structured_content = extract_pdf_text_with_pages(file_bytes)
                text_content = '\n\n'.join([p['text'] for p in structured_content]) if structured_content else ""
            else:
                return {"status": "skipped", "message": f"Unsupported format: {original_format} (actual: {actual_format})"}
            
            logger.info(f"[IndexBook] Extracted text length: {len(text_content)} chars, sections/pages: {len(structured_content) if structured_content else 0}")
            
            if not text_content or len(text_content) < 100:
                return {"status": "skipped", "message": "Insufficient text content"}
            
            # 创建向量索引（使用 content_sha256 作为公共数据标识）
            try:
                chunks_count = await index_book_chunks(
                    book_id=str(book_uuid),
                    content_sha256=content_sha256 or "",  # 公共数据匹配
                    text_content=text_content,
                    book_title=title,
                    structured_content=structured_content,  # 传递结构化内容
                    original_format=actual_format,  # 使用实际文件格式，而非上传时的原始格式
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
