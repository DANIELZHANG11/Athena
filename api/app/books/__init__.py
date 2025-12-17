"""
书籍模块包初始化

模块结构：
- common.py: 共享基础设施、配置常量、工具函数
- upload.py: 上传相关端点 (upload_init, upload_complete, dedup_reference, upload_proxy)
- content.py: 内容访问端点 (cover, content, presign)
- ocr.py: OCR 相关端点 (ocr, ocr/full, ocr/quota, ocr/status, ocr/page, ocr/search)
- metadata.py: 元数据 CRUD (list, detail, register, deep_analyze, update)
- delete.py: 删除逻辑 (软删除/硬删除)
- convert.py: 格式转换端点 (convert, jobs)
- shelves.py: 书架 CRUD

完全模块化：
- 原 books.py 可以逐步废弃
- main.py 应引用此包的 router 和 shelves_router

@see 04 - 数据库全景与迁移Database_Schema_and_Migration_Log.md
@see 05 - API 契约与协议API_Contracts_and_Protocols.md
"""
from fastapi import APIRouter

# 导入子模块路由
from . import upload
from . import content
from . import ocr
from . import metadata
from . import delete
from . import convert
from . import shelves

# 创建主路由器
router = APIRouter(prefix="/api/v1/books", tags=["books"])
shelves_router = APIRouter(prefix="/api/v1/shelves", tags=["shelves"])

# ============================================================================
# 注册 Books 路由（按 path 顺序注册，具体路径优先于参数化路径）
# ============================================================================

# 上传相关 - 无参数路径优先
router.include_router(upload.router, tags=["books"])

# 作业列表 - /jobs/list 必须在 /{book_id} 之前
router.include_router(convert.router, tags=["books"])

# 元数据 - 包含 / 和 /register 以及 /{book_id} 通配
router.include_router(metadata.router, tags=["books"])

# 内容访问 - /{book_id}/cover, /{book_id}/content 等
router.include_router(content.router, tags=["books"])

# OCR - /{book_id}/ocr 等
router.include_router(ocr.router, tags=["books"])

# 删除 - /{book_id} DELETE
router.include_router(delete.router, tags=["books"])

# ============================================================================
# 注册 Shelves 路由
# ============================================================================
shelves_router.include_router(shelves.router, tags=["shelves"])

# ============================================================================
# 导出共享基础设施（供其他模块使用）
# ============================================================================
from .common import (
    BOOKS_BUCKET,
    r,
    _quick_confidence,
    engine,
    require_user,
    require_upload_permission,
    require_write_permission,
    celery_app,
    presigned_get,
    presigned_put,
    read_full,
    read_head,
    delete_object,
    upload_bytes,
    make_object_key,
    ensure_bucket,
    get_s3,
    stat_etag,
    delete_book_from_index,
    index_book,
    ws_broadcast,
    HTTPException,
    Body,
    Depends,
    Query,
    Response,
    Header,
    File,
    UploadFile,
    uuid,
)

__all__ = [
    'router',
    'shelves_router',
    'BOOKS_BUCKET',
    'r',
    '_quick_confidence',
]
