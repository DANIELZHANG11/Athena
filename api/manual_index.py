
import asyncio
import sys
import os
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)

# Ensure app is in path
sys.path.append('/app')

from app.tasks.index_tasks import _index_book_async
from app.db import engine

async def main():
    if len(sys.argv) < 2:
        print("Usage: python manual_index.py <book_id>")
        sys.exit(1)
    
    book_id = sys.argv[1]
    print(f"Starting manual indexing for book {book_id}...")
    try:
        result = await _index_book_async(book_id)
        print(f"Indexing complete. Result: {result}")
    except Exception as e:
        print(f"Error during indexing: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
