#!/usr/bin/env python3
"""
推送OCR结果到前端用户
"""
import sys
import os
import asyncio
from datetime import datetime, timezone

sys.path.insert(0, '/app')

from app.storage import upload_bytes, get_s3, ensure_bucket
from app.db import SessionLocal
from sqlalchemy import text

BOOK_ID = "663a19bc-ee63-4261-9a50-d52f860bd0e4"
USER_ID = "f4cf77dc-7a50-41f5-9089-9570aecc5d8b"
USER_EMAIL = "126690699@qq.com"
OCR_RESULT_PATH = "/tmp/ocr_test_result.pdf"
BUCKET = os.getenv("MINIO_BUCKET", "athena")

async def main():
    print(f"📚 准备推送OCR结果到前端...")
    print(f"   书籍ID: {BOOK_ID}")
    print(f"   用户: {USER_EMAIL}")
    
    # 1. 读取OCR结果PDF
    print(f"\n📖 读取OCR结果文件...")
    if not os.path.exists(OCR_RESULT_PATH):
        print(f"✗ 文件不存在: {OCR_RESULT_PATH}")
        return
    
    with open(OCR_RESULT_PATH, 'rb') as f:
        ocr_pdf_data = f.read()
    
    print(f"✓ 文件大小: {len(ocr_pdf_data):,} bytes ({len(ocr_pdf_data)/(1024*1024):.2f} MB)")
    
    # 2. 上传到MinIO
    layered_key = f"users/{USER_ID}/layered/{BOOK_ID}.pdf"
    print(f"\n☁️ 上传到MinIO...")
    print(f"   Bucket: {BUCKET}")
    print(f"   Key: {layered_key}")
    
    try:
        upload_bytes(BUCKET, layered_key, ocr_pdf_data, content_type="application/pdf")
        print(f"✓ 上传成功")
    except Exception as e:
        print(f"✗ 上传失败: {e}")
        return
    
    # 3. 更新数据库
    print(f"\n💾 更新数据库...")
    async with SessionLocal() as db:
        try:
            # 更新书籍的OCR状态
            result = await db.execute(
                text("""
                    UPDATE books 
                    SET ocr_status = 'completed',
                        minio_key = :layered_key,
                        updated_at = :now,
                        version = version + 1
                    WHERE id = :book_id
                    RETURNING version
                """),
                {
                    "book_id": BOOK_ID,
                    "layered_key": layered_key,
                    "now": datetime.now(timezone.utc)
                }
            )
            row = result.fetchone()
            if row:
                new_version = row[0]
                print(f"✓ 书籍记录已更新 (版本: {new_version})")
            else:
                print(f"✗ 未找到书籍记录")
                return
            
            # 创建同步事件通知前端
            import json
            payload_json = json.dumps({"ocr_completed": True, "version": new_version})
            event_result = await db.execute(
                text("""
                    INSERT INTO sync_events (id, user_id, book_id, event_type, payload, created_at)
                    VALUES (gen_random_uuid(), :user_id, :book_id, :event_type, :payload, :now)
                    RETURNING id
                """),
                {
                    "user_id": USER_ID,
                    "book_id": BOOK_ID,
                    "event_type": "book_updated",
                    "payload": payload_json,
                    "now": datetime.now(timezone.utc)
                }
            )
            event_row = event_result.fetchone()
            if event_row:
                event_id = event_row[0]
                print(f"✓ 同步事件已创建: {event_id}")
            
            await db.commit()
            print(f"✓ 数据库事务已提交")
            
        except Exception as e:
            print(f"✗ 数据库操作失败: {e}")
            await db.rollback()
            return
    
    print(f"\n================================================================================")
    print(f"✅ OCR结果已成功推送!")
    print(f"================================================================================")
    print(f"📱 前端将在下次同步时收到更新通知")
    print(f"📄 双层PDF位置: s3://{BUCKET}/{layered_key}")
    print(f"👤 用户: {USER_EMAIL}")

if __name__ == "__main__":
    asyncio.run(main())
