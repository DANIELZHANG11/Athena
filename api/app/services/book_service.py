"""
书籍服务（内部）

功能：
- 生成上传 URL（预签名 PUT）与对象键
- 创建书籍记录，复用 ETag 去重
"""
import os
import uuid
from sqlalchemy import text

from ..db import engine
from ..storage import make_object_key, presigned_put, presigned_get, stat_etag

BUCKET = os.getenv("MINIO_BUCKET", "athena")


async def get_upload_url(user_id: str, filename: str, content_type: str | None = None) -> dict:
  key = make_object_key(user_id, filename)
  url = presigned_put(BUCKET, key, content_type=content_type)
  return {"key": key, "upload_url": url}


async def create_book(user_id: str, body: dict) -> dict:
  key = body.get("key")
  title = body.get("title") or "Untitled"
  author = body.get("author") or ""
  language = body.get("language") or ""
  original_format = body.get("original_format") or ""
  size = body.get("size") or None
  book_id = str(uuid.uuid4())
  etag = stat_etag(BUCKET, key)

  async with engine.begin() as conn:
    await conn.execute(text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id})
    if etag:
      res = await conn.execute(text("SELECT id::text FROM books WHERE user_id = current_setting('app.user_id')::uuid AND source_etag = :e"), {"e": etag})
      row = res.fetchone()
      if row:
        return {"id": row[0], "download_url": presigned_get(BUCKET, key)}
    await conn.execute(text("""
      INSERT INTO books(id, user_id, title, author, language, original_format, minio_key, size, source_etag)
      VALUES (cast(:id as uuid), cast(:uid as uuid), :title, :author, :language, :fmt, :key, :size, :etag)
    """), {"id": book_id, "uid": user_id, "title": title, "author": author, "language": language, "fmt": original_format, "key": key, "size": size, "etag": etag})

  return {"id": book_id, "download_url": presigned_get(BUCKET, key)}
