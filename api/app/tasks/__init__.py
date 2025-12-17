"""
Celery 任务模块包

将原 tasks.py (2144 行) 拆分为以下模块：
- common.py         - 共享工具函数（封面优化、元数据提取等）
- cover_tasks.py    - 封面提取任务
- metadata_tasks.py - 元数据提取任务（Calibre + 本地）
- convert_tasks.py  - 格式转换任务
- ocr_tasks.py      - OCR 处理任务
- analysis_tasks.py - 深度分析与 SRS 卡片任务

所有任务保持原有的 task name，确保向后兼容：
- tasks.extract_book_cover
- tasks.extract_book_cover_and_metadata
- tasks.extract_ebook_metadata_calibre
- tasks.extract_book_metadata
- tasks.convert_to_epub
- tasks.analyze_book_type
- tasks.process_book_ocr
- tasks.deep_analyze_book
- tasks.generate_srs_card
"""

# 导入所有任务，确保 Celery 能发现它们
from .cover_tasks import (
    extract_book_cover,
    extract_book_cover_and_metadata,
)
from .metadata_tasks import (
    extract_ebook_metadata_calibre,
    extract_book_metadata,
)
from .convert_tasks import (
    convert_to_epub,
)
from .ocr_tasks import (
    analyze_book_type,
    process_book_ocr,
)
from .analysis_tasks import (
    deep_analyze_book,
    generate_srs_card,
)

# 导出共享工具函数（供其他模块使用）
from .common import (
    _quick_confidence,
    _optimize_cover_image,
    _extract_epub_metadata,
    _extract_pdf_metadata,
    _extract_epub_cover,
    _extract_pdf_cover,
)

__all__ = [
    # 任务
    "extract_book_cover",
    "extract_book_cover_and_metadata",
    "extract_ebook_metadata_calibre",
    "extract_book_metadata",
    "convert_to_epub",
    "analyze_book_type",
    "process_book_ocr",
    "deep_analyze_book",
    "generate_srs_card",
    # 工具函数
    "_quick_confidence",
    "_optimize_cover_image",
    "_extract_epub_metadata",
    "_extract_pdf_metadata",
    "_extract_epub_cover",
    "_extract_pdf_cover",
]
