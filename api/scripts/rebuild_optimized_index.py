"""
向量索引优化重建脚本

执行以下操作：
1. 删除现有的 athena_book_chunks 索引
2. 使用优化后的 mapping 重新创建索引
3. 触发所有已上传书籍的重新索引任务

优化内容：
- EPUB章节提取：基于 toc.ncx/nav.xhtml 标准解析（非正则猜测）
- 向量存储：移除 LlamaIndex 冗余字段（_node_content, original_text 等）
- 向量精度：float16 量化（节省 30% 存储空间）

使用方法：
docker exec athena-api-1 python scripts/rebuild_optimized_index.py
"""

import asyncio
import os
import sys

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from opensearchpy import AsyncOpenSearch
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.services.llama_rag import (
    OPENSEARCH_URL,
    BOOK_CHUNKS_INDEX,
    recreate_book_chunks_index,
)

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql+asyncpg://athena:athena_dev@postgres:5432/athena"
)


async def get_index_stats():
    """获取当前索引统计"""
    client = AsyncOpenSearch(hosts=[OPENSEARCH_URL])
    try:
        exists = await client.indices.exists(index=BOOK_CHUNKS_INDEX)
        if not exists:
            return {"exists": False, "count": 0, "size_mb": 0}
        
        stats = await client.indices.stats(index=BOOK_CHUNKS_INDEX)
        index_stats = stats['indices'][BOOK_CHUNKS_INDEX]['primaries']
        
        return {
            "exists": True,
            "count": index_stats['docs']['count'],
            "size_mb": round(index_stats['store']['size_in_bytes'] / 1024 / 1024, 2),
        }
    finally:
        await client.close()


async def get_all_books():
    """获取数据库中所有需要索引的书籍"""
    engine = create_async_engine(DATABASE_URL)
    
    async with engine.connect() as conn:
        # 获取所有上传完成的书籍
        result = await conn.execute(text("""
            SELECT id, title, file_path, file_type, upload_status 
            FROM books 
            WHERE upload_status IN ('completed', 'text_extracted')
            ORDER BY created_at DESC
        """))
        books = result.fetchall()
    
    await engine.dispose()
    return books


async def queue_index_tasks(books):
    """为所有书籍排队索引任务"""
    from app.tasks.index_tasks import create_book_vector_index
    
    queued = 0
    for book in books:
        book_id = str(book.id)
        title = book.title
        
        print(f"  排队: {title} ({book_id})")
        create_book_vector_index.delay(book_id)
        queued += 1
    
    return queued


async def main():
    print("=" * 60)
    print("向量索引优化重建脚本")
    print("=" * 60)
    print()
    
    # 1. 显示当前状态
    print("📊 当前索引状态:")
    stats = await get_index_stats()
    if stats["exists"]:
        print(f"   - 文档数: {stats['count']}")
        print(f"   - 大小: {stats['size_mb']} MB")
    else:
        print("   - 索引不存在")
    print()
    
    # 2. 获取所有书籍
    print("📚 获取数据库中的书籍...")
    books = await get_all_books()
    print(f"   找到 {len(books)} 本书籍需要索引")
    print()
    
    # 3. 确认操作
    print("⚠️  警告: 这将删除所有现有向量索引并重建！")
    confirm = input("确认继续? (输入 'yes' 确认): ")
    if confirm.lower() != 'yes':
        print("已取消")
        return
    
    print()
    
    # 4. 重建索引
    print("🔄 删除并重建索引...")
    result = await recreate_book_chunks_index()
    print(f"   结果: {result}")
    print()
    
    # 5. 排队索引任务
    print("📤 排队书籍索引任务...")
    queued = await queue_index_tasks(books)
    print(f"   已排队 {queued} 个任务")
    print()
    
    print("✅ 完成！请查看 Celery worker 日志查看索引进度")
    print("   监控命令: docker logs -f athena-worker-gpu-1")


if __name__ == "__main__":
    asyncio.run(main())
