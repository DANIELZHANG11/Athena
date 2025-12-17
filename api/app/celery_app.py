import os

from celery import Celery

broker = os.getenv("CELERY_BROKER_URL", "redis://redis:6379/0")
backend = os.getenv("CELERY_BACKEND_URL", "redis://redis:6379/1")

celery_app = Celery("athena", broker=broker, backend=backend)

# 显式导入任务模块以确保任务被注册
# 任务模块已拆分为子模块:
# - app.tasks.cover_tasks
# - app.tasks.metadata_tasks
# - app.tasks.convert_tasks
# - app.tasks.ocr_tasks
# - app.tasks.analysis_tasks
celery_app.conf.update(
    imports=[
        "app.tasks",  # 主包会导入所有子模块
        "app.tasks.cover_tasks",
        "app.tasks.metadata_tasks",
        "app.tasks.convert_tasks",
        "app.tasks.ocr_tasks",
        "app.tasks.analysis_tasks",
        "app.search_sync",
    ],
)
