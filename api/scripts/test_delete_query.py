#!/usr/bin/env python3
"""测试删除查询条件"""
import asyncio
from opensearchpy import AsyncOpenSearch

async def test_delete():
    client = AsyncOpenSearch(hosts=['http://opensearch:9200'])
    book_id = '11c41379-4ff9-41e8-989e-3aa9361c6bfa'
    
    try:
        # 测试用 term 能不能找到
        count1 = await client.count(
            index='athena_book_chunks',
            body={'query': {'term': {'metadata.book_id': book_id}}}
        )
        print(f"term metadata.book_id: {count1['count']} docs")
        
        # 测试用 keyword
        count2 = await client.count(
            index='athena_book_chunks',
            body={'query': {'term': {'metadata.book_id.keyword': book_id}}}
        )
        print(f"term metadata.book_id.keyword: {count2['count']} docs")
        
        # 测试用 match
        count3 = await client.count(
            index='athena_book_chunks',
            body={'query': {'match': {'metadata.book_id': book_id}}}
        )
        print(f"match metadata.book_id: {count3['count']} docs")
    finally:
        await client.close()

if __name__ == '__main__':
    asyncio.run(test_delete())
