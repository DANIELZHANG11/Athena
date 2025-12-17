"""
书籍元数据相关路由

包含：
- / [GET] - 书籍列表
- /{book_id} [GET] - 书籍详情
- /register - 注册外部书籍
- /{book_id}/deep_analyze - 深度分析
- /{book_id}/metadata [PATCH] - 更新元数据
- /{book_id} [PATCH] - 更新书籍
- /{book_id}/shelves - 获取书籍所属书架
"""
from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Response
from sqlalchemy import text

from .common import (
    BOOKS_BUCKET, engine, uuid, presigned_get, make_object_key,
    upload_bytes, read_head, index_book,
    require_user, require_write_permission, _quick_confidence,
)

router = APIRouter()


@router.get("/")
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
        cond = "WHERE user_id = current_setting('app.user_id')::uuid AND deleted_at IS NULL"
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
                   COALESCE(rp.progress, 0) as progress, rp.finished_at, b.converted_epub_key, b.ocr_status, b.conversion_status
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
                    return f"约{latin_words}词"
            except Exception:
                return None

        for r in take:
            key_for_download = r[15] if r[15] else r[5]
            download = key_for_download
            if not (isinstance(download, str) and download.startswith("http")):
                download = presigned_get(BOOKS_BUCKET, key_for_download)
            hint = _hint(key_for_download, r[3] or "", r[6])
            cover_url = None
            if r[12]:
                cover_url = presigned_get(BOOKS_BUCKET, r[12])
            
            is_image_based = (bool(r[10]) and float(r[11]) < 0.8) or r[16] == 'completed'
            
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
                    "progress": float(r[13]) if r[13] else 0,
                    "finished_at": str(r[14]) if r[14] else None,
                    "ocr_status": r[16],
                    "is_image_based": is_image_based,
                    "conversion_status": r[17],
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
        res = await conn.execute(
            text(
                """
            SELECT id::text, title, author, language, original_format, minio_key, size, created_at, updated_at, version,
                   COALESCE(is_digitalized,false), COALESCE(initial_digitalization_confidence,0), converted_epub_key, digitalize_report_key, cover_image_key,
                   COALESCE(metadata_confirmed, false), ocr_status, meta, deleted_at, user_id, conversion_status
            FROM books WHERE id = cast(:id as uuid)
            """
            ),
            {"id": book_id},
        )
        row = res.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="not_found")
        
        deleted_at = row[18]
        book_user_id = str(row[19])
        if deleted_at is not None and book_user_id != user_id:
            raise HTTPException(status_code=404, detail="not_found")
        
        if response is not None:
            response.headers["ETag"] = f'W/"{int(row[9])}"'
        
        key_for_download = row[12] if row[12] else row[5]
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
        
        cover_url = None
        if row[14]:
            cover_url = presigned_get(BOOKS_BUCKET, row[14])
        
        meta = row[17] or {}
        page_count = meta.get("page_count") if isinstance(meta, dict) else None
        metadata_extracted = meta.get("metadata_extracted", False) if isinstance(meta, dict) else False
        
        is_image_based = (bool(row[10]) and float(row[11]) < 0.8) or row[16] == 'completed'
        
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
                "cover_image_key": row[14],
                "text_hint": hint,
                "is_digitalized": bool(row[10]),
                "initial_digitalization_confidence": float(row[11]),
                "converted_epub_key": row[12],
                "digitalize_report_key": row[13],
                "metadata_confirmed": bool(row[15]),
                "metadata_extracted": bool(metadata_extracted),
                "ocr_status": row[16],
                "page_count": page_count,
                "is_image_based": is_image_based,
                "conversion_status": row[20],
            },
        }


@router.get("/{book_id}/shelves")
async def get_book_shelves(book_id: str, auth=Depends(require_user)):
    """查询某本书所属的所有书架"""
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                """
            SELECT s.id::text, s.name, s.description, s.updated_at
            FROM shelf_items si
            JOIN shelves s ON s.id = si.shelf_id
            WHERE si.book_id = cast(:bid as uuid)
              AND s.user_id = current_setting('app.user_id')::uuid
            ORDER BY s.name
            """
            ),
            {"bid": book_id},
        )
        rows = res.fetchall()
        return {
            "status": "success",
            "data": {
                "items": [
                    {
                        "id": r[0],
                        "name": r[1],
                        "description": r[2],
                        "updated_at": str(r[3]),
                    }
                    for r in rows
                ]
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
    import json
    
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
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


@router.patch("/{book_id}/metadata")
async def update_book_metadata(
    book_id: str,
    body: dict = Body(...),
    if_match: str | None = Header(None),
    auth=Depends(require_user),
):
    """用户确认或修改书籍的元数据（书名、作者）"""
    import hashlib
    
    user_id, _ = auth
    title = body.get("title")
    author = body.get("author")
    confirmed = body.get("confirmed", True)
    
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
        
        if current_version is not None and version != current_version:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "version_conflict",
                    "message": "书籍信息已被其他设备修改，请刷新后重试",
                    "currentVersion": version
                }
            )
        
        new_title = title if title is not None else old_title
        new_author = author if author is not None else old_author
        
        metadata_str = f"{new_title}|{new_author or ''}"
        metadata_hash = hashlib.sha256(metadata_str.encode('utf-8')).hexdigest()[:16]
        metadata_version = f"sha256:{metadata_hash}"
        
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
