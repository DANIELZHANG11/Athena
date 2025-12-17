"""
内容访问相关路由

包含：
- /{book_id}/cover - 获取封面
- /{book_id}/content - 获取书籍内容
- /{book_id}/presign - 预签名下载
- /{book_id}/presign_put_converted - 转换后上传预签名
- /{book_id}/presign_get_source - 源文件获取预签名
"""
import os
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import Response as FastAPIResponse
from sqlalchemy import text
from jose import jwt

from .common import (
    BOOKS_BUCKET, engine, presigned_get, presigned_put,
    make_object_key, upload_bytes, get_s3, ensure_bucket,
    require_user, read_full,
)

router = APIRouter()

AUTH_SECRET = os.getenv("AUTH_SECRET", "dev_secret")


def _parse_auth_token(authorization: str | None, token: str | None) -> str:
    """解析认证 token"""
    auth_token = None
    if authorization and authorization.startswith("Bearer "):
        auth_token = authorization.split(" ", 1)[1]
    elif token:
        auth_token = token
    
    if not auth_token:
        raise HTTPException(status_code=401, detail="unauthorized")
    
    try:
        payload = jwt.decode(auth_token, AUTH_SECRET, algorithms=["HS256"], options={"verify_aud": False})
        return payload["sub"]
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"invalid_token: {str(e)}")


@router.get("/{book_id}/cover")
async def get_book_cover(
    book_id: str,
    token: str = Query(None),
    authorization: str = Header(None),
):
    """
    获取书籍封面图片（通过 API 代理）
    解决移动端无法直接访问 localhost 存储的问题
    """
    user_id = _parse_auth_token(authorization, token)
    
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
                    "Cache-Control": "public, max-age=86400",
                    "Content-Disposition": "inline",
                    "Access-Control-Allow-Origin": "*",
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
    """
    user_id = _parse_auth_token(authorization, token)
    
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
        
        # 优先使用转换后的 EPUB
        if converted_epub_key:
            minio_key = converted_epub_key
            original_format = "epub"
        
        content_type_map = {
            "epub": "application/epub+zip",
            "pdf": "application/pdf",
        }
        content_type = content_type_map.get(original_format, "application/epub+zip")
        
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
                    host = "host.docker.internal" + (f":{u.port}" if u.port else "")
                    key = urlunparse(
                        (u.scheme, host, u.path, u.params, u.query, u.fragment)
                    )
                else:
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
            path = u.path.lstrip("/")
            parts = path.split("/", 1)
            if len(parts) == 2:
                bkt, obj = parts[0], parts[1]
                url = presigned_get(bkt, obj)
                return {"status": "success", "data": {"get_url": url}}
            return {"status": "success", "data": {"get_url": key}}
        url = presigned_get(BOOKS_BUCKET, key)
    return {"status": "success", "data": {"get_url": url}}
