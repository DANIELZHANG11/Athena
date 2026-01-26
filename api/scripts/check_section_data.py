#!/usr/bin/env python3
"""检查最新的索引数据"""
import asyncio
from opensearchpy import AsyncOpenSearch

async def check_new_data():
    client = AsyncOpenSearch(hosts=['http://opensearch:9200'])
    try:
        await client.indices.refresh(index='athena_book_chunks')
        
        result = await client.search(
            index='athena_book_chunks',
            body={
                'size': 5,
                'query': {
                    'term': {'metadata.book_id.keyword': '11c41379-4ff9-41e8-989e-3aa9361c6bfa'}
                },
                'sort': [{'metadata.chunk_index': 'asc'}],
                '_source': ['metadata.section_index', 'metadata.section_filename', 'metadata.chunk_index', 'text']
            }
        )
        
        print(f"找到 {result['hits']['total']['value']} 条文档\n")
        for i, hit in enumerate(result['hits']['hits'], 1):
            meta = hit['_source'].get('metadata', {})
            text = hit['_source'].get('text', '')[:60]
            chunk_idx = meta.get('chunk_index')
            section_idx = meta.get('section_index')
            filename = meta.get('section_filename', '')
            print(f"[chunk {chunk_idx}] section_index={section_idx}, filename='{filename}'")
            print(f"    text: {text}...\n")
    finally:
        await client.close()

if __name__ == '__main__':
    asyncio.run(check_new_data())
