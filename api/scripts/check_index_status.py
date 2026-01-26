#!/usr/bin/env python3
"""
检查向量索引状态

运行方式:
docker exec athena-api-1 python /app/scripts/check_index_status.py
docker exec athena-api-1 python /app/scripts/check_index_status.py --optimize
"""
import asyncio
import sys
from opensearchpy import AsyncOpenSearch


async def check_status(optimize=False):
    client = AsyncOpenSearch(hosts=['http://opensearch:9200'])
    try:
        if optimize:
            print("正在优化索引...")
            await client.indices.forcemerge(
                index='athena_book_chunks', 
                max_num_segments=1, 
                wait_for_completion=True
            )
            await client.indices.refresh(index='athena_book_chunks')
            print("优化完成！\n")
        
        count = await client.count(index='athena_book_chunks')
        stats = await client.indices.stats(index='athena_book_chunks')
        size_bytes = stats['indices']['athena_book_chunks']['primaries']['store']['size_in_bytes']
        
        print(f"文档数: {count['count']}")
        print(f"存储大小: {size_bytes / 1024 / 1024:.2f} MB")
        
        # 按书籍统计
        aggs_result = await client.search(
            index='athena_book_chunks',
            body={
                "size": 0,
                "aggs": {
                    "by_book": {
                        "terms": {
                            "field": "metadata.book_id.keyword",
                            "size": 50
                        }
                    }
                }
            }
        )
        
        print("\n每本书的chunk数:")
        buckets = aggs_result['aggregations']['by_book']['buckets']
        total = 0
        for bucket in buckets:
            print(f"  {bucket['key'][:8]}...: {bucket['doc_count']} chunks")
            total += bucket['doc_count']
        print(f"\n总计: {total} chunks, 共 {len(buckets)} 本书")
        
    finally:
        await client.close()


if __name__ == '__main__':
    optimize = '--optimize' in sys.argv
    asyncio.run(check_status(optimize))
