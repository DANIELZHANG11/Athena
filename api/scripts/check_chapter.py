#!/usr/bin/env python3
"""查看特定章节的内容"""
import asyncio
import sys
from opensearchpy import AsyncOpenSearch

async def check_chapter(section_idx: int):
    client = AsyncOpenSearch(hosts=['http://opensearch:9200'])
    try:
        result = await client.search(
            index='athena_book_chunks',
            body={
                'size': 3,
                'query': {
                    'bool': {
                        'must': [
                            {'term': {'metadata.book_id.keyword': '11c41379-4ff9-41e8-989e-3aa9361c6bfa'}},
                            {'term': {'metadata.section_index': section_idx}}
                        ]
                    }
                },
                'sort': [{'metadata.chunk_index': 'asc'}],
                '_source': ['metadata.section_index', 'metadata.section_filename', 'text']
            }
        )
        
        print(f"=== section_index={section_idx} 的内容 ===")
        print(f"找到 {result['hits']['total']['value']} 条文档\n")
        
        for hit in result['hits']['hits']:
            meta = hit['_source'].get('metadata', {})
            text = hit['_source'].get('text', '')[:400]
            print(f"section_filename: {meta.get('section_filename')}")
            print(f"text: {text}...")
            print("-" * 40)
    finally:
        await client.close()

if __name__ == '__main__':
    idx = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    asyncio.run(check_chapter(idx))
