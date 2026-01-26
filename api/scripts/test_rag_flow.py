#!/usr/bin/env python3
"""
模拟完整的RAG流程（包含结构化章节查询）：
1. 用户提问 → 2. 检测章节查询 → 3. 章节搜索/向量搜索 → 4. 返回结果
"""
import asyncio
import os
import sys

# 添加app路径
sys.path.insert(0, '/app')

async def test_rag_flow():
    from app.services.llama_rag import search_book_chunks, extract_chapter_number
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine
    
    # 模拟用户提问
    query = "这本书的第三章的章节标题是什么？主要讲了什么内容？"
    book_id = '11c41379-4ff9-41e8-989e-3aa9361c6bfa'  # 我知道光在哪里
    
    print("=" * 60)
    print(f"用户提问: {query}")
    print(f"书籍ID: {book_id}")
    print("=" * 60)
    
    # 检测章节号
    chapter_num = extract_chapter_number(query)
    print(f"\n检测到的章节号: {chapter_num}")
    
    # 获取书籍的 content_sha256
    DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql+asyncpg://postgres:postgres@postgres:5432/athena')
    engine = create_async_engine(DATABASE_URL)
    
    async with engine.begin() as conn:
        result = await conn.execute(text(
            "SELECT content_sha256, title FROM books WHERE id = cast(:id as uuid)"
        ), {"id": book_id})
        row = result.fetchone()
        if not row:
            print("书籍不存在！")
            return
        content_sha256 = row[0]
        book_title = row[1]
        print(f"书籍标题: {book_title}")
        print(f"content_sha256: {content_sha256[:20]}...")
    
    await engine.dispose()
    
    # 执行搜索
    print(f"\n正在执行搜索...")
    results = await search_book_chunks(
        query=query,
        content_sha256_list=[content_sha256],
        top_k=10
    )
    
    print(f"\n{'='*60}")
    print(f"搜索结果: 找到 {len(results)} 个相关片段")
    print("=" * 60)
    
    for i, chunk in enumerate(results[:5], 1):
        score = chunk.get('score') or 0
        print(f"\n--- 结果 {i} (得分: {score:.4f}) ---")
        print(f"chapter: {chunk.get('chapter')}")
        print(f"section_index: {chunk.get('section_index')}")
        print(f"section_filename: {chunk.get('section_filename')}")
        print(f"文本预览: {chunk.get('content', '')[:200]}...")


if __name__ == '__main__':
    asyncio.run(test_rag_flow())
