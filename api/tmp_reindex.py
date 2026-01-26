"""临时脚本：触发所有书籍重新索引"""
import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

async def get_books():
    engine = create_async_engine('postgresql+asyncpg://athena:athena_dev@postgres:5432/athena')
    async with engine.connect() as conn:
        result = await conn.execute(text(
            "SELECT id, title FROM books WHERE upload_status = 'completed' OR upload_status = 'text_extracted'"
        ))
        books = result.fetchall()
    await engine.dispose()
    return books

async def main():
    books = await get_books()
    print(f'找到 {len(books)} 本书需要索引')
    
    from app.tasks.index_tasks import create_book_vector_index
    
    for book in books:
        print(f'排队: {book.title}')
        create_book_vector_index.delay(str(book.id))
    
    print(f'已排队 {len(books)} 个索引任务')

if __name__ == "__main__":
    asyncio.run(main())
