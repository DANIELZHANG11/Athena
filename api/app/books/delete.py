"""
删除相关路由

包含：
- /{book_id} [DELETE] - 删除书籍
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from .common import (
    BOOKS_BUCKET, engine, delete_object, delete_book_from_index,
    require_user, require_write_permission,
)

router = APIRouter()


@router.delete("/{book_id}")
async def delete_book(book_id: str, quota=Depends(require_write_permission), auth=Depends(require_user)):
    """
    删除书籍 - 分离公共信息和私人信息
    
    【私人信息】- 用户删除时立即物理删除：
    - 笔记 (notes) 和笔记标签 (note_tags)
    - 高亮 (highlights) 和高亮标签 (highlight_tags)
    - AI 对话 (ai_conversations, ai_messages, ai_conversation_contexts)
    - 阅读进度 (reading_progress)
    - 阅读会话 (reading_sessions)
    - 书架关联 (shelf_items)
    - 转换任务 (conversion_jobs)
    - OCR 任务 (ocr_jobs)
    
    【公共信息】- 只有最后一位用户删除时才物理删除：
    - 书籍文件 (MinIO)
    - 封面图片 (MinIO)
    - OCR 结果 (MinIO)
    - 数字化报告 (MinIO)
    - 向量索引 (OpenSearch)
    - 书籍记录 (books 表)
    """
    user_id, _ = auth
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
            )
            
            # 获取书籍信息
            res = await conn.execute(
                text("""
                    SELECT id, minio_key, cover_image_key, canonical_book_id, storage_ref_count,
                           ocr_result_key, digitalize_report_key, content_sha256
                    FROM books 
                    WHERE id = cast(:id as uuid) AND user_id = cast(:uid as uuid)
                """),
                {"id": book_id, "uid": user_id},
            )
            book = res.fetchone()
            if not book:
                raise HTTPException(status_code=404, detail="not_found")
            
            (_, minio_key, cover_key, canonical_book_id, storage_ref_count,
             ocr_result_key, digitalize_report_key, content_sha256) = book
            
            is_dedup_reference = canonical_book_id is not None
            has_references = (storage_ref_count or 0) > 1
            
            # ========================================
            # 第一步：删除所有【私人信息】
            # ========================================
            
            # 1.1 删除书架关联
            await conn.execute(
                text("DELETE FROM shelf_items WHERE book_id = cast(:id as uuid)"),
                {"id": book_id},
            )
            
            # 1.2 删除笔记标签关联，然后删除笔记
            await conn.execute(
                text("DELETE FROM note_tags WHERE note_id IN (SELECT id FROM notes WHERE book_id = cast(:id as uuid))"),
                {"id": book_id},
            )
            await conn.execute(
                text("DELETE FROM notes WHERE book_id = cast(:id as uuid)"),
                {"id": book_id},
            )
            
            # 1.3 删除高亮标签关联，然后删除高亮
            await conn.execute(
                text("DELETE FROM highlight_tags WHERE highlight_id IN (SELECT id FROM highlights WHERE book_id = cast(:id as uuid))"),
                {"id": book_id},
            )
            await conn.execute(
                text("DELETE FROM highlights WHERE book_id = cast(:id as uuid)"),
                {"id": book_id},
            )
            
            # 1.4 删除 AI 对话上下文和消息
            await conn.execute(
                text("""
                    DELETE FROM ai_conversation_contexts 
                    WHERE book_ids @> to_jsonb(ARRAY[cast(:id as text)])::jsonb
                """),
                {"id": book_id},
            )
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
            
            # 1.5 删除阅读进度和会话
            await conn.execute(
                text("DELETE FROM reading_progress WHERE book_id = cast(:id as uuid)"),
                {"id": book_id},
            )
            await conn.execute(
                text("DELETE FROM reading_sessions WHERE book_id = cast(:id as uuid)"),
                {"id": book_id},
            )
            
            # 1.6 删除转换任务和 OCR 任务
            await conn.execute(
                text("DELETE FROM conversion_jobs WHERE book_id = cast(:id as uuid)"),
                {"id": book_id},
            )
            await conn.execute(
                text("DELETE FROM ocr_jobs WHERE book_id = cast(:id as uuid)"),
                {"id": book_id},
            )
            
            print(f"[Delete Book] Deleted private data for {book_id}")
            
            # ========================================
            # 第二步：处理书籍记录和【公共信息】
            # ========================================
            
            if is_dedup_reference:
                # 情况1：这是一个去重引用
                res = await conn.execute(
                    text("""
                        SELECT storage_ref_count, deleted_at, minio_key, cover_image_key, 
                               ocr_result_key, digitalize_report_key, content_sha256
                        FROM books WHERE id = cast(:cid as uuid)
                    """),
                    {"cid": canonical_book_id},
                )
                canonical_info = res.fetchone()
                
                # 减少引用计数
                await conn.execute(
                    text("""
                        UPDATE books 
                        SET storage_ref_count = GREATEST(COALESCE(storage_ref_count, 1) - 1, 0)
                        WHERE id = cast(:cid as uuid)
                    """),
                    {"cid": canonical_book_id},
                )
                
                # 删除当前书籍记录
                await conn.execute(
                    text("DELETE FROM books WHERE id = cast(:id as uuid)"),
                    {"id": book_id},
                )
                print(f"[Delete Book] Deleted dedup reference {book_id}, decremented ref count of {canonical_book_id}")
                
                # 检查原书是否需要清理
                if canonical_info:
                    c_ref_count, c_deleted_at, c_minio_key, c_cover_key, c_ocr_key, c_report_key, c_sha256 = canonical_info
                    new_ref_count = max((c_ref_count or 1) - 1, 0)
                    
                    if c_deleted_at and new_ref_count <= 1:
                        other_count = 0
                        if c_sha256:
                            res = await conn.execute(
                                text("""
                                    SELECT COUNT(*) FROM books 
                                    WHERE content_sha256 = :sha AND id != cast(:cid as uuid)
                                """),
                                {"sha": c_sha256, "cid": canonical_book_id},
                            )
                            other_count = res.scalar() or 0
                        
                        if other_count == 0:
                            await conn.execute(
                                text("DELETE FROM books WHERE id = cast(:cid as uuid)"),
                                {"cid": canonical_book_id},
                            )
                            
                            files_to_delete = [f for f in [c_minio_key, c_cover_key, c_ocr_key, c_report_key] if f]
                            for file_key in files_to_delete:
                                try:
                                    delete_object(BOOKS_BUCKET, file_key)
                                    print(f"[Delete Book] Cleaned up canonical MinIO file: {file_key}")
                                except Exception as e:
                                    print(f"[Delete Book] Failed to delete canonical file {file_key}: {e}")
                            
                            delete_book_from_index(canonical_book_id)
                            print(f"[Delete Book] Cleaned up soft-deleted canonical {canonical_book_id} (no more references)")
                
            elif has_references:
                # 情况2：这是原书，但有其他用户引用
                await conn.execute(
                    text("""
                        UPDATE books 
                        SET deleted_at = NOW(), updated_at = NOW()
                        WHERE id = cast(:id as uuid)
                    """),
                    {"id": book_id},
                )
                print(f"[Delete Book] Soft deleted {book_id} (has {storage_ref_count} references, public data preserved)")
                
            else:
                # 情况3：没有引用（最后一位用户删除）
                other_books_count = 0
                if content_sha256:
                    res = await conn.execute(
                        text("""
                            SELECT COUNT(*) FROM books 
                            WHERE content_sha256 = :sha AND id != cast(:id as uuid)
                        """),
                        {"sha": content_sha256, "id": book_id},
                    )
                    other_books_count = res.scalar() or 0
                
                await conn.execute(
                    text("DELETE FROM books WHERE id = cast(:id as uuid)"),
                    {"id": book_id},
                )
                
                if other_books_count == 0:
                    files_to_delete = [f for f in [minio_key, cover_key, ocr_result_key, digitalize_report_key] if f]
                    for file_key in files_to_delete:
                        try:
                            delete_object(BOOKS_BUCKET, file_key)
                            print(f"[Delete Book] Deleted MinIO file: {file_key}")
                        except Exception as e:
                            print(f"[Delete Book] Failed to delete MinIO file {file_key}: {e}")
                    
                    delete_book_from_index(book_id)
                    print(f"[Delete Book] Fully deleted {book_id} (last user, all public data removed)")
                else:
                    print(f"[Delete Book] Deleted {book_id} but preserved public data ({other_books_count} other books share same SHA256)")
        
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[Delete Book] Error: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"delete_failed: {str(e)}")
