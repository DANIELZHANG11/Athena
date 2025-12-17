"""
OCR 相关路由

包含：
- /{book_id}/ocr - 获取 OCR 结果
- /{book_id}/ocr/full - 获取完整 OCR 数据（含坐标）
- /{book_id}/ocr/quota - 获取 OCR 配额信息
- /{book_id}/ocr [POST] - 触发 OCR 任务
- /{book_id}/ocr/status - 获取 OCR 状态
- /{book_id}/ocr/page/{page} - 获取单页 OCR
- /{book_id}/ocr/search - OCR 内容搜索
"""
import os
import gzip
import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import text

from .common import (
    BOOKS_BUCKET, engine, read_full, celery_app, require_user,
)

router = APIRouter()

ES_URL = os.getenv("ES_URL", "http://opensearch:9200")


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
                "SELECT digitalize_report_key, ocr_result_key, is_digitalized, ocr_status FROM books WHERE id = cast(:id as uuid)"
            ),
            {"id": book_id},
        )
        row = res.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="not_found")
        
        old_report_key, new_ocr_key, is_digitalized, ocr_status = row
        report_key = new_ocr_key or old_report_key
        
        if not report_key:
            return {
                "status": "success",
                "data": {
                    "available": False,
                    "is_digitalized": bool(is_digitalized),
                    "ocr_status": ocr_status,
                    "pages": {},
                    "total_pages": 0,
                    "total_chars": 0,
                }
            }
        
        try:
            report_data = read_full(BOOKS_BUCKET, report_key)
            if not report_data:
                raise Exception("Report not found")
            
            report = json.loads(report_data)
            
            if "pages" in report and isinstance(report["pages"], list):
                # 新版格式
                ocr_pages = report.get("pages", [])
                pages_formatted = {}
                total_chars = 0
                
                for page_data in ocr_pages:
                    page_num = page_data.get("page_num", 1)
                    page_text = page_data.get("text", "")
                    if page_text:
                        pages_formatted[str(page_num)] = page_text
                        total_chars += len(page_text)
                
                return {
                    "status": "success",
                    "data": {
                        "available": True,
                        "is_digitalized": bool(is_digitalized),
                        "ocr_status": ocr_status,
                        "is_image_based": True,
                        "confidence": 1.0,
                        "pages": pages_formatted,
                        "total_pages": report.get("total_pages", len(pages_formatted)),
                        "total_chars": total_chars,
                    }
                }
            else:
                # 旧版格式
                ocr_result = report.get("ocr", {})
                ocr_pages = ocr_result.get("pages", [])
                
                pages_dict = {}
                for item in ocr_pages:
                    page_num = item.get("page", 1)
                    item_text = item.get("text", "")
                    if item_text:
                        if page_num not in pages_dict:
                            pages_dict[page_num] = []
                        pages_dict[page_num].append(item_text)
                
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
                        "ocr_status": ocr_status,
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
                    "ocr_status": ocr_status,
                    "pages": {},
                    "total_pages": 0,
                    "total_chars": 0,
                    "error": str(e),
                }
            }


@router.get("/{book_id}/ocr/full")
async def get_book_ocr_full(book_id: str, auth=Depends(require_user)):
    """
    获取书籍完整的 OCR 识别结果（含所有页面坐标信息）
    用于前端一次性下载并缓存到 IndexedDB
    """
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                "SELECT digitalize_report_key, ocr_result_key, is_digitalized FROM books WHERE id = cast(:id as uuid)"
            ),
            {"id": book_id},
        )
        row = res.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="book_not_found")
        
        old_report_key, new_ocr_key, is_digitalized = row
        report_key = new_ocr_key or old_report_key
        
        if not report_key:
            raise HTTPException(status_code=404, detail="ocr_not_available")
        
        try:
            report_data = read_full(BOOKS_BUCKET, report_key)
            if not report_data:
                raise Exception("Report not found")
            
            report = json.loads(report_data)
            
            if "pages" in report and isinstance(report["pages"], list):
                # 新版格式
                ocr_pages = report.get("pages", [])
                page_sizes = {}
                all_regions = []
                total_chars = 0
                
                for page_data in ocr_pages:
                    page_num = page_data.get("page_num", 1)
                    page_sizes[str(page_num)] = {
                        "width": page_data.get("width", 0),
                        "height": page_data.get("height", 0),
                        "pdf_width": page_data.get("pdf_width", 0),
                        "pdf_height": page_data.get("pdf_height", 0),
                        "dpi": page_data.get("dpi", 150),
                    }
                    
                    for region in page_data.get("regions", []):
                        region_with_page = region.copy()
                        region_with_page["page"] = page_num
                        all_regions.append(region_with_page)
                    
                    total_chars += len(page_data.get("text", ""))
                
                response_data = {
                    "is_image_based": True,
                    "confidence": 1.0,
                    "total_pages": report.get("total_pages", len(ocr_pages)),
                    "total_chars": total_chars,
                    "total_regions": len(all_regions),
                    "page_sizes": page_sizes,
                    "regions": all_regions,
                }
            else:
                # 旧版格式
                ocr_result = report.get("ocr", {})
                all_regions = ocr_result.get("regions", [])
                total_chars = sum(len(r.get("text", "")) for r in all_regions)
                page_numbers = set(r.get("page", 1) for r in all_regions)
                total_pages = max(page_numbers) if page_numbers else 0
                
                page_sizes = report.get("page_sizes", {})
                if not page_sizes:
                    page_sizes = {}
                    page_regions_map = {}
                    for r in all_regions:
                        p = r.get("page", 1)
                        if p not in page_regions_map:
                            page_regions_map[p] = []
                        page_regions_map[p].append(r)
                    
                    for page_num, regions in page_regions_map.items():
                        max_x, max_y = 0.0, 0.0
                        for r in regions:
                            bbox = r.get("bbox", [])
                            if len(bbox) >= 4:
                                max_x = max(max_x, bbox[2])
                                max_y = max(max_y, bbox[3])
                        
                        if max_x > 0 and max_y > 0:
                            page_sizes[str(page_num)] = {
                                "width": int(max_x * 1.08),
                                "height": int(max_y * 1.08)
                            }
                
                response_data = {
                    "is_image_based": report.get("is_image_based", False),
                    "confidence": report.get("confidence", 0),
                    "total_pages": total_pages,
                    "total_chars": total_chars,
                    "total_regions": len(all_regions),
                    "page_sizes": page_sizes,
                    "regions": all_regions,
                }
            
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
    """获取 OCR 配额信息"""
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        
        res = await conn.execute(
            text("""
                SELECT id, is_digitalized, initial_digitalization_confidence, ocr_status,
                       COALESCE((meta->>'page_count')::int, 0) as page_count
                FROM books 
                WHERE id = cast(:id as uuid)
            """),
            {"id": book_id},
        )
        row = res.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="book_not_found")
        
        _, is_digitalized, confidence, ocr_status, page_count = row
        
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
        
        is_pro = False
        if tier and tier != "FREE" and membership_expire_at:
            if membership_expire_at > datetime.now(timezone.utc):
                is_pro = True
        
        # 计算阶梯
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
        
        free_remaining = max(0, free_quota - (free_ocr_used or 0))
        pro_remaining = max(0, gift_quota - (free_ocr_used or 0)) if is_pro else 0
        
        can_trigger = True
        reason = None
        
        is_already_digital = is_digitalized and (confidence is not None and confidence >= 0.8)
        
        if is_already_digital:
            can_trigger = False
            reason = "书籍已是文字型，无需 OCR"
        elif ocr_status in ('pending', 'processing'):
            can_trigger = False
            reason = "OCR 任务正在处理中"
        elif ocr_status == 'completed':
            can_trigger = False
            reason = "书籍已完成 OCR"
        elif not page_count or page_count == 0:
            can_trigger = False
            reason = "无法获取书籍页数"
        elif page_count > max_pages:
            can_trigger = False
            reason = f"页数超过上限 (最大 {max_pages} 页)"
        elif not is_pro:
            if tier_level > 1:
                can_trigger = False
                reason = "免费用户仅支持 ≤600 页的书籍"
            elif free_remaining < 1:
                can_trigger = False
                reason = "本月免费配额已用尽"
        else:
            if tier_level == 1 and pro_remaining >= 1:
                pass
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
    """用户主动请求对图片型 PDF 进行 OCR 处理"""
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        
        res = await conn.execute(
            text("""
                SELECT id, is_digitalized, initial_digitalization_confidence, 
                       ocr_status, ocr_requested_at, minio_key, 
                       COALESCE((meta->>'page_count')::int, 0) as page_count,
                       canonical_book_id, ocr_result_key, content_sha256
                FROM books 
                WHERE id = cast(:id as uuid)
            """),
            {"id": book_id},
        )
        row = res.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="book_not_found")
        
        (book_id_db, is_digitalized, confidence, ocr_status, ocr_requested_at, 
         minio_key, page_count, canonical_book_id, current_ocr_result_key, content_sha256) = row
        
        # 检查是否可以复用已有 OCR 数据
        can_instant_complete = False
        reusable_ocr_result_key = None
        
        if content_sha256:
            ocr_res = await conn.execute(
                text("""
                    SELECT ocr_result_key 
                    FROM books 
                    WHERE content_sha256 = :sha 
                      AND ocr_status = 'completed' 
                      AND ocr_result_key IS NOT NULL
                      AND id != cast(:book_id as uuid)
                    ORDER BY deleted_at IS NULL DESC, ocr_requested_at DESC
                    LIMIT 1
                """),
                {"sha": content_sha256, "book_id": book_id},
            )
            ocr_row = ocr_res.fetchone()
            if ocr_row:
                can_instant_complete = True
                reusable_ocr_result_key = ocr_row[0]
                print(f"[OCR] Found reusable OCR for {book_id} via SHA256 {content_sha256[:16]}...")
        
        if is_digitalized and (confidence is not None and confidence >= 0.8):
            raise HTTPException(status_code=400, detail="already_digitalized")
        
        if ocr_status in ('pending', 'processing'):
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
        
        thresholds = settings.get("ocr_page_thresholds", {"standard": 600, "double": 1000, "triple": 2000})
        max_pages = int(settings.get("ocr_max_pages", 2000))
        free_quota = int(settings.get("ocr_monthly_free_quota", 3))
        gift_quota = int(settings.get("monthly_gift_ocr_count", 3))
        minutes_per_book = int(settings.get("ocr_minutes_per_book", 5))
        
        if page_count > max_pages:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "OCR_MAX_PAGES_EXCEEDED",
                    "pages": page_count,
                    "limit": max_pages
                }
            )
        
        # 计算所需单位
        if page_count <= thresholds["standard"]:
            units_needed = 1
        elif page_count <= thresholds["double"]:
            units_needed = 2
        elif page_count <= thresholds["triple"]:
            units_needed = 3
        else:
            units_needed = 3
        
        # 检查用户配额
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
        
        is_pro = False
        if tier and tier != "FREE" and membership_expire_at:
            if membership_expire_at > datetime.now(timezone.utc):
                is_pro = True
        
        # 检查月度赠送是否需要重置
        now_utc = datetime.now(timezone.utc)
        if is_pro and gift_reset_at < now_utc.replace(day=1, hour=0, minute=0, second=0, microsecond=0):
            await conn.execute(
                text("UPDATE users SET free_ocr_usage = 0, monthly_gift_reset_at = now() WHERE id = cast(:uid as uuid)"),
                {"uid": user_id}
            )
            free_ocr_used = 0
        
        can_use_free = units_needed == 1
        
        if is_pro:
            if can_use_free and free_ocr_used < gift_quota:
                quota_type = "monthly_gift"
            else:
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
        
        # 扣除配额
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
        
        # 如果可以秒完成
        if can_instant_complete and reusable_ocr_result_key:
            await conn.execute(
                text("""
                    UPDATE books 
                    SET ocr_status = 'completed', 
                        ocr_requested_at = now(),
                        ocr_result_key = :ocr_key,
                        updated_at = now()
                    WHERE id = cast(:id as uuid)
                """),
                {"id": book_id, "ocr_key": reusable_ocr_result_key}
            )
            
            print(f"[OCR] Instant completed for {book_id} using reusable OCR result")
            fake_processing_seconds = min(60, max(3, (page_count or 10) * 0.5))
            
            return {
                "status": "instant_completed",
                "estimatedSeconds": fake_processing_seconds,
                "pageCount": page_count,
                "message": "OCR data inherited from shared source"
            }
        
        # 正常流程
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
        
        queue_res = await conn.execute(
            text("""
                SELECT COUNT(*) FROM books 
                WHERE ocr_status IN ('pending', 'processing') 
                AND ocr_requested_at < now()
            """)
        )
        queue_position = (queue_res.fetchone()[0] or 0) + 1
        estimated_minutes = max(minutes_per_book, queue_position * minutes_per_book + (page_count or 100) // 50)
        
        try:
            celery_app.send_task(
                "tasks.process_book_ocr",
                args=[book_id, user_id],
                priority=7 if is_pro else 3
            )
        except Exception as e:
            print(f"[OCR] Failed to dispatch Celery task: {e}")
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
    """查询书籍的 OCR 处理状态"""
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
    """获取书籍单页的 OCR 识别结果（含坐标信息）"""
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
            report_data = read_full(BOOKS_BUCKET, report_key)
            if not report_data:
                raise Exception("Report not found")
            
            report = json.loads(report_data)
            ocr_result = report.get("ocr", {})
            all_regions = ocr_result.get("regions", [])
            
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
            
            page_sizes = report.get("page_sizes", {})
            page_size = page_sizes.get(str(page), {})
            
            if page_size:
                image_width = page_size.get("width", 0)
                image_height = page_size.get("height", 0)
            else:
                max_x, max_y = 0.0, 0.0
                for r in page_regions:
                    bbox = r.get("bbox", [])
                    if bbox and len(bbox) >= 4:
                        max_x = max(max_x, bbox[2])
                        max_y = max(max_y, bbox[3])
                
                if max_x > 0 and max_y > 0:
                    image_width = int(max_x * 1.08)
                    image_height = int(max_y * 1.08)
                else:
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
    """在书籍 OCR 内容中搜索"""
    import requests
    
    user_id, _ = auth
    
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
