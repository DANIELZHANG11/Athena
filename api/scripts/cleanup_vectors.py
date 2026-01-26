#!/usr/bin/env python3
"""
清理向量索引中的重复数据

运行方式:
docker exec athena-api-1 python /app/scripts/cleanup_vectors.py
"""
import asyncio
from opensearchpy import AsyncOpenSearch


async def cleanup_all_vectors():
    """清理所有向量索引数据，准备重建"""
    client = AsyncOpenSearch(hosts=['http://opensearch:9200'])
    
    try:
        index = 'athena_book_chunks'
        
        # 获取当前状态
        before_count = await client.count(index=index)
        print(f"清理前: {before_count['count']} 条文档")
        
        # 删除所有文档但保留索引结构
        response = await client.delete_by_query(
            index=index,
            body={'query': {'match_all': {}}},
            wait_for_completion=True
        )
        deleted = response.get('deleted', 0)
        print(f"已删除: {deleted} 条文档")
        
        # 确认清理结果
        after_count = await client.count(index=index)
        print(f"清理后: {after_count['count']} 条文档")
        
    except Exception as e:
        print(f"清理失败: {e}")
    finally:
        await client.close()


if __name__ == '__main__':
    asyncio.run(cleanup_all_vectors())
