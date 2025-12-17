"""
上传相关路由

包含：
- /upload_init - 上传初始化（含全局 SHA256 去重）
- /upload_complete - 上传完成
- /dedup_reference - 秒传引用
- /upload_proxy - 文件代理上传
"""
from fastapi import APIRouter, Body, Depends, File, Header, HTTPException, UploadFile
from sqlalchemy import text

from .common import (
    BOOKS_BUCKET, r, engine, uuid, presigned_get, stat_etag,
    make_object_key, upload_bytes, index_book, celery_app,
    require_user, require_upload_permission,
    svc_get_upload_url, read_full, _quick_confidence,
)

router = APIRouter()


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
    content_sha256 = body.get("content_sha256")
    
    # 如果提供了 SHA256，检查全局去重
    if content_sha256 and len(content_sha256) == 64:
        async with engine.begin() as conn:
            await conn.execute(
                text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
            )
            # 1. 先检查当前用户是否已有相同文件（排除软删除的）
            res = await conn.execute(
                text(
                    "SELECT id::text, title FROM books WHERE user_id = cast(:uid as uuid) AND content_sha256 = :sha AND deleted_at IS NULL"
                ),
                {"uid": user_id, "sha": content_sha256},
            )
            own_row = res.fetchone()
            if own_row:
                return {
                    "status": "success",
                    "data": {
                        "dedup_hit": "own",
                        "existing_book_id": own_row[0],
                        "existing_title": own_row[1],
                        "message": "您已上传过该文件"
                    }
                }
            
            # 2. 检查全局是否有相同文件
            res = await conn.execute(
                text(
                    """SELECT id::text, minio_key, cover_image_key, deleted_at
                       FROM books WHERE content_sha256 = :sha 
                       ORDER BY deleted_at IS NULL DESC, created_at ASC
                       LIMIT 1"""
                ),
                {"sha": content_sha256},
            )
            global_row = res.fetchone()
            if global_row:
                canonical_id = global_row[0]
                is_soft_deleted = global_row[3] is not None
                print(f"[Upload Init] Global dedup hit for SHA256 {content_sha256[:16]}..., canonical={canonical_id}, soft_deleted={is_soft_deleted}")
                return {
                    "status": "success",
                    "data": {
                        "dedup_hit": "global",
                        "dedup_available": True,
                        "canonical_book_id": canonical_id,
                        "canonical_minio_key": global_row[1],
                        "canonical_cover_key": global_row[2],
                        "message": "文件已存在，可快速添加到书库"
                    }
                }
    
    # 没有去重命中，返回上传 URL
    print(f"[Upload Init] No dedup hit, creating new upload for {filename}")
    data = await svc_get_upload_url(user_id, filename, content_type)
    data["dedup_hit"] = None
    return {"status": "success", "data": data}


@router.post("/upload_complete")
async def upload_complete(
    body: dict = Body(...),
    idempotency_key: str | None = Header(None),
    auth=Depends(require_user),
):
    import hashlib
    
    user_id, _ = auth
    key = body.get("key")
    if not key:
        raise HTTPException(status_code=400, detail="missing_key")
    title = body.get("title") or "Untitled"
    author = body.get("author") or ""
    language = body.get("language") or ""
    original_format = body.get("original_format") or ""
    size = body.get("size") or None
    content_sha256 = body.get("content_sha256")
    
    # 如果客户端没有提供 SHA256，服务器自己计算
    if not content_sha256 or len(content_sha256) != 64:
        print(f"[Upload] Client did not provide SHA256, computing server-side for {key}...")
        try:
            file_data = read_full(BOOKS_BUCKET, key)
            if file_data:
                content_sha256 = hashlib.sha256(file_data).hexdigest()
                print(f"[Upload] Server computed SHA256: {content_sha256[:16]}...")
            else:
                print(f"[Upload] Warning: Could not read file for SHA256 computation")
                content_sha256 = None
        except Exception as e:
            print(f"[Upload] Warning: Server-side SHA256 computation failed: {e}")
            content_sha256 = None
    
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
                    "SELECT id::text, deleted_at FROM books WHERE user_id = current_setting('app.user_id')::uuid AND source_etag = :e"
                ),
                {"e": etag},
            )
            row = res.fetchone()
            if row:
                existing_book_id = row[0]
                was_deleted = row[1] is not None
                
                if was_deleted:
                    await conn.execute(
                        text("UPDATE books SET deleted_at = NULL, updated_at = now() WHERE id = cast(:id as uuid)"),
                        {"id": existing_book_id},
                    )
                    print(f"[Upload] Restored soft-deleted book {existing_book_id} with same etag")
                
                download_url = presigned_get(BOOKS_BUCKET, key)
                index_book(existing_book_id, user_id, title, author)
                data = {"id": existing_book_id, "download_url": download_url}
                if idempotency_key:
                    r.setex(idem_key, 24 * 3600, str(data))
                try:
                    celery_app.send_task("tasks.analyze_book_type", args=[existing_book_id, user_id])
                    celery_app.send_task("tasks.deep_analyze_book", args=[existing_book_id, user_id])
                except Exception:
                    pass
                return {"status": "success", "data": data}
    
    img_based, conf = _quick_confidence(BOOKS_BUCKET, key)
    
    # 非 EPUB/PDF 格式需要转换
    fmt_lower = (original_format or '').lower()
    needs_conversion = fmt_lower not in ('epub', 'pdf')
    conversion_status = 'pending' if needs_conversion else None
    
    async with engine.begin() as conn:
        await conn.execute(
            text(
                """
        INSERT INTO books(id, user_id, title, author, language, original_format, minio_key, size, is_digitalized, initial_digitalization_confidence, source_etag, content_sha256, storage_ref_count, conversion_status)
        VALUES (cast(:id as uuid), cast(:uid as uuid), :title, :author, :language, :fmt, :key, :size, :dig, :conf, :etag, :sha256, 1, :conv_status)
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
                "conv_status": conversion_status,
            },
        )
        await conn.execute(
            text(
                "UPDATE books SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('page_count', 1, 'needs_manual', true) WHERE id = cast(:id as uuid)"
            ),
            {"id": book_id},
        )
    
    sha_log = content_sha256[:16] if content_sha256 else 'None'
    print(f"[Upload] Created book {book_id} for user {user_id}, SHA256={sha_log}..., title={title}")
    
    download_url = presigned_get(BOOKS_BUCKET, key)
    index_book(book_id, user_id, title, author)
    data = {"id": book_id, "download_url": download_url}
    if idempotency_key:
        r.setex(idem_key, 24 * 3600, str(data))
    
    # 所有格式均使用 Calibre 提取元数据
    try:
        print(f"[Upload] Using Calibre for metadata extraction (format: {fmt_lower})...")
        celery_app.send_task("tasks.extract_ebook_metadata_calibre", args=[book_id, user_id])
        
        if fmt_lower not in ('epub', 'pdf'):
            print(f"[Upload] Non-EPUB/PDF format, also starting conversion to EPUB...")
            celery_app.send_task("tasks.convert_to_epub", args=[book_id, user_id])
            
    except Exception as e:
        print(f"[Upload] Failed to queue background tasks: {e}")
        
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
    import json
    
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
                SELECT minio_key, cover_image_key, size, original_format, is_digitalized, 
                       initial_digitalization_confidence, meta, ocr_status, ocr_result_key
                FROM books WHERE id = cast(:cid as uuid) AND content_sha256 = :sha
                """
            ),
            {"cid": canonical_book_id, "sha": content_sha256},
        )
        canonical = res.fetchone()
        if not canonical:
            raise HTTPException(status_code=404, detail="canonical_book_not_found")
        
        (c_minio_key, c_cover_key, c_size, c_fmt, c_dig, c_conf, c_meta,
         c_ocr_status, c_ocr_result_key) = canonical
        
        # 增加原始存储的引用计数
        await conn.execute(
            text(
                "UPDATE books SET storage_ref_count = COALESCE(storage_ref_count, 1) + 1 WHERE id = cast(:cid as uuid)"
            ),
            {"cid": canonical_book_id},
        )
        
        # 判断是否需要标记为图片型
        canonical_has_ocr = c_ocr_status == 'completed' and c_ocr_result_key is not None
        if canonical_has_ocr:
            new_is_digitalized = True
            new_confidence = c_conf if c_conf and c_conf < 0.5 else 0.1
        else:
            new_is_digitalized = c_dig
            new_confidence = c_conf
        
        await conn.execute(
            text(
                """
                INSERT INTO books(id, user_id, title, author, language, original_format, 
                                  minio_key, cover_image_key, size, is_digitalized, initial_digitalization_confidence,
                                  content_sha256, canonical_book_id, storage_ref_count, meta)
                VALUES (cast(:id as uuid), cast(:uid as uuid), :title, :author, :language, :fmt,
                        :key, :cover, :size, :dig, :conf, :sha256, cast(:cid as uuid), 0, cast(:meta as jsonb))
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
                "dig": new_is_digitalized,
                "conf": new_confidence,
                "sha256": content_sha256,
                "cid": canonical_book_id,
                "meta": json.dumps(c_meta) if c_meta else None,
            },
        )
    
    print(f"[Dedup Reference] Created book {book_id} for user {user_id}, canonical={canonical_book_id}, has_ocr={canonical_has_ocr}")
    
    download_url = presigned_get(BOOKS_BUCKET, c_minio_key)
    index_book(book_id, user_id, title, author)
    
    data = {
        "id": book_id,
        "download_url": download_url,
        "dedup_hit": "global",
        "canonical_has_ocr": canonical_has_ocr,
    }
    
    if idempotency_key:
        r.setex(idem_key, 24 * 3600, str(data))
    
    return {"status": "success", "data": data}


@router.post("/upload_proxy")
async def upload_proxy(
    title: str | None = None,
    file: UploadFile = File(...),
    quota=Depends(require_upload_permission),
    auth=Depends(require_user),
):
    import os as _os
    
    user_id, _ = auth
    name = file.filename or "upload.bin"
    fmt = (name.split(".")[-1] or "bin").lower()
    key = make_object_key(user_id, name)
    content = await file.read()
    
    upload_bytes(
        _os.getenv("MINIO_BUCKET", "athena"),
        key,
        content,
        file.content_type or "application/octet-stream",
    )
    
    img_based, conf = _quick_confidence(_os.getenv("MINIO_BUCKET", "athena"), key)
    etag = stat_etag(_os.getenv("MINIO_BUCKET", "athena"), key)
    
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
                download_url = presigned_get(_os.getenv("MINIO_BUCKET", "athena"), key)
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
    download_url = presigned_get(_os.getenv("MINIO_BUCKET", "athena"), key)
    return {"status": "success", "data": {"id": book_id, "download_url": download_url}}
