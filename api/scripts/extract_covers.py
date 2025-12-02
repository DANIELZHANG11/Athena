"""
手动触发书籍封面提取任务
用法: 
  python -m scripts.extract_covers [user_email]              # 只提取无封面的书籍
  python -m scripts.extract_covers [user_email] --force      # 强制重新提取所有书籍封面
"""

import asyncio
import os
import sys

# 添加 api 目录到 path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from app.db import engine
from app.celery_app import celery_app


async def extract_covers_for_user(user_email: str, force: bool = False):
    """为指定用户的所有书籍提取封面"""
    mode = "ALL books (force mode)" if force else "books without covers"
    print(f"[ExtractCovers] Processing {mode} for user: {user_email}")
    
    async with engine.begin() as conn:
        # 获取用户 ID
        res = await conn.execute(
            text("SELECT id FROM users WHERE email = :email"),
            {"email": user_email}
        )
        user_row = res.fetchone()
        if not user_row:
            print(f"[ExtractCovers] User not found: {user_email}")
            return
        
        user_id = str(user_row[0])
        print(f"[ExtractCovers] User ID: {user_id}")
        
        # 获取书籍
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        
        # 根据是否强制模式选择查询
        if force:
            query = """
                SELECT id, title, original_format, cover_image_key
                FROM books 
                WHERE user_id = cast(:uid as uuid)
                ORDER BY created_at DESC
            """
        else:
            query = """
                SELECT id, title, original_format, cover_image_key
                FROM books 
                WHERE user_id = cast(:uid as uuid) 
                AND (cover_image_key IS NULL OR cover_image_key = '')
                ORDER BY created_at DESC
            """
        
        res = await conn.execute(text(query), {"uid": user_id})
        books = res.fetchall()
        
        if not books:
            print("[ExtractCovers] No books found to process")
            return
        
        print(f"[ExtractCovers] Found {len(books)} books to process")
        
        for book in books:
            book_id, title, original_format, cover_key = str(book[0]), book[1], book[2], book[3]
            status = f"(current: {cover_key})" if cover_key else "(no cover)"
            print(f"[ExtractCovers] Triggering cover extraction for: {title} ({original_format}) {status}")
            
            try:
                celery_app.send_task("tasks.extract_book_cover", args=[book_id, user_id])
                print(f"[ExtractCovers] Task queued for: {book_id}")
            except Exception as e:
                print(f"[ExtractCovers] Failed to queue task: {e}")
        
        print("[ExtractCovers] All tasks queued!")


def main():
    force = "--force" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    user_email = args[0] if args else "126690699@qq.com"
    asyncio.run(extract_covers_for_user(user_email, force))


if __name__ == "__main__":
    main()
