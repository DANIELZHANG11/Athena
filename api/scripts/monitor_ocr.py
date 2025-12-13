"""
OCRmyPDF 集成监控

监控双层PDF生成任务的效果
"""
import asyncio
from sqlalchemy import text
from app.db import engine


async def check_recent_ocr_jobs():
    """检查最近的OCR任务"""
    async with engine.begin() as conn:
        result = await conn.execute(text("""
            SELECT 
                id,
                book_id,
                status,
                created_at,
                updated_at,
                error_message
            FROM ocr_jobs
            ORDER BY created_at DESC
            LIMIT 10
        """))
        
        rows = result.fetchall()
        
        print("=" * 80)
        print("Recent OCR Jobs")
        print("=" * 80)
        
        for row in rows:
            print(f"\nJob ID: {row[0]}")
            print(f"Book ID: {row[1]}")
            print(f"Status: {row[2]}")
            print(f"Created: {row[3]}")
            print(f"Updated: {row[4]}")
            if row[5]:
                print(f"Error: {row[5]}")
        
        print("\n" + "=" * 80)


async def check_layered_pdfs():
    """检查双层PDF生成情况"""
    async with engine.begin() as conn:
        result = await conn.execute(text("""
            SELECT 
                id,
                title,
                ocr_status,
                minio_key,
                meta
            FROM books
            WHERE ocr_status IN ('completed', 'processing')
            ORDER BY updated_at DESC
            LIMIT 10
        """))
        
        rows = result.fetchall()
        
        print("=" * 80)
        print("Books with OCR Processing")
        print("=" * 80)
        
        for row in rows:
            print(f"\nBook ID: {row[0]}")
            print(f"Title: {row[1]}")
            print(f"OCR Status: {row[2]}")
            print(f"MinIO Key: {row[3]}")
            
            meta = row[4] or {}
            if 'page_count' in meta:
                print(f"Pages: {meta['page_count']}")
        
        print("\n" + "=" * 80)


if __name__ == "__main__":
    print("\n🔍 OCRmyPDF Integration Monitor\n")
    
    try:
        asyncio.run(check_recent_ocr_jobs())
        print("\n")
        asyncio.run(check_layered_pdfs())
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
