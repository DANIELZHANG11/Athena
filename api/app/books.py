import os
import uuid

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

from .auth import require_user
from .celery_app import celery_app
from .db import engine
from .dependencies import require_upload_permission, require_write_permission
from .search_sync import delete_book as delete_book_from_index
from .search_sync import index_book
from .storage import (
    ensure_bucket,
    get_s3,
    make_object_key,
    presigned_get,
    presigned_put,
    read_head,
    stat_etag,
    upload_bytes,
)
from .services.book_service import get_upload_url as svc_get_upload_url, create_book as svc_create_book
from .ws import broadcast as ws_broadcast

BOOKS_BUCKET = os.getenv("MINIO_BUCKET", "athena")
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)


router = APIRouter(prefix="/api/v1/books", tags=["books"])
shelves_router = APIRouter(prefix="/api/v1/shelves", tags=["shelves"])


async def _ensure_books_fields(conn):
    return


def _quick_confidence(bucket: str, key: str) -> tuple[bool, float]:
    try:
        head = None
        if isinstance(key, str) and key.startswith("http"):
            import urllib.request

            try:
                with urllib.request.urlopen(key) as resp:
                    head = resp.read(65536)
            except Exception:
                head = None
        else:
            head = read_head(bucket, key, 65536)
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


@router.post("/upload_init")
async def upload_init(
    body: dict = Body(...),
    quota=Depends(require_upload_permission),
    auth=Depends(require_user),
):
    """
    初始化上传，支持全局 SHA256 去重。
    
    如果客户端提供了 content_sha256，服务端会检查是否已有相同文件：
    - 全局已存在：返回 dedup_available=true，客户端可跳过上传
    - 仅当前用户已有：返回现有 book_id
    """
    user_id, _ = auth
    filename = body.get("filename")
    if not filename:
        raise HTTPException(status_code=400, detail="missing_filename")
    content_type = body.get("content_type")
    content_sha256 = body.get("content_sha256")  # 客户端计算的 SHA256
    
    # 如果提供了 SHA256，检查全局去重
    if content_sha256 and len(content_sha256) == 64:
        async with engine.begin() as conn:
            await conn.execute(
                text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
            )
            # 1. 先检查当前用户是否已有相同文件
            res = await conn.execute(
                text(
                    "SELECT id::text, title FROM books WHERE user_id = cast(:uid as uuid) AND content_sha256 = :sha"
                ),
                {"uid": user_id, "sha": content_sha256},
            )
            own_row = res.fetchone()
            if own_row:
                # 用户自己已有相同文件，返回现有记录
                return {
                    "status": "success",
                    "data": {
                        "dedup_hit": "own",
                        "existing_book_id": own_row[0],
                        "existing_title": own_row[1],
                        "message": "您已上传过该文件"
                    }
                }
            
            # 2. 检查全局是否有相同文件（其他用户上传过）
            res = await conn.execute(
                text(
                    "SELECT id::text, minio_key, cover_key FROM books WHERE content_sha256 = :sha LIMIT 1"
                ),
                {"sha": content_sha256},
            )
            global_row = res.fetchone()
            if global_row:
                # 全局已存在，告知客户端可以秒传
                return {
                    "status": "success",
                    "data": {
                        "dedup_hit": "global",
                        "dedup_available": True,
                        "canonical_book_id": global_row[0],
                        "canonical_minio_key": global_row[1],
                        "canonical_cover_key": global_row[2],
                        "message": "文件已存在，可快速添加到书库"
                    }
                }
    
    # 没有去重命中，返回上传 URL
    data = await svc_get_upload_url(user_id, filename, content_type)
    data["dedup_hit"] = None
    return {"status": "success", "data": data}


@router.post("/upload_complete")
async def upload_complete(
    body: dict = Body(...),
    idempotency_key: str | None = Header(None),
    auth=Depends(require_user),
):
    user_id, _ = auth
    key = body.get("key")
    if not key:
        raise HTTPException(status_code=400, detail="missing_key")
    title = body.get("title") or "Untitled"
    author = body.get("author") or ""
    language = body.get("language") or ""
    original_format = body.get("original_format") or ""
    size = body.get("size") or None
    content_sha256 = body.get("content_sha256")  # 客户端计算的 SHA256
    if idempotency_key:
        idem_key = f"idem:books:upload_complete:{user_id}:{idempotency_key}"
        cached = r.get(idem_key)
        if cached:
            return {"status": "success", "data": eval(cached)}
    book_id = str(uuid.uuid4())
    etag = stat_etag(BOOKS_BUCKET, key)
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )

        if etag:
            res = await conn.execute(
                text(
                    "SELECT id::text FROM books WHERE user_id = current_setting('app.user_id')::uuid AND source_etag = :e"
                ),
                {"e": etag},
            )
            row = res.fetchone()
            if row:
                download_url = presigned_get(BOOKS_BUCKET, key)
                index_book(row[0], user_id, title, author)
                data = {"id": row[0], "download_url": download_url}
                if idempotency_key:
                    r.setex(idem_key, 24 * 3600, str(data))
                try:
                    celery_app.send_task(
                        "tasks.analyze_book_type", args=[row[0], user_id]
                    )
                    celery_app.send_task(
                        "tasks.deep_analyze_book", args=[row[0], user_id]
                    )
                except Exception:
                    pass
                return {"status": "success", "data": data}
    img_based, conf = _quick_confidence(BOOKS_BUCKET, key)
    async with engine.begin() as conn:
        await conn.execute(
            text(
                """
        INSERT INTO books(id, user_id, title, author, language, original_format, minio_key, size, is_digitalized, initial_digitalization_confidence, source_etag, content_sha256, storage_ref_count)
        VALUES (cast(:id as uuid), cast(:uid as uuid), :title, :author, :language, :fmt, :key, :size, :dig, :conf, :etag, :sha256, 1)
        """
            ),
            {
                "id": book_id,
                "uid": user_id,
                "title": title,
                "author": author,
                "language": language,
                "fmt": original_format,
                "key": key,
                "size": size,
                "dig": (conf >= 0.8),
                "conf": conf,
                "etag": etag,
                "sha256": content_sha256,
            },
        )
        # 初始化 meta.page_count 为占位，后台任务将补齐
        await conn.execute(
            text(
                "UPDATE books SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('page_count', 1, 'needs_manual', true) WHERE id = cast(:id as uuid)"
            ),
            {"id": book_id},
        )
    download_url = presigned_get(BOOKS_BUCKET, key)
    index_book(book_id, user_id, title, author)
    data = {"id": book_id, "download_url": download_url}
    if idempotency_key:
        r.setex(idem_key, 24 * 3600, str(data))
    
    # 根据格式决定任务流程
    fmt_lower = (original_format or '').lower()
    try:
        celery_app.send_task("tasks.analyze_book_type", args=[book_id, user_id])
        
        if fmt_lower in ('epub', 'pdf'):
            # EPUB/PDF 直接提取封面和元数据
            celery_app.send_task("tasks.extract_book_cover", args=[book_id, user_id])
            celery_app.send_task("tasks.extract_book_metadata", args=[book_id, user_id])
            # 触发深度分析（OCR + 向量索引）
            celery_app.send_task("tasks.deep_analyze_book", args=[book_id, user_id])
        else:
            # 其他格式（AZW3, MOBI 等）先转换为 EPUB，转换完成后会自动触发封面和元数据提取
            celery_app.send_task("tasks.convert_to_epub", args=[book_id, user_id])
    except Exception:
        pass
    return {"status": "success", "data": data}


@router.post("/dedup_reference")
async def dedup_reference(
    body: dict = Body(...),
    idempotency_key: str | None = Header(None),
    quota=Depends(require_upload_permission),
    auth=Depends(require_user),
):
    """
    全局去重秒传：当 upload_init 返回 dedup_available=true 时调用。
    不需要实际上传文件，直接创建指向已有存储的书籍记录。
    """
    user_id, _ = auth
    content_sha256 = body.get("content_sha256")
    canonical_book_id = body.get("canonical_book_id")
    title = body.get("title") or "Untitled"
    author = body.get("author") or ""
    language = body.get("language") or ""
    original_format = body.get("original_format") or ""
    
    if not content_sha256 or not canonical_book_id:
        raise HTTPException(status_code=400, detail="missing_content_sha256_or_canonical_book_id")
    
    if idempotency_key:
        idem_key = f"idem:books:dedup_reference:{user_id}:{idempotency_key}"
        cached = r.get(idem_key)
        if cached:
            return {"status": "success", "data": eval(cached)}
    
    book_id = str(uuid.uuid4())
    
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        
        # 获取原始书籍信息
        res = await conn.execute(
            text(
                """
                SELECT minio_key, cover_key, size, original_format, is_digitalized, 
                       initial_digitalization_confidence, meta, ocr_fingerprint, ocr_data_key
                FROM books WHERE id = cast(:cid as uuid) AND content_sha256 = :sha
                """
            ),
            {"cid": canonical_book_id, "sha": content_sha256},
        )
        canonical = res.fetchone()
        if not canonical:
            raise HTTPException(status_code=404, detail="canonical_book_not_found")
        
        (c_minio_key, c_cover_key, c_size, c_fmt, c_dig, c_conf, c_meta, c_ocr_fp, c_ocr_key) = canonical
        
        # 增加原始存储的引用计数
        await conn.execute(
            text(
                "UPDATE books SET storage_ref_count = COALESCE(storage_ref_count, 1) + 1 WHERE id = cast(:cid as uuid)"
            ),
            {"cid": canonical_book_id},
        )
        
        # 创建新的书籍记录，共享存储
        await conn.execute(
            text(
                """
                INSERT INTO books(id, user_id, title, author, language, original_format, 
                                  minio_key, cover_key, size, is_digitalized, initial_digitalization_confidence,
                                  content_sha256, canonical_book_id, storage_ref_count, meta,
                                  ocr_fingerprint, ocr_data_key)
                VALUES (cast(:id as uuid), cast(:uid as uuid), :title, :author, :language, :fmt,
                        :key, :cover, :size, :dig, :conf, :sha256, cast(:cid as uuid), 0, :meta,
                        :ocr_fp, :ocr_key)
                """
            ),
            {
                "id": book_id,
                "uid": user_id,
                "title": title,
                "author": author,
                "language": language,
                "fmt": c_fmt if not original_format else original_format,
                "key": c_minio_key,
                "cover": c_cover_key,
                "size": c_size,
                "dig": c_dig,
                "conf": c_conf,
                "sha256": content_sha256,
                "cid": canonical_book_id,
                "meta": c_meta,
                "ocr_fp": c_ocr_fp,
                "ocr_key": c_ocr_key,
            },
        )
    
    download_url = presigned_get(BOOKS_BUCKET, c_minio_key)
    index_book(book_id, user_id, title, author)
    
    data = {
        "id": book_id,
        "download_url": download_url,
        "dedup_hit": "global",
        "inherited_ocr": c_ocr_fp is not None,
    }
    
    if idempotency_key:
        r.setex(idem_key, 24 * 3600, str(data))
    
    return {"status": "success", "data": data}


async def _deep_analyze_and_standardize(book_id: str, user_id: str):
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await _ensure_books_fields(conn)
        res = await conn.execute(
            text(
                "SELECT minio_key, is_digitalized, original_format FROM books WHERE id = cast(:id as uuid)"
            ),
            {"id": book_id},
        )
        row = res.fetchone()
        if not row:
            return
        key = row[0]
        fmt = (row[2] or "").lower()
        img_based, conf = _quick_confidence(BOOKS_BUCKET, key)
        rep_key = make_object_key(user_id, f"digitalize-report-{book_id}.json")
        import json

        upload_bytes(
            BOOKS_BUCKET,
            rep_key,
            json.dumps({"is_image_based": img_based, "confidence": conf}).encode(
                "utf-8"
            ),
            "application/json",
        )
        await conn.execute(
            text(
                "UPDATE books SET is_digitalized = :dig, initial_digitalization_confidence = :conf, digitalize_report_key = :rk, updated_at = now() WHERE id = cast(:id as uuid)"
            ),
            {
                "dig": (not img_based and conf >= 0.8),
                "conf": conf,
                "rk": rep_key,
                "id": book_id,
            },
        )
    try:
        await ws_broadcast(
            f"book:{book_id}",
            json.dumps(
                {
                    "event": "DEEP_ANALYZED",
                    "digitalized": (not img_based and conf >= 0.8),
                    "confidence": conf,
                }
            ),
        )
    except Exception:
        pass
    if fmt != "pdf":
        std_key = make_object_key(user_id, f"converted/{book_id}.epub")
        upload_bytes(
            BOOKS_BUCKET, std_key, b"standardized-epub", "application/epub+zip"
        )
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "UPDATE books SET converted_epub_key = :k, updated_at = now() WHERE id = cast(:id as uuid)"
                ),
                {"k": std_key, "id": book_id},
            )
        try:
            await ws_broadcast(
                f"book:{book_id}",
                json.dumps({"event": "STANDARDIZED", "epub_key": std_key}),
            )
        except Exception:
            pass


@router.get("/{book_id}/cover")
async def get_book_cover(
    book_id: str,
    token: str = Query(None),
    authorization: str = Header(None),
):
    """
    获取书籍封面图片（通过 API 代理）
    解决移动端无法直接访问 localhost 存储的问题
    支持两种认证方式：
    1. Authorization header: Bearer <token>
    2. Query param: ?token=<token>
    """
    from fastapi.responses import Response as FastAPIResponse
    from jose import jwt
    
    AUTH_SECRET = os.getenv("AUTH_SECRET", "dev_secret")
    
    # 解析 token
    auth_token = None
    if authorization and authorization.startswith("Bearer "):
        auth_token = authorization.split(" ", 1)[1]
    elif token:
        auth_token = token
    
    if not auth_token:
        raise HTTPException(status_code=401, detail="unauthorized")
    
    try:
        payload = jwt.decode(auth_token, AUTH_SECRET, algorithms=["HS256"])
        user_id = payload["sub"]
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"invalid_token: {str(e)}")
    
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text("SELECT cover_image_key FROM books WHERE id = cast(:id as uuid)"),
            {"id": book_id},
        )
        row = res.fetchone()
        if not row or not row[0]:
            raise HTTPException(status_code=404, detail="cover_not_found")
        
        cover_key = row[0]
        
        # 从存储读取封面
        try:
            client = get_s3()
            ensure_bucket(client, BOOKS_BUCKET)
            resp = client.get_object(Bucket=BOOKS_BUCKET, Key=cover_key)
            cover_data = resp["Body"].read()
            content_type = resp.get("ContentType", "image/webp")
            
            return FastAPIResponse(
                content=cover_data,
                media_type=content_type,
                headers={
                    "Cache-Control": "public, max-age=86400",  # 缓存 24 小时
                    "Content-Disposition": "inline",
                    "Access-Control-Allow-Origin": "*",  # 允许 canvas 跨域读取
                }
            )
        except Exception as e:
            raise HTTPException(status_code=404, detail=f"cover_fetch_error: {str(e)}")


@router.get("/{book_id}/content")
async def get_book_content(
    book_id: str,
    token: str = Query(None),
    authorization: str = Header(None),
):
    """
    获取书籍内容（通过 API 代理）
    支持 HTTP Range 请求以实现流式加载
    解决 CORS 问题，使 epub.js 和 react-pdf 可以正确加载书籍
    """
    from fastapi.responses import Response as FastAPIResponse, StreamingResponse
    from fastapi import Request
    from jose import jwt
    
    AUTH_SECRET = os.getenv("AUTH_SECRET", "dev_secret")
    
    # 解析 token
    auth_token = None
    if authorization and authorization.startswith("Bearer "):
        auth_token = authorization.split(" ", 1)[1]
    elif token:
        auth_token = token
    
    if not auth_token:
        raise HTTPException(status_code=401, detail="unauthorized")
    
    try:
        payload = jwt.decode(auth_token, AUTH_SECRET, algorithms=["HS256"])
        user_id = payload["sub"]
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"invalid_token: {str(e)}")
    
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text("SELECT minio_key, original_format, converted_epub_key FROM books WHERE id = cast(:id as uuid)"),
            {"id": book_id},
        )
        row = res.fetchone()
        if not row or not row[0]:
            raise HTTPException(status_code=404, detail="book_not_found")
        
        minio_key, original_format, converted_epub_key = row[0], row[1], row[2]
        
        # 优先使用转换后的 EPUB（非 EPUB/PDF 格式会被转换为 EPUB）
        if converted_epub_key:
            minio_key = converted_epub_key
            original_format = "epub"
        
        # 确定 content type（只支持 EPUB 和 PDF）
        content_type_map = {
            "epub": "application/epub+zip",
            "pdf": "application/pdf",
        }
        content_type = content_type_map.get(original_format, "application/epub+zip")
        
        # 从存储读取书籍
        try:
            client = get_s3()
            ensure_bucket(client, BOOKS_BUCKET)
            resp = client.get_object(Bucket=BOOKS_BUCKET, Key=minio_key)
            book_data = resp["Body"].read()
            content_length = len(book_data)
            
            return FastAPIResponse(
                content=book_data,
                media_type=content_type,
                headers={
                    "Content-Length": str(content_length),
                    "Accept-Ranges": "bytes",
                    "Cache-Control": "private, max-age=3600",
                    "Content-Disposition": f"inline; filename=\"book.{original_format}\"",
                }
            )
        except Exception as e:
            raise HTTPException(status_code=404, detail=f"book_fetch_error: {str(e)}")


@router.get("/{book_id}/processing/status")
async def processing_status(book_id: str, auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                "SELECT status FROM conversion_jobs WHERE owner_id = current_setting('app.user_id')::uuid AND book_id = cast(:bid as uuid) ORDER BY created_at DESC LIMIT 1"
            ),
            {"bid": book_id},
        )
        row = res.fetchone()
        if not row:
            return {"status": "success", "data": {"status": "ACTIVE"}}
        st = row[0]
        mapped = (
            "ACTIVE"
            if st in ("succeeded", "active")
            else ("FAILED" if st == "failed" else "PENDING")
        )
        return {"status": "success", "data": {"status": mapped}}


@router.get("/{book_id}/convert/output")
async def presign_convert_output(book_id: str, auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                "SELECT output_key FROM conversion_jobs WHERE owner_id = current_setting('app.user_id')::uuid AND book_id = cast(:bid as uuid) AND status = 'completed' ORDER BY updated_at DESC LIMIT 1"
            ),
            {"bid": book_id},
        )
        row = res.fetchone()
        if not row or not row[0]:
            raise HTTPException(status_code=404, detail="not_found")
        return {
            "status": "success",
            "data": {"download_url": presigned_get(BOOKS_BUCKET, row[0])},
        }


@router.get("/{book_id}/ocr")
async def get_book_ocr(book_id: str, auth=Depends(require_user)):
    """
    获取书籍的 OCR 识别结果
    返回按页组织的文本内容，用于前端显示和搜索
    """
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                "SELECT digitalize_report_key, is_digitalized FROM books WHERE id = cast(:id as uuid)"
            ),
            {"id": book_id},
        )
        row = res.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="not_found")
        
        report_key = row[0]
        is_digitalized = row[1]
        
        if not report_key:
            return {
                "status": "success",
                "data": {
                    "available": False,
                    "is_digitalized": bool(is_digitalized),
                    "pages": {},
                    "total_pages": 0,
                    "total_chars": 0,
                }
            }
        
        # 读取 OCR 报告
        try:
            from .storage import read_full
            report_data = read_full(BOOKS_BUCKET, report_key)
            if not report_data:
                raise Exception("Report not found")
            
            import json
            report = json.loads(report_data)
            ocr_result = report.get("ocr", {})
            ocr_pages = ocr_result.get("pages", [])
            
            # 按页组织文本
            pages_dict = {}
            for item in ocr_pages:
                page_num = item.get("page", 1)
                item_text = item.get("text", "")
                if item_text:
                    if page_num not in pages_dict:
                        pages_dict[page_num] = []
                    pages_dict[page_num].append(item_text)
            
            # 转换为前端友好格式
            pages_formatted = {}
            total_chars = 0
            for page_num, texts in pages_dict.items():
                page_text = "\n".join(texts)
                pages_formatted[str(page_num)] = page_text
                total_chars += len(page_text)
            
            return {
                "status": "success",
                "data": {
                    "available": True,
                    "is_digitalized": bool(is_digitalized),
                    "is_image_based": report.get("is_image_based", False),
                    "confidence": report.get("confidence", 0),
                    "pages": pages_formatted,
                    "total_pages": len(pages_formatted),
                    "total_chars": total_chars,
                }
            }
        except Exception as e:
            print(f"[OCR] Failed to read report: {e}")
            return {
                "status": "success",
                "data": {
                    "available": False,
                    "is_digitalized": bool(is_digitalized),
                    "pages": {},
                    "total_pages": 0,
                    "total_chars": 0,
                    "error": str(e),
                }
            }


@router.get("/{book_id}/ocr/full")
async def get_book_ocr_full(
    book_id: str,
    auth=Depends(require_user)
):
    """
    获取书籍完整的 OCR 识别结果（含所有页面坐标信息）
    用于前端一次性下载并缓存到 IndexedDB
    
    注意：PDF 每一页的尺寸可能不同，page_sizes 字典包含每页的实际尺寸
    
    返回格式（支持 gzip 压缩）:
    {
        "is_image_based": true,
        "confidence": 0.95,
        "total_pages": 603,
        "total_chars": 606993,
        "total_regions": 22784,
        "page_sizes": {           // 每页的实际尺寸（页码为字符串 key）
            "1": {"width": 1240, "height": 1754},
            "2": {"width": 1240, "height": 1600},
            ...
        },
        "regions": [
            {
                "text": "识别的文字",
                "confidence": 0.99,
                "bbox": [x1, y1, x2, y2],
                "polygon": [[x1,y1], ...],
                "page": 1
            },
            ...
        ]
    }
    """
    import gzip
    import json
    
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                "SELECT digitalize_report_key, is_digitalized FROM books WHERE id = cast(:id as uuid)"
            ),
            {"id": book_id},
        )
        row = res.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="book_not_found")
        
        report_key, is_digitalized = row
        if not report_key:
            raise HTTPException(status_code=404, detail="ocr_not_available")
        
        try:
            from .storage import read_full
            report_data = read_full(BOOKS_BUCKET, report_key)
            if not report_data:
                raise Exception("Report not found")
            
            report = json.loads(report_data)
            ocr_result = report.get("ocr", {})
            all_regions = ocr_result.get("regions", [])
            
            # 计算统计信息
            total_chars = sum(len(r.get("text", "")) for r in all_regions)
            page_numbers = set(r.get("page", 1) for r in all_regions)
            total_pages = max(page_numbers) if page_numbers else 0
            
            # 获取每页的尺寸信息
            # PDF 每一页的尺寸可能不同，需要从报告中读取或推断
            page_sizes = report.get("page_sizes", {})  # {"1": {"width": w, "height": h}, ...}
            
            # 如果报告中没有 page_sizes，则从每页的 region 坐标推断
            if not page_sizes:
                page_sizes = {}
                # 按页分组 regions
                page_regions_map = {}
                for r in all_regions:
                    p = r.get("page", 1)
                    if p not in page_regions_map:
                        page_regions_map[p] = []
                    page_regions_map[p].append(r)
                
                # 为每页推断尺寸
                for page_num, regions in page_regions_map.items():
                    max_x, max_y = 0.0, 0.0
                    for r in regions:
                        bbox = r.get("bbox", [])
                        if len(bbox) >= 4:
                            max_x = max(max_x, bbox[2])
                            max_y = max(max_y, bbox[3])
                    
                    if max_x > 0 and max_y > 0:
                        # 添加约 8% 边距估算完整页面尺寸
                        page_sizes[str(page_num)] = {
                            "width": int(max_x * 1.08),
                            "height": int(max_y * 1.08)
                        }
            
            # 构建响应数据
            response_data = {
                "is_image_based": report.get("is_image_based", False),
                "confidence": report.get("confidence", 0),
                "total_pages": total_pages,
                "total_chars": total_chars,
                "total_regions": len(all_regions),
                "page_sizes": page_sizes,
                "regions": all_regions,
            }
            
            # 使用 gzip 压缩
            json_bytes = json.dumps(response_data, ensure_ascii=False).encode("utf-8")
            compressed = gzip.compress(json_bytes, compresslevel=6)
            
            return Response(
                content=compressed,
                media_type="application/json",
                headers={
                    "Content-Encoding": "gzip",
                    "Content-Length": str(len(compressed)),
                    "X-Original-Size": str(len(json_bytes)),
                    "X-Compressed-Size": str(len(compressed)),
                }
            )
        except Exception as e:
            print(f"[OCR] Failed to read full OCR data: {e}")
            import traceback
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=str(e))


@router.get("/{book_id}/ocr/quota")
async def get_ocr_quota_info(book_id: str, auth=Depends(require_user)):
    """
    获取 OCR 配额信息，用于前端显示。
    
    返回:
    - pageCount: 书籍页数
    - tier: 阶梯 (1, 2, 3)
    - cost: 所需配额单位
    - canTrigger: 是否可以触发 OCR
    - reason: 不能触发的原因
    - freeRemaining: 免费剩余额度
    - proRemaining: Pro 赠送剩余额度
    - addonRemaining: 加油包剩余额度
    - isPro: 是否是 Pro 用户
    - maxPages: 最大支持页数
    """
    from datetime import datetime, timezone
    
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        
        # 获取书籍信息
        res = await conn.execute(
            text("""
                SELECT id, is_digitalized, ocr_status,
                       COALESCE((meta->>'page_count')::int, 0) as page_count
                FROM books 
                WHERE id = cast(:id as uuid)
            """),
            {"id": book_id},
        )
        row = res.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="book_not_found")
        
        _, is_digitalized, ocr_status, page_count = row
        
        # 获取系统配置
        settings_res = await conn.execute(
            text("""
                SELECT key, value FROM system_settings 
                WHERE key IN (
                    'ocr_page_thresholds', 'ocr_max_pages', 'ocr_monthly_free_quota',
                    'monthly_gift_ocr_count'
                )
            """)
        )
        settings = {r[0]: r[1] for r in settings_res.fetchall()}
        
        thresholds = settings.get("ocr_page_thresholds", {"standard": 600, "double": 1000, "triple": 2000})
        max_pages = int(settings.get("ocr_max_pages", 2000))
        free_quota = int(settings.get("ocr_monthly_free_quota", 3))
        gift_quota = int(settings.get("monthly_gift_ocr_count", 3))
        
        # 获取用户信息
        user_res = await conn.execute(
            text("""
                SELECT membership_tier, membership_expire_at, free_ocr_usage,
                       COALESCE(ocr_addon_balance, 0) as addon_balance
                FROM users WHERE id = cast(:uid as uuid)
            """),
            {"uid": user_id},
        )
        user_row = user_res.fetchone()
        if not user_row:
            raise HTTPException(status_code=401, detail="user_not_found")
        
        tier, membership_expire_at, free_ocr_used, addon_balance = user_row
        
        # Pro 会员检查
        is_pro = False
        if tier and tier != "FREE" and membership_expire_at:
            if membership_expire_at > datetime.now(timezone.utc):
                is_pro = True
        
        # 计算阶梯和所需单位
        if page_count <= thresholds["standard"]:
            tier_level = 1
            units_needed = 1
        elif page_count <= thresholds["double"]:
            tier_level = 2
            units_needed = 2
        elif page_count <= thresholds["triple"]:
            tier_level = 3
            units_needed = 3
        else:
            tier_level = 3
            units_needed = 3
        
        # 计算剩余配额
        free_remaining = max(0, free_quota - (free_ocr_used or 0))
        pro_remaining = max(0, gift_quota - (free_ocr_used or 0)) if is_pro else 0
        
        # 判断是否可以触发
        can_trigger = True
        reason = None
        
        if is_digitalized:
            can_trigger = False
            reason = "书籍已是文字型，无需 OCR"
        elif ocr_status in ('pending', 'processing'):
            can_trigger = False
            reason = "OCR 任务正在处理中"
        elif not page_count or page_count == 0:
            can_trigger = False
            reason = "无法获取书籍页数"
        elif page_count > max_pages:
            can_trigger = False
            reason = f"页数超过上限 (最大 {max_pages} 页)"
        elif not is_pro:
            # 免费用户检查
            if tier_level > 1:
                can_trigger = False
                reason = "免费用户仅支持 ≤600 页的书籍"
            elif free_remaining < 1:
                can_trigger = False
                reason = "本月免费配额已用尽"
        else:
            # Pro 用户检查
            if tier_level == 1 and pro_remaining >= 1:
                pass  # 可以使用月度赠送
            elif addon_balance < units_needed:
                can_trigger = False
                reason = "配额不足，请购买加油包"
        
        return {
            "status": "success",
            "data": {
                "pageCount": page_count if page_count > 0 else None,
                "tier": tier_level,
                "cost": units_needed,
                "canTrigger": can_trigger,
                "reason": reason,
                "freeRemaining": free_remaining if not is_pro else 0,
                "proRemaining": pro_remaining,
                "addonRemaining": addon_balance,
                "isPro": is_pro,
                "maxPages": max_pages,
            }
        }


@router.post("/{book_id}/ocr")
async def trigger_book_ocr(book_id: str, auth=Depends(require_user)):
    """
    用户主动请求对图片型 PDF 进行 OCR 处理。
    
    检查:
    1. 书籍是否存在且属于用户
    2. 书籍是否已是文字型 (is_digitalized=true)
    3. 是否已有 OCR 任务在处理中
    4. 用户 OCR 配额是否充足
    
    成功后更新 books.ocr_status='pending', ocr_requested_at=now()
    并分发 Celery 任务进行 OCR 处理
    """
    from datetime import datetime, timezone
    
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        
        # 1. 获取书籍信息
        res = await conn.execute(
            text("""
                SELECT id, is_digitalized, ocr_status, ocr_requested_at, minio_key, 
                       COALESCE((meta->>'page_count')::int, 0) as page_count
                FROM books 
                WHERE id = cast(:id as uuid)
            """),
            {"id": book_id},
        )
        row = res.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="book_not_found")
        
        book_id_db, is_digitalized, ocr_status, ocr_requested_at, minio_key, page_count = row
        
        # 2. 检查是否已是文字型
        if is_digitalized:
            raise HTTPException(status_code=400, detail="already_digitalized")
        
        # 3. 检查是否已有 OCR 任务在处理中
        if ocr_status in ('pending', 'processing'):
            # 计算队列位置
            queue_res = await conn.execute(
                text("""
                    SELECT COUNT(*) FROM books 
                    WHERE ocr_status IN ('pending', 'processing') 
                    AND ocr_requested_at < :req_at
                """),
                {"req_at": ocr_requested_at or datetime.now(timezone.utc)},
            )
            queue_pos = (queue_res.fetchone()[0] or 0) + 1
            
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "ocr_in_progress",
                    "queuePosition": queue_pos
                }
            )
        
        # 4. 页数风控检查
        if not page_count or page_count == 0:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "OCR_NEEDS_MANUAL_CHECK",
                    "message": "无法获取书籍页数信息，请联系客服"
                }
            )
        
        # 获取系统配置
        settings_res = await conn.execute(
            text("""
                SELECT key, value FROM system_settings 
                WHERE key IN (
                    'ocr_page_thresholds', 'ocr_max_pages', 'ocr_monthly_free_quota',
                    'monthly_gift_ocr_count', 'ocr_minutes_per_book'
                )
            """)
        )
        settings = {r[0]: r[1] for r in settings_res.fetchall()}
        
        # 解析配置（value 是 JSONB，已经是 Python 对象）
        thresholds = settings.get("ocr_page_thresholds", {"standard": 600, "double": 1000, "triple": 2000})
        max_pages = int(settings.get("ocr_max_pages", 2000))
        free_quota = int(settings.get("ocr_monthly_free_quota", 3))
        gift_quota = int(settings.get("monthly_gift_ocr_count", 3))
        minutes_per_book = int(settings.get("ocr_minutes_per_book", 5))
        
        # 检查页数上限
        if page_count > max_pages:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "OCR_MAX_PAGES_EXCEEDED",
                    "pages": page_count,
                    "limit": max_pages
                }
            )
        
        # 计算所需单位数（按阶梯）
        if page_count <= thresholds["standard"]:
            units_needed = 1
        elif page_count <= thresholds["double"]:
            units_needed = 2
        elif page_count <= thresholds["triple"]:
            units_needed = 3
        else:
            units_needed = 3  # fallback
        
        # 5. 检查用户配额
        user_res = await conn.execute(
            text("""
                SELECT membership_tier, membership_expire_at, free_ocr_usage,
                       COALESCE(monthly_gift_reset_at, '1970-01-01'::timestamptz) as gift_reset_at
                FROM users WHERE id = cast(:uid as uuid)
            """),
            {"uid": user_id},
        )
        user_row = user_res.fetchone()
        if not user_row:
            raise HTTPException(status_code=401, detail="user_not_found")
        
        tier, membership_expire_at, free_ocr_used, gift_reset_at = user_row
        
        # Pro 会员检查
        is_pro = False
        if tier and tier != "FREE" and membership_expire_at:
            if membership_expire_at > datetime.now(timezone.utc):
                is_pro = True
        
        # 检查月度赠送是否需要重置
        now_utc = datetime.now(timezone.utc)
        if is_pro and gift_reset_at < now_utc.replace(day=1, hour=0, minute=0, second=0, microsecond=0):
            # 重置月度赠送
            await conn.execute(
                text("UPDATE users SET free_ocr_usage = 0, monthly_gift_reset_at = now() WHERE id = cast(:uid as uuid)"),
                {"uid": user_id}
            )
            free_ocr_used = 0
        
        # 配额检查逻辑（按商业模型 V9.0）
        can_use_free = units_needed == 1  # 仅 ≤600 页可用免费额度
        
        if is_pro:
            # Pro 会员：优先用月度赠送
            if can_use_free and free_ocr_used < gift_quota:
                # 使用月度赠送额度
                quota_type = "monthly_gift"
            else:
                # 需要检查加油包余额
                addon_res = await conn.execute(
                    text("SELECT ocr_addon_balance FROM users WHERE id = cast(:uid as uuid)"),
                    {"uid": user_id}
                )
                addon_balance = (addon_res.fetchone() or (0,))[0] or 0
                if addon_balance < units_needed:
                    raise HTTPException(
                        status_code=403,
                        detail={
                            "code": "ocr_quota_exceeded",
                            "quota": {
                                "giftUsed": free_ocr_used,
                                "giftLimit": gift_quota,
                                "addonBalance": addon_balance,
                                "unitsNeeded": units_needed,
                                "pageCount": page_count
                            }
                        }
                    )
                quota_type = "addon"
        else:
            # 免费用户：仅能用月度免费配额（仅 ≤600 页）
            if not can_use_free:
                raise HTTPException(
                    status_code=403,
                    detail={
                        "code": "OCR_MAX_PAGES_EXCEEDED",
                        "message": "免费用户仅支持 600 页以内的书籍 OCR"
                    }
                )
            if free_ocr_used >= free_quota:
                raise HTTPException(
                    status_code=403,
                    detail={
                        "code": "ocr_quota_exceeded",
                        "quota": {
                            "used": free_ocr_used,
                            "limit": free_quota
                        }
                    }
                )
            quota_type = "free"
        
        # 6. 扣除配额（在同一事务内）
        if quota_type == "monthly_gift":
            await conn.execute(
                text("UPDATE users SET free_ocr_usage = free_ocr_usage + 1 WHERE id = cast(:uid as uuid)"),
                {"uid": user_id}
            )
        elif quota_type == "addon":
            await conn.execute(
                text("UPDATE users SET ocr_addon_balance = ocr_addon_balance - :units WHERE id = cast(:uid as uuid)"),
                {"uid": user_id, "units": units_needed}
            )
        elif quota_type == "free":
            await conn.execute(
                text("UPDATE users SET free_ocr_usage = free_ocr_usage + 1 WHERE id = cast(:uid as uuid)"),
                {"uid": user_id}
            )
        
        # 7. 更新书籍 OCR 状态
        await conn.execute(
            text("""
                UPDATE books 
                SET ocr_status = 'pending', 
                    ocr_requested_at = now(),
                    updated_at = now()
                WHERE id = cast(:id as uuid)
            """),
            {"id": book_id}
        )
        
        # 8. 计算队列位置
        queue_res = await conn.execute(
            text("""
                SELECT COUNT(*) FROM books 
                WHERE ocr_status IN ('pending', 'processing') 
                AND ocr_requested_at < now()
            """)
        )
        queue_position = (queue_res.fetchone()[0] or 0) + 1
        estimated_minutes = max(minutes_per_book, queue_position * minutes_per_book + (page_count or 100) // 50)
        
        # 9. 分发 Celery 任务
        try:
            celery_app.send_task(
                "tasks.process_book_ocr",
                args=[book_id, user_id],
                priority=7 if is_pro else 3
            )
        except Exception as e:
            print(f"[OCR] Failed to dispatch Celery task: {e}")
            # 任务分发失败，回滚状态
            await conn.execute(
                text("UPDATE books SET ocr_status = NULL, ocr_requested_at = NULL WHERE id = cast(:id as uuid)"),
                {"id": book_id},
            )
            raise HTTPException(status_code=503, detail="ocr_service_unavailable")
    
    return {
        "status": "queued",
        "queuePosition": queue_position,
        "estimatedMinutes": estimated_minutes
    }


@router.get("/{book_id}/ocr/status")
async def get_book_ocr_status(book_id: str, auth=Depends(require_user)):
    """
    查询书籍的 OCR 处理状态。
    
    返回:
    - isDigitalized: 是否已是文字型
    - ocrStatus: pending | processing | completed | failed | null
    - queuePosition: 仅当 status=pending 时返回
    - estimatedMinutes: 预计处理时间
    - completedAt: 仅当 status=completed 时返回
    - errorMessage: 仅当 status=failed 时返回
    """
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        
        res = await conn.execute(
            text("""
                SELECT id, is_digitalized, ocr_status, ocr_requested_at, 
                       vector_indexed_at, COALESCE((meta->>'page_count')::int, 0) as page_count,
                       meta->>'ocr_error' as ocr_error
                FROM books 
                WHERE id = cast(:id as uuid)
            """),
            {"id": book_id},
        )
        row = res.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="book_not_found")
        
        book_id_db, is_digitalized, ocr_status, ocr_requested_at, vector_indexed_at, page_count, ocr_error = row
        
        result = {
            "bookId": str(book_id_db),
            "isDigitalized": bool(is_digitalized),
            "ocrStatus": ocr_status,
        }
        
        if ocr_status == 'pending':
            # 计算队列位置
            queue_res = await conn.execute(
                text("""
                    SELECT COUNT(*) FROM books 
                    WHERE ocr_status IN ('pending', 'processing') 
                    AND ocr_requested_at < :req_at
                """),
                {"req_at": ocr_requested_at},
            )
            queue_pos = (queue_res.fetchone()[0] or 0) + 1
            result["queuePosition"] = queue_pos
            # 从 system_settings 获取配置
            settings_row = await conn.execute(
                text("SELECT value FROM system_settings WHERE key = 'ocr_minutes_per_book'")
            )
            mins_per_book = int((settings_row.fetchone() or (5,))[0])
            result["estimatedMinutes"] = max(mins_per_book, queue_pos * mins_per_book + (page_count or 100) // 50)
        
        elif ocr_status == 'processing':
            settings_row = await conn.execute(
                text("SELECT value FROM system_settings WHERE key = 'ocr_minutes_per_book'")
            )
            mins_per_book = int((settings_row.fetchone() or (5,))[0])
            result["estimatedMinutes"] = max(mins_per_book, (page_count or 100) // 50)
        
        elif ocr_status == 'completed':
            result["completedAt"] = str(vector_indexed_at) if vector_indexed_at else None
        
        elif ocr_status == 'failed':
            result["errorCode"] = "ocr_failed"
            if ocr_error:
                result["errorMessage"] = ocr_error
        
        return result


@router.get("/{book_id}/ocr/page/{page}")
async def get_book_ocr_page(
    book_id: str, 
    page: int,
    auth=Depends(require_user)
):
    """
    获取书籍单页的 OCR 识别结果（含坐标信息）
    用于前端渲染 OCR 文字叠加层，实现文字选择和高亮功能
    
    注意：PDF 每一页的尺寸可能不同，image_width 和 image_height 是该页的实际尺寸
    
    返回格式:
    {
        "regions": [
            {
                "text": "识别的文字",
                "confidence": 0.99,
                "bbox": [x1, y1, x2, y2],  # 边界框坐标
                "polygon": [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]  # 4点多边形
            },
            ...
        ],
        "page": 1,
        "image_width": 1240,  # 该页的原始图片宽度（用于坐标映射）
        "image_height": 1754  # 该页的原始图片高度
    }
    """
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                "SELECT digitalize_report_key FROM books WHERE id = cast(:id as uuid)"
            ),
            {"id": book_id},
        )
        row = res.fetchone()
        if not row or not row[0]:
            raise HTTPException(status_code=404, detail="ocr_not_available")
        
        report_key = row[0]
        
        try:
            from .storage import read_full
            report_data = read_full(BOOKS_BUCKET, report_key)
            if not report_data:
                raise Exception("Report not found")
            
            import json
            report = json.loads(report_data)
            ocr_result = report.get("ocr", {})
            all_regions = ocr_result.get("regions", [])
            
            # 筛选指定页的 regions
            page_regions = [
                {
                    "text": r.get("text", ""),
                    "confidence": r.get("confidence", 0),
                    "bbox": r.get("bbox"),
                    "polygon": r.get("polygon"),
                }
                for r in all_regions
                if r.get("page") == page
            ]
            
            # 获取该页的图片尺寸
            # PDF 每一页的尺寸可能不同，需要从报告中读取每页的实际尺寸
            page_sizes = report.get("page_sizes", {})  # {"1": {"width": 1240, "height": 1754}, ...}
            page_size = page_sizes.get(str(page), {})
            
            if page_size:
                image_width = page_size.get("width", 0)
                image_height = page_size.get("height", 0)
            else:
                # 如果报告中没有该页尺寸，从该页的 region 坐标推断
                max_x, max_y = 0.0, 0.0
                for r in page_regions:
                    bbox = r.get("bbox", [])
                    if bbox and len(bbox) >= 4:
                        max_x = max(max_x, bbox[2])  # x2
                        max_y = max(max_y, bbox[3])  # y2
                
                if max_x > 0 and max_y > 0:
                    # 添加约 8% 边距估算完整页面尺寸
                    image_width = int(max_x * 1.08)
                    image_height = int(max_y * 1.08)
                else:
                    # 无法推断时返回 0 表示未知
                    image_width = 0
                    image_height = 0
            
            return {
                "status": "success",
                "data": {
                    "regions": page_regions,
                    "page": page,
                    "image_width": image_width,
                    "image_height": image_height,
                    "total_regions": len(page_regions),
                }
            }
        except Exception as e:
            print(f"[OCR] Failed to read page {page} OCR: {e}")
            raise HTTPException(status_code=500, detail=str(e))


@router.get("/{book_id}/ocr/search")
async def search_book_ocr(
    book_id: str, 
    q: str = Query(..., min_length=1, description="搜索关键词"),
    auth=Depends(require_user)
):
    """
    在书籍 OCR 内容中搜索
    使用 OpenSearch 进行全文搜索
    """
    import requests
    
    user_id, _ = auth
    ES_URL = os.getenv("ES_URL", "http://opensearch:9200")
    
    if not ES_URL:
        raise HTTPException(status_code=503, detail="search_unavailable")
    
    try:
        query = {
            "query": {
                "bool": {
                    "must": [
                        {"match": {"content": q}},
                        {"term": {"book_id": book_id}},
                        {"term": {"user_id": user_id}},
                    ]
                }
            },
            "size": 50,
            "sort": [{"page": "asc"}],
            "_source": ["page", "content"],
            "highlight": {
                "fields": {"content": {}},
                "pre_tags": ["<mark>"],
                "post_tags": ["</mark>"],
            }
        }
        
        resp = requests.post(f"{ES_URL}/book_content/_search", json=query, timeout=10)
        resp.raise_for_status()
        result = resp.json()
        
        hits = []
        for hit in result.get("hits", {}).get("hits", []):
            src = hit.get("_source", {})
            highlight = hit.get("highlight", {}).get("content", [])
            hits.append({
                "page": src.get("page"),
                "content": src.get("content", "")[:200],
                "highlight": highlight[0] if highlight else None,
                "score": hit.get("_score", 0),
            })
        
        return {
            "status": "success",
            "data": {
                "query": q,
                "total": result.get("hits", {}).get("total", {}).get("value", 0),
                "hits": hits,
            }
        }
    except Exception as e:
        print(f"[Search] Failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{book_id}/presign_put_converted")
async def presign_put_converted(book_id: str, auth=Depends(require_user)):
    user_id, _ = auth
    key = make_object_key(user_id, f"converted/{book_id}.epub")
    url = presigned_put(BOOKS_BUCKET, key)
    return {"status": "success", "data": {"put_url": url, "key": key}}


@router.post("/{book_id}/presign_get_source")
async def presign_get_source(book_id: str, auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                "SELECT minio_key, original_format FROM books WHERE id = cast(:id as uuid) AND user_id = current_setting('app.user_id')::uuid"
            ),
            {"id": book_id},
        )
        row = res.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="not_found")
        key, fmt = row[0], (row[1] or "").lower()
        if isinstance(key, str) and key.startswith("http"):
            try:
                from urllib.parse import urlparse, urlunparse

                u = urlparse(key)
                if u.hostname in ("127.0.0.1", "localhost"):
                    # 重写为主机网关域名，容器可达
                    host = "host.docker.internal" + (f":{u.port}" if u.port else "")
                    key = urlunparse(
                        (u.scheme, host, u.path, u.params, u.query, u.fragment)
                    )
                else:
                    # 直接外链下载并写入MinIO，保障后续内部访问
                    import urllib.request

                    with urllib.request.urlopen(key) as resp:
                        data = resp.read()
                    ext = ("." + fmt) if fmt else ""
                    new_key = make_object_key(user_id, f"ingested-{book_id}{ext}")
                    upload_bytes(
                        BOOKS_BUCKET, new_key, data, "application/octet-stream"
                    )
                    await conn.execute(
                        text(
                            "UPDATE books SET minio_key = :k, updated_at = now() WHERE id = cast(:id as uuid)"
                        ),
                        {"k": new_key, "id": book_id},
                    )
                    key = new_key
            except Exception:
                raise HTTPException(status_code=400, detail="ingest_failed")
        if isinstance(key, str) and key.startswith("http"):
            from urllib.parse import urlparse

            u = urlparse(key)
            # 解析 bucket 与 object key 并返回内部 presign GET，保证可访问
            path = u.path.lstrip("/")
            parts = path.split("/", 1)
            if len(parts) == 2:
                bkt, obj = parts[0], parts[1]
                url = presigned_get(bkt, obj)
                return {"status": "success", "data": {"get_url": url}}
            return {"status": "success", "data": {"get_url": key}}
        url = presigned_get(BOOKS_BUCKET, key)
    return {"status": "success", "data": {"get_url": url}}


@router.post("/{book_id}/set_converted")
async def set_converted(
    book_id: str, body: dict = Body(...), auth=Depends(require_user)
):
    user_id, _ = auth
    key = body.get("key")
    if not key:
        raise HTTPException(status_code=400, detail="missing_key")
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await _ensure_books_fields(conn)
        await conn.execute(
            text(
                "UPDATE books SET converted_epub_key = :k, updated_at = now() WHERE id = cast(:id as uuid) AND user_id = current_setting('app.user_id')::uuid"
            ),
            {"k": key, "id": book_id},
        )
    try:
        import json as _j

        await ws_broadcast(
            f"book:{book_id}", _j.dumps({"event": "STANDARDIZED", "epub_key": key})
        )
    except Exception:
        pass
    return {"status": "success"}


@router.get("")
async def list_books(
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = Query(None),
    auth=Depends(require_user),
):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await _ensure_books_fields(conn)
        cond = "WHERE user_id = current_setting('app.user_id')::uuid"
        order = "ORDER BY updated_at DESC, id DESC"
        params = {"limit": limit + 1}
        if cursor:
            try:
                ts_str, last_id = cursor.split("|", 1)
                cond += " AND (updated_at < cast(:ts as timestamptz) OR (updated_at = cast(:ts as timestamptz) AND id < cast(:id as uuid)))"
                params.update({"ts": ts_str, "id": last_id})
            except Exception:
                pass
        q = text(
            """
            SELECT b.id::text, b.title, b.author, b.language, b.original_format, b.minio_key, b.size, b.created_at, b.updated_at, b.version, COALESCE(b.is_digitalized,false), COALESCE(b.initial_digitalization_confidence,0), b.cover_image_key,
                   COALESCE(rp.progress, 0) as progress, rp.finished_at, b.converted_epub_key
            FROM books b
            LEFT JOIN reading_progress rp ON rp.book_id = b.id AND rp.user_id = current_setting('app.user_id')::uuid
            """
            + cond.replace("WHERE", "WHERE b.")
            + "\n"
            + order.replace("updated_at", "b.updated_at").replace("id", "b.id")
            + "\n"
            + "LIMIT :limit"
        )
        res = await conn.execute(q, params)
        rows = res.fetchall()
        take = rows[:limit]
        items = []

        def _hint(key: str, lang: str, size: int | None):
            try:
                head = read_head(BOOKS_BUCKET, key, 65536)
                if not head:
                    return None
                txt = None
                for enc in ("utf-8", "gb18030", "latin1"):
                    try:
                        txt = head.decode(enc, errors="ignore")
                        break
                    except Exception:
                        continue
                if not txt:
                    return None
                import re

                cjk = len(re.findall(r"[\u4e00-\u9fff]", txt))
                latin_words = len(re.findall(r"[A-Za-z]+", txt))
                if lang and lang.lower().startswith("zh"):
                    ratio = cjk / max(1, len(txt))
                    bpc = 2.0
                    est = int((ratio) * (size or 0) / bpc) if size else cjk
                    return f"约{est/10000.0:.1f}万字"
                else:
                    # 近似估算词数
                    return f"约{latin_words}词"
            except Exception:
                return None

        for r in take:
            # 优先使用转换后的 EPUB，否则使用原始 minio_key
            key_for_download = r[15] if r[15] else r[5]  # r[15] = converted_epub_key, r[5] = minio_key
            download = key_for_download
            if not (isinstance(download, str) and download.startswith("http")):
                download = presigned_get(BOOKS_BUCKET, key_for_download)
            hint = _hint(key_for_download, r[3] or "", r[6])
            # 生成封面 URL
            cover_url = None
            if r[12]:  # cover_image_key
                cover_url = presigned_get(BOOKS_BUCKET, r[12])
            items.append(
                {
                    "id": r[0],
                    "title": r[1],
                    "author": r[2],
                    "language": r[3],
                    "original_format": r[4],
                    "size": r[6],
                    "created_at": str(r[7]),
                    "updated_at": str(r[8]),
                    "etag": f'W/"{int(r[9])}"',
                    "download_url": download,
                    "cover_url": cover_url,
                    "text_hint": hint,
                    "is_digitalized": bool(r[10]),
                    "initial_digitalization_confidence": float(r[11]),
                    "progress": float(r[13]) if r[13] else 0,  # 添加阅读进度
                    "finished_at": str(r[14]) if r[14] else None,  # 已读完时间
                }
            )
        next_cursor = None
        if len(rows) > limit:
            last = take[-1]
            next_cursor = f"{last[8]}|{last[0]}"
        return {
            "status": "success",
            "data": {
                "items": items,
                "next_cursor": next_cursor,
                "has_more": len(rows) > limit,
            },
        }


@router.get("/{book_id}")
async def get_book(book_id: str, auth=Depends(require_user), response: Response = None):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await _ensure_books_fields(conn)
        res = await conn.execute(
            text(
                """
            SELECT id::text, title, author, language, original_format, minio_key, size, created_at, updated_at, version,
                   COALESCE(is_digitalized,false), COALESCE(initial_digitalization_confidence,0), converted_epub_key, digitalize_report_key, cover_image_key
            FROM books WHERE id = cast(:id as uuid)
            """
            ),
            {"id": book_id},
        )
        row = res.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="not_found")
        if response is not None:
            response.headers["ETag"] = f'W/"{int(row[9])}"'
        # 优先使用转换后的 EPUB，否则使用原始 minio_key
        key_for_download = row[12] if row[12] else row[5]  # row[12] = converted_epub_key, row[5] = minio_key
        download = key_for_download
        if not (isinstance(download, str) and download.startswith("http")):
            download = presigned_get(BOOKS_BUCKET, key_for_download)
        hint = None
        try:
            head = read_head(BOOKS_BUCKET, key_for_download, 65536)
            if head:
                for enc in ("utf-8", "gb18030", "latin1"):
                    try:
                        txt = head.decode(enc, errors="ignore")
                        break
                    except Exception:
                        txt = None
                if txt:
                    import re

                    cjk = len(re.findall(r"[\u4e00-\u9fff]", txt))
                    latin_words = len(re.findall(r"[A-Za-z]+", txt))
                    if (row[3] or "").lower().startswith("zh"):
                        hint = f"约{cjk/10000.0:.1f}万字"
                    else:
                        hint = f"约{latin_words}词"
        except Exception:
            hint = None
        # 生成封面 URL
        cover_url = None
        if row[14]:  # cover_image_key
            cover_url = presigned_get(BOOKS_BUCKET, row[14])
        return {
            "status": "success",
            "data": {
                "id": row[0],
                "title": row[1],
                "author": row[2],
                "language": row[3],
                "original_format": row[4],
                "size": row[6],
                "created_at": str(row[7]),
                "updated_at": str(row[8]),
                "etag": f'W/"{int(row[9])}"',
                "download_url": download,
                "cover_url": cover_url,
                "text_hint": hint,
                "is_digitalized": bool(row[10]),
                "initial_digitalization_confidence": float(row[11]),
                "converted_epub_key": row[12],
                "digitalize_report_key": row[13],
            },
        }


@router.post("/register")
async def register_book(body: dict = Body(...), auth=Depends(require_user)):
    user_id, _ = auth
    object_url = body.get("object_url")
    if not object_url or not isinstance(object_url, str):
        raise HTTPException(status_code=400, detail="invalid_object_url")
    title = body.get("title") or "Untitled"
    author = body.get("author") or ""
    language = body.get("language") or ""
    original_format = (body.get("original_format") or "").lower()
    size = body.get("size") or None
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await _ensure_books_fields(conn)
        res = await conn.execute(
            text(
                "SELECT id::text FROM books WHERE user_id = current_setting('app.user_id')::uuid AND minio_key = :key"
            ),
            {"key": object_url},
        )
        row = res.fetchone()
        if row:
            return {
                "status": "success",
                "data": {"id": row[0], "download_url": object_url},
            }
        book_id = str(uuid.uuid4())
        img_based, conf = _quick_confidence(BOOKS_BUCKET, object_url)
        await conn.execute(
            text(
                """
            INSERT INTO books(id, user_id, title, author, language, original_format, minio_key, size, is_digitalized, initial_digitalization_confidence)
            VALUES (cast(:id as uuid), cast(:uid as uuid), :title, :author, :language, :fmt, :key, :size, :dig, :conf)
            """
            ),
            {
                "id": book_id,
                "uid": user_id,
                "title": title,
                "author": author,
                "language": language,
                "fmt": original_format,
                "key": object_url,
                "size": size,
                "dig": (conf >= 0.8),
                "conf": conf,
            },
        )
    index_book(book_id, user_id, title, author)
    return {"status": "success", "data": {"id": book_id, "download_url": object_url}}


@router.post("/{book_id}/deep_analyze")
async def deep_analyze(book_id: str, auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await _ensure_books_fields(conn)
        res = await conn.execute(
            text(
                "SELECT minio_key FROM books WHERE id = cast(:id as uuid) AND user_id = current_setting('app.user_id')::uuid"
            ),
            {"id": book_id},
        )
        row = res.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="not_found")
        key = row[0]
        img_based, conf = _quick_confidence(BOOKS_BUCKET, key)
        report = {"is_image_based": img_based, "confidence": conf}
        rep_key = make_object_key(user_id, f"digitalize-report-{book_id}.json")
        import json

        upload_bytes(
            BOOKS_BUCKET,
            rep_key,
            json.dumps(report).encode("utf-8"),
            "application/json",
        )
        await conn.execute(
            text(
                "UPDATE books SET is_digitalized = :dig, initial_digitalization_confidence = :conf, digitalize_report_key = :rk, updated_at = now() WHERE id = cast(:id as uuid)"
            ),
            {
                "dig": (not img_based and conf >= 0.8),
                "conf": conf,
                "rk": rep_key,
                "id": book_id,
            },
        )
        # 若未设置页数则补充占位
        await conn.execute(
            text(
                "UPDATE books SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('page_count', 1) WHERE id = cast(:id as uuid) AND (meta->>'page_count') IS NULL"
            ),
            {"id": book_id},
        )
    return {
        "status": "success",
        "data": {"is_digitalized": (not img_based and conf >= 0.8), "confidence": conf},
    }


@router.delete("/{book_id}")
async def delete_book(book_id: str, quota=Depends(require_write_permission), auth=Depends(require_user)):
    """
    完全删除书籍及其所有关联数据：
    - 书架关联 (shelf_items)
    - 笔记 (notes) 和笔记标签关联 (note_tags)
    - 高亮 (highlights) 和高亮标签关联 (highlight_tags)
    - AI 对话 (ai_conversations) 和消息 (ai_messages)
    - 阅读进度 (reading_progress)
    - 阅读会话 (reading_sessions)
    - 转换任务 (conversion_jobs)
    - OCR 任务 (ocr_jobs)
    - 书籍本身 (books)
    """
    user_id, _ = auth
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
            )
            
            # 1. 删除书架关联
            await conn.execute(
                text("DELETE FROM shelf_items WHERE book_id = cast(:id as uuid)"),
                {"id": book_id},
            )
            
            # 2. 删除笔记标签关联，然后删除笔记
            await conn.execute(
                text("DELETE FROM note_tags WHERE note_id IN (SELECT id FROM notes WHERE book_id = cast(:id as uuid))"),
                {"id": book_id},
            )
            await conn.execute(
                text("DELETE FROM notes WHERE book_id = cast(:id as uuid)"),
                {"id": book_id},
            )
            
            # 3. 删除高亮标签关联，然后删除高亮
            await conn.execute(
                text("DELETE FROM highlight_tags WHERE highlight_id IN (SELECT id FROM highlights WHERE book_id = cast(:id as uuid))"),
                {"id": book_id},
            )
            await conn.execute(
                text("DELETE FROM highlights WHERE book_id = cast(:id as uuid)"),
                {"id": book_id},
            )
            
            # 4. 删除 AI 对话上下文和消息
            # ai_conversation_contexts.book_ids 是 JSONB 数组，需要用 @> 操作符检查
            # 先找出包含此 book_id 的对话
            await conn.execute(
                text("""
                    DELETE FROM ai_conversation_contexts 
                    WHERE book_ids @> to_jsonb(ARRAY[cast(:id as text)])::jsonb
                """),
                {"id": book_id},
            )
            # 删除没有 context 的孤立对话的消息和对话本身
            await conn.execute(
                text("""
                    DELETE FROM ai_messages 
                    WHERE conversation_id NOT IN (SELECT conversation_id FROM ai_conversation_contexts)
                """),
            )
            await conn.execute(
                text("""
                    DELETE FROM ai_conversations 
                    WHERE id NOT IN (SELECT conversation_id FROM ai_conversation_contexts)
                """),
            )
            
            # 5. 删除阅读进度和会话
            await conn.execute(
                text("DELETE FROM reading_progress WHERE book_id = cast(:id as uuid)"),
                {"id": book_id},
            )
            await conn.execute(
                text("DELETE FROM reading_sessions WHERE book_id = cast(:id as uuid)"),
                {"id": book_id},
            )
            
            # 6. 删除转换任务和 OCR 任务
            await conn.execute(
                text("DELETE FROM conversion_jobs WHERE book_id = cast(:id as uuid)"),
                {"id": book_id},
            )
            await conn.execute(
                text("DELETE FROM ocr_jobs WHERE book_id = cast(:id as uuid)"),
                {"id": book_id},
            )
            
            # 7. 最后删除书籍本身
            res = await conn.execute(
                text("DELETE FROM books WHERE id = cast(:id as uuid)"), {"id": book_id}
            )
            if res.rowcount == 0:
                raise HTTPException(status_code=404, detail="not_found")
        
        # 从搜索索引中删除
        delete_book_from_index(book_id)
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[Delete Book] Error: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"delete_failed: {str(e)}")


@router.patch("/{book_id}/metadata")
async def update_book_metadata(
    book_id: str,
    body: dict = Body(...),
    if_match: str | None = Header(None),
    auth=Depends(require_user),
):
    """
    用户确认或修改书籍的元数据（书名、作者）。
    
    Request Body:
    {
        "title"?: string,       // 书籍名称
        "author"?: string,      // 作者
        "confirmed": boolean    // 是否标记为已确认（即使不修改也可确认）
    }
    
    支持乐观锁（If-Match 头），防止并发冲突。
    更新成功后设置 metadata_confirmed=true, metadata_confirmed_at=now()
    """
    import hashlib
    
    user_id, _ = auth
    title = body.get("title")
    author = body.get("author")
    confirmed = body.get("confirmed", True)
    
    # 乐观锁检查（可选）
    current_version = None
    if if_match and if_match.startswith('W/"'):
        try:
            current_version = int(if_match.split('"')[1])
        except Exception:
            raise HTTPException(status_code=400, detail="invalid_if_match")
    
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        
        # 获取当前书籍信息
        res = await conn.execute(
            text("""
                SELECT id, title, author, version, metadata_confirmed
                FROM books WHERE id = cast(:id as uuid)
            """),
            {"id": book_id},
        )
        row = res.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="book_not_found")
        
        book_id_db, old_title, old_author, version, already_confirmed = row
        
        # 乐观锁版本检查
        if current_version is not None and version != current_version:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "version_conflict",
                    "message": "书籍信息已被其他设备修改，请刷新后重试",
                    "currentVersion": version
                }
            )
        
        # 计算新的元数据
        new_title = title if title is not None else old_title
        new_author = author if author is not None else old_author
        
        # 生成元数据版本指纹 (sha256 的前 16 位)
        metadata_str = f"{new_title}|{new_author or ''}"
        metadata_hash = hashlib.sha256(metadata_str.encode('utf-8')).hexdigest()[:16]
        metadata_version = f"sha256:{metadata_hash}"
        
        # 更新数据库
        if confirmed:
            update_res = await conn.execute(
                text("""
                    UPDATE books SET
                        title = COALESCE(:title, title),
                        author = COALESCE(:author, author),
                        metadata_confirmed = TRUE,
                        metadata_confirmed_at = now(),
                        version = version + 1,
                        updated_at = now()
                    WHERE id = cast(:id as uuid)
                    RETURNING version
                """),
                {"title": title, "author": author, "id": book_id},
            )
        else:
            update_res = await conn.execute(
                text("""
                    UPDATE books SET
                        title = COALESCE(:title, title),
                        author = COALESCE(:author, author),
                        version = version + 1,
                        updated_at = now()
                    WHERE id = cast(:id as uuid)
                    RETURNING version
                """),
                {"title": title, "author": author, "id": book_id},
            )
        
        new_version_row = update_res.fetchone()
        new_version = new_version_row[0] if new_version_row else version + 1
        
        # 获取更新后的完整信息
        final_res = await conn.execute(
            text("""
                SELECT id, title, author, metadata_confirmed, metadata_confirmed_at, version
                FROM books WHERE id = cast(:id as uuid)
            """),
            {"id": book_id},
        )
        final_row = final_res.fetchone()
    
    return {
        "id": str(final_row[0]),
        "title": final_row[1],
        "author": final_row[2],
        "metadataConfirmed": bool(final_row[3]),
        "metadataConfirmedAt": str(final_row[4]) if final_row[4] else None,
        "metadataVersion": metadata_version,
        "version": final_row[5]
    }


@router.patch("/{book_id}")
async def update_book(
    book_id: str,
    body: dict = Body(...),
    if_match: str | None = Header(None),
    quota=Depends(require_write_permission),
    auth=Depends(require_user),
):
    user_id, _ = auth
    if not if_match or not if_match.startswith('W/"'):
        raise HTTPException(status_code=428, detail="missing_if_match")
    try:
        current_version = int(if_match.split('"')[1])
    except Exception:
        raise HTTPException(status_code=400, detail="invalid_if_match")
    title = body.get("title")
    author = body.get("author")
    language = body.get("language")
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                """
            UPDATE books SET
              title = COALESCE(:title, title),
              author = COALESCE(:author, author),
              language = COALESCE(:language, language),
              version = version + 1,
              updated_at = now()
            WHERE id = cast(:id as uuid) AND version = :ver
            """
            ),
            {
                "title": title,
                "author": author,
                "language": language,
                "id": book_id,
                "ver": current_version,
            },
        )
        if res.rowcount == 0:
            raise HTTPException(status_code=409, detail="version_conflict")
    return {"status": "success"}


@router.get("/{book_id}/presign")
async def presign_book_download(book_id: str, auth=Depends(require_user)):
    user_id, _ = auth
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
            raise HTTPException(status_code=404, detail="not_found")
        return {
            "status": "success",
            "data": {"download_url": presigned_get(BOOKS_BUCKET, row[0])},
        }


@router.post("/{book_id}/convert")
async def request_convert(
    book_id: str, body: dict = Body(...), auth=Depends(require_user)
):
    user_id, _ = auth
    target_format = (body.get("target_format") or "epub").lower()
    job_id = str(uuid.uuid4())
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
            raise HTTPException(status_code=404, detail="not_found")
        source_key = row[0]
        await conn.execute(
            text(
                """
            INSERT INTO conversion_jobs(id, user_id, book_id, source_key, target_format, status)
            VALUES (cast(:id as uuid), cast(:uid as uuid), cast(:bid as uuid), :src, :fmt, 'pending')
            """
            ),
            {
                "id": job_id,
                "uid": user_id,
                "bid": book_id,
                "src": source_key,
                "fmt": target_format,
            },
        )
    return {"status": "success", "data": {"job_id": job_id, "status": "pending"}}


@router.get("/jobs/list")
async def list_jobs(status: str | None = Query(None), auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        if status:
            res = await conn.execute(
                text(
                    "SELECT id::text, book_id::text, target_format, status, created_at FROM conversion_jobs WHERE user_id = current_setting('app.user_id')::uuid AND status = :st ORDER BY created_at DESC"
                ),
                {"st": status},
            )
        else:
            res = await conn.execute(
                text(
                    "SELECT id::text, book_id::text, target_format, status, created_at FROM conversion_jobs WHERE user_id = current_setting('app.user_id')::uuid ORDER BY created_at DESC"
                )
            )
        rows = res.fetchall()
        return {
            "status": "success",
            "data": [
                {
                    "id": r[0],
                    "book_id": r[1],
                    "target_format": r[2],
                    "status": r[3],
                    "created_at": str(r[4]),
                }
                for r in rows
            ],
        }


@router.post("/jobs/{job_id}/complete")
async def complete_job(
    job_id: str, body: dict = Body(None), auth=Depends(require_user)
):
    user_id, _ = auth
    output_key = (body or {}).get("output_key") or ""
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await conn.execute(
            text(
                "UPDATE conversion_jobs SET status='completed', output_key = COALESCE(:out, output_key), updated_at = now() WHERE id = cast(:id as uuid) AND user_id = current_setting('app.user_id')::uuid"
            ),
            {"id": job_id, "out": output_key},
        )
    return {"status": "success"}


@router.post("/jobs/{job_id}/fail")
async def fail_job(job_id: str, body: dict = Body(...), auth=Depends(require_user)):
    user_id, _ = auth
    message = body.get("error") or ""
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await conn.execute(
            text(
                "UPDATE conversion_jobs SET status='failed', error = :msg, updated_at = now() WHERE id = cast(:id as uuid) AND user_id = current_setting('app.user_id')::uuid"
            ),
            {"id": job_id, "msg": message},
        )
    return {"status": "success"}


@router.post("/jobs/{job_id}/simulate")
async def simulate_job(job_id: str, auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                "SELECT book_id::text FROM conversion_jobs WHERE id = cast(:id as uuid) AND user_id = current_setting('app.user_id')::uuid"
            ),
            {"id": job_id},
        )
        row = res.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="not_found")
        book_id = row[0]
        out_key = f"converted/{book_id}.epub"
        upload_bytes(
            BOOKS_BUCKET, out_key, b"converted content", "application/epub+zip"
        )
        res2 = await conn.execute(
            text(
                "SELECT price_amount, unit_size, currency FROM pricing_rules WHERE service_type = 'VECTORIZE' AND unit_type = 'CHARS' AND is_active = TRUE ORDER BY updated_at DESC LIMIT 1"
            )
        )
        rule = res2.fetchone()
        if rule:
            import math

            qty = 100000
            max(1, math.ceil(qty / int(rule[1])))
            sres = await conn.execute(
                text("SELECT key, value FROM system_settings WHERE key LIKE 'free_%'")
            )
            settings = {r[0]: r[1] for r in sres.fetchall()}
            mtres = await conn.execute(
                text(
                    "SELECT membership_tier FROM users WHERE id = current_setting('app.user_id')::uuid"
                )
            )
            mtrow = mtres.fetchone()
            tier = (mtrow and mtrow[0]) or "FREE"
            tres = await conn.execute(
                text("SELECT value FROM system_settings WHERE key = 'membership_tiers'")
            )
            trow = tres.fetchone()
            mconf = trow and trow[0]
            free_chars = None
            if isinstance(mconf, dict) and tier in mconf:
                try:
                    free_chars = int((mconf[tier] or {}).get("free_vector_chars") or 0)
                except Exception:
                    free_chars = 0
            if free_chars is None:
                free_chars = int(settings.get("free_vector_chars", 0))

            ures = await conn.execute(
                text(
                    "SELECT used_units FROM free_quota_usage WHERE owner_id = current_setting('app.user_id')::uuid AND service_type = 'VECTORIZE' AND period_start = current_date"
                )
            )
            urow = ures.fetchone()
            used = int(urow[0]) if urow else 0
            remain = max(0, free_chars - used)
            payable_chars = max(0, qty - remain)
            if remain > 0:
                await conn.execute(
                    text(
                        "INSERT INTO free_quota_usage(owner_id, service_type, used_units) VALUES (current_setting('app.user_id')::uuid, 'VECTORIZE', :u) ON CONFLICT (owner_id, service_type, period_start) DO UPDATE SET used_units = free_quota_usage.used_units + EXCLUDED.used_units"
                    ),
                    {"u": min(qty, remain)},
                )
            if payable_chars > 0:
                units_pay = max(1, math.ceil(payable_chars / int(rule[1])))
                amt = int(round(float(rule[0]) * 100)) * units_pay
                await conn.execute(
                    text(
                        "INSERT INTO credit_accounts(owner_id) VALUES (current_setting('app.user_id')::uuid) ON CONFLICT (owner_id) DO NOTHING"
                    )
                )
                bal = await conn.execute(
                    text(
                        "SELECT balance FROM credit_accounts WHERE owner_id = current_setting('app.user_id')::uuid"
                    )
                )
                b = bal.fetchone()
                if not b or int(b[0]) < amt:
                    await conn.execute(
                        text(
                            "UPDATE conversion_jobs SET status='failed', updated_at = now() WHERE id = cast(:id as uuid) AND user_id = current_setting('app.user_id')::uuid"
                        ),
                        {"id": job_id},
                    )
                    raise HTTPException(status_code=400, detail="insufficient_balance")
                await conn.execute(
                    text(
                        "UPDATE credit_accounts SET balance = balance - :amt, updated_at = now() WHERE owner_id = current_setting('app.user_id')::uuid"
                    ),
                    {"amt": amt},
                )
                lid = str(uuid.uuid4())
                await conn.execute(
                    text(
                        "INSERT INTO credit_ledger(id, owner_id, amount, currency, reason, related_id, direction) VALUES (cast(:id as uuid), current_setting('app.user_id')::uuid, :amt, :cur, 'vectorize', cast(:rid as uuid), 'debit')"
                    ),
                    {"id": lid, "amt": amt, "cur": rule[2], "rid": job_id},
                )
        await conn.execute(
            text(
                "UPDATE conversion_jobs SET status='completed', output_key = :out, updated_at = now() WHERE id = cast(:id as uuid) AND user_id = current_setting('app.user_id')::uuid"
            ),
            {"id": job_id, "out": out_key},
        )
    return {"status": "success", "data": {"output_key": out_key}}


@shelves_router.post("")
async def create_shelf(
    body: dict = Body(...),
    idempotency_key: str | None = Header(None),
    quota=Depends(require_write_permission),
    auth=Depends(require_user),
):
    user_id, _ = auth
    name = body.get("name")
    if not name:
        raise HTTPException(status_code=400, detail="missing_name")
    description = body.get("description") or ""
    if idempotency_key:
        idem_key = f"idem:shelves:create:{user_id}:{idempotency_key}"
        cached = r.get(idem_key)
        if cached:
            return {"status": "success", "data": {"id": cached}}
    shelf_id = str(uuid.uuid4())
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await conn.execute(
            text(
                "INSERT INTO shelves(id, user_id, name, description) VALUES (cast(:id as uuid), cast(:uid as uuid), :name, :desc)"
            ),
            {"id": shelf_id, "uid": user_id, "name": name, "desc": description},
        )
    if idempotency_key:
        r.setex(idem_key, 24 * 3600, shelf_id)
    return {"status": "success", "data": {"id": shelf_id}}


@shelves_router.get("")
async def list_shelves(
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = Query(None),
    auth=Depends(require_user),
):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        cond = "WHERE user_id = current_setting('app.user_id')::uuid"
        order = "ORDER BY updated_at DESC, id DESC"
        params = {"limit": limit + 1}
        if cursor:
            try:
                ts_str, last_id = cursor.split("|", 1)
                cond += " AND (updated_at < cast(:ts as timestamptz) OR (updated_at = cast(:ts as timestamptz) AND id < cast(:id as uuid)))"
                params.update({"ts": ts_str, "id": last_id})
            except Exception:
                pass
        q = text(
            """
            SELECT id::text, name, description, updated_at, version
            FROM shelves
            """
            + cond
            + "\n"
            + order
            + "\n"
            + "LIMIT :limit"
        )
        res = await conn.execute(q, params)
        rows = res.fetchall()
        take = rows[:limit]
        items = [
            {
                "id": r[0],
                "name": r[1],
                "description": r[2],
                "updated_at": str(r[3]),
                "etag": f'W/"{int(r[4])}"',
            }
            for r in take
        ]
        next_cursor = None
        if len(rows) > limit:
            last = take[-1]
            next_cursor = f"{last[3]}|{last[0]}"
        return {
            "status": "success",
            "data": {
                "items": items,
                "next_cursor": next_cursor,
                "has_more": len(rows) > limit,
            },
        }


@shelves_router.patch("/{shelf_id}")
async def update_shelf(
    shelf_id: str,
    body: dict = Body(...),
    if_match: str | None = Header(None),
    quota=Depends(require_write_permission),
    auth=Depends(require_user),
):
    user_id, _ = auth
    if not if_match or not if_match.startswith('W/"'):
        raise HTTPException(status_code=428, detail="missing_if_match")
    try:
        current_version = int(if_match.split('"')[1])
    except Exception:
        raise HTTPException(status_code=400, detail="invalid_if_match")
    name = body.get("name")
    description = body.get("description")
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                """
            UPDATE shelves SET
              name = COALESCE(:name, name),
              description = COALESCE(:desc, description),
              version = version + 1,
              updated_at = now()
            WHERE id = cast(:id as uuid) AND version = :ver
            """
            ),
            {"name": name, "desc": description, "id": shelf_id, "ver": current_version},
        )
        if res.rowcount == 0:
            raise HTTPException(status_code=409, detail="version_conflict")
    return {"status": "success"}


@shelves_router.post("/{shelf_id}/items")
async def add_item(
    shelf_id: str,
    body: dict = Body(...),
    idempotency_key: str | None = Header(None),
    quota=Depends(require_write_permission),
    auth=Depends(require_user),
):
    user_id, _ = auth
    book_id = body.get("book_id")
    if not book_id:
        raise HTTPException(status_code=400, detail="missing_book_id")
    if idempotency_key:
        idem_key = (
            f"idem:shelves:add_item:{user_id}:{shelf_id}:{book_id}:{idempotency_key}"
        )
        if r.get(idem_key):
            return {"status": "success"}
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await conn.execute(
            text(
                "INSERT INTO shelf_items(shelf_id, book_id) VALUES (cast(:sid as uuid), cast(:bid as uuid)) ON CONFLICT DO NOTHING"
            ),
            {"sid": shelf_id, "bid": book_id},
        )
    if idempotency_key:
        r.setex(idem_key, 24 * 3600, "1")
    return {"status": "success"}


@shelves_router.get("/{shelf_id}/items")
async def list_items(shelf_id: str, auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                """
            SELECT b.id::text, b.title, b.author, b.language, b.minio_key
            FROM shelf_items si
            JOIN books b ON b.id = si.book_id
            WHERE si.shelf_id = cast(:sid as uuid)
            ORDER BY b.updated_at DESC
            """
            ),
            {"sid": shelf_id},
        )
        rows = res.fetchall()
        return {
            "status": "success",
            "data": [
                {
                    "id": r[0],
                    "title": r[1],
                    "author": r[2],
                    "language": r[3],
                    "download_url": presigned_get(BOOKS_BUCKET, r[4]),
                }
                for r in rows
            ],
        }


@shelves_router.delete("/{shelf_id}/items/{book_id}")
async def remove_item(
    shelf_id: str,
    book_id: str,
    idempotency_key: str | None = Header(None),
    quota=Depends(require_write_permission),
    auth=Depends(require_user),
):
    user_id, _ = auth
    if idempotency_key:
        idem_key = (
            f"idem:shelves:remove_item:{user_id}:{shelf_id}:{book_id}:{idempotency_key}"
        )
        if r.get(idem_key):
            return {"status": "success"}
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await conn.execute(
            text(
                "DELETE FROM shelf_items WHERE shelf_id = cast(:sid as uuid) AND book_id = cast(:bid as uuid)"
            ),
            {"sid": shelf_id, "bid": book_id},
        )
    if idempotency_key:
        r.setex(idem_key, 24 * 3600, "1")
    return {"status": "success"}


@router.post("/upload_proxy")
async def upload_proxy(
    title: str | None = None,
    file: UploadFile = File(...),
    quota=Depends(require_upload_permission),
    auth=Depends(require_user),
):
    user_id, _ = auth
    name = file.filename or "upload.bin"
    fmt = (name.split(".")[-1] or "bin").lower()
    key = make_object_key(user_id, name)
    content = await file.read()
    from .storage import upload_bytes

    upload_bytes(
        os.getenv("MINIO_BUCKET", "athena"),
        key,
        content,
        file.content_type or "application/octet-stream",
    )
    # 轻量置信度
    img_based, conf = _quick_confidence(os.getenv("MINIO_BUCKET", "athena"), key)
    etag = stat_etag(os.getenv("MINIO_BUCKET", "athena"), key)
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        await _ensure_books_fields(conn)
        if etag:
            res = await conn.execute(
                text(
                    "SELECT id::text FROM books WHERE user_id = current_setting('app.user_id')::uuid AND source_etag = :e"
                ),
                {"e": etag},
            )
            row = res.fetchone()
            if row:
                download_url = presigned_get(os.getenv("MINIO_BUCKET", "athena"), key)
                return {
                    "status": "success",
                    "data": {"id": row[0], "download_url": download_url},
                }
        book_id = str(uuid.uuid4())
        await conn.execute(
            text(
                """
            INSERT INTO books(id, user_id, title, original_format, minio_key, is_digitalized, initial_digitalization_confidence, source_etag)
            VALUES (cast(:id as uuid), current_setting('app.user_id')::uuid, :t, :f, :k, :dig, :conf, :etag)
            """
            ),
            {
                "id": book_id,
                "t": title or name.replace(f".{fmt}", ""),
                "k": key,
                "f": fmt,
                "dig": (conf >= 0.8),
                "conf": conf,
                "etag": etag,
            },
        )
    download_url = presigned_get(os.getenv("MINIO_BUCKET", "athena"), key)
    return {"status": "success", "data": {"id": book_id, "download_url": download_url}}
