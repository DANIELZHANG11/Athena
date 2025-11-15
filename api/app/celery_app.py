import os
from celery import Celery

broker = os.getenv('CELERY_BROKER_URL', 'redis://redis:6379/0')
backend = os.getenv('CELERY_BACKEND_URL', 'redis://redis:6379/1')

celery_app = Celery('athena', broker=broker, backend=backend)
celery_app.autodiscover_tasks(['app'])