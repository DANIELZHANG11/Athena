import os

from celery import Celery

broker = os.getenv("CELERY_BROKER_URL", "redis://redis:6379/0")
backend = os.getenv("CELERY_BACKEND_URL", "redis://redis:6379/1")

celery_app = Celery("athena", broker=broker, backend=backend)

# 显式导入任务模块以确保任务被注册
celery_app.conf.update(
    imports=["app.tasks"],
)
