
import sys
sys.path.append('/app')
import traceback

print("Testing imports...")
try:
    import app.storage
    print("Successfully imported app.storage")
except Exception:
    traceback.print_exc()

try:
    from app.tasks.index_tasks import _index_all_books_async
    print("Successfully imported index_tasks")
except Exception:
    traceback.print_exc()
