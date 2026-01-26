
import asyncio
import sys
import os
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)

# Ensure app is in path
sys.path.append('/app')

from app.tasks.index_tasks import _index_all_books_async
from app.db import engine

async def main():
    print("Starting manual indexing...")
    try:
        result = await _index_all_books_async()
        print(f"Indexing complete. Result: {result}")
    except Exception as e:
        print(f"Error during indexing: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
