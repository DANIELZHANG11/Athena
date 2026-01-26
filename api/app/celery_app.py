"""
Celery 应用配置

队列优先级策略（适用于 RTX 3060/3070 等消费级显卡）:
- gpu_high: GPU 高优先级任务（OCR，付费服务）
- gpu_low: GPU 低优先级任务（向量索引，免费服务）
- cpu_default: CPU 任务（元数据提取、封面提取等）

Worker 部署建议:
- worker-gpu: 并发=1，监听 gpu_high,gpu_low 队列（串行执行避免显存竞争）
- worker-cpu: 并发=4，监听 cpu_default 队列

【2026-01-09】模型预加载：
- Worker 启动时加载 BGE-M3 和 PaddleOCR 模型
- 模型常驻内存，不需要每个任务重新加载
- 禁用在线更新，直接使用本地模型
"""
import os

# 【2026-01-09】离线模式 - 暂时禁用，模型首次下载后再启用
# os.environ.setdefault('HF_HUB_OFFLINE', '1')
# os.environ.setdefault('TRANSFORMERS_OFFLINE', '1')
# os.environ.setdefault('HF_DATASETS_OFFLINE', '1')

from celery import Celery
from celery.signals import worker_process_init
from kombu import Queue, Exchange

broker = os.getenv("CELERY_BROKER_URL", "redis://redis:6379/0")
backend = os.getenv("CELERY_BACKEND_URL", "redis://redis:6379/1")

celery_app = Celery("athena", broker=broker, backend=backend)

# ============================================================================
# 队列定义
# ============================================================================

# 定义交换机和队列
default_exchange = Exchange('default', type='direct')
gpu_exchange = Exchange('gpu', type='direct')

CELERY_QUEUES = (
    # CPU 默认队列
    Queue('cpu_default', default_exchange, routing_key='cpu.default'),
    # GPU 高优先级队列（OCR，付费服务）
    Queue('gpu_high', gpu_exchange, routing_key='gpu.high'),
    # GPU 低优先级队列（向量索引，免费服务）
    Queue('gpu_low', gpu_exchange, routing_key='gpu.low'),
)

# ============================================================================
# 任务路由规则
# ============================================================================

CELERY_TASK_ROUTES = {
    # GPU 高优先级任务（OCR）
    'tasks.process_book_ocr': {'queue': 'gpu_high', 'routing_key': 'gpu.high'},
    'tasks.analyze_book_type': {'queue': 'gpu_high', 'routing_key': 'gpu.high'},
    
    # GPU 低优先级任务（向量索引、Embedding）
    'tasks.index_book_vectors': {'queue': 'gpu_low', 'routing_key': 'gpu.low'},
    'tasks.delete_book_vectors': {'queue': 'gpu_low', 'routing_key': 'gpu.low'},
    # 【2026-01-14】新增：Embedding任务（用户提问、笔记向量化）
    'tasks.get_text_embedding': {'queue': 'gpu_low', 'routing_key': 'gpu.low'},
    'tasks.get_batch_embeddings': {'queue': 'gpu_low', 'routing_key': 'gpu.low'},
    'tasks.index_user_note_vectors': {'queue': 'gpu_low', 'routing_key': 'gpu.low'},
    # 【2026-01-15 修复】笔记/高亮向量索引任务路由到 GPU 队列
    'search.index_note_vector': {'queue': 'gpu_low', 'routing_key': 'gpu.low'},
    'search.delete_note_vector': {'queue': 'gpu_low', 'routing_key': 'gpu.low'},
    'search.index_highlight_vector': {'queue': 'gpu_low', 'routing_key': 'gpu.low'},
    'search.delete_highlight_vector': {'queue': 'gpu_low', 'routing_key': 'gpu.low'},
    
    # CPU 任务（默认）
    'tasks.extract_ebook_metadata_calibre': {'queue': 'cpu_default', 'routing_key': 'cpu.default'},
    'tasks.extract_book_cover': {'queue': 'cpu_default', 'routing_key': 'cpu.default'},
    'tasks.extract_book_cover_and_metadata': {'queue': 'cpu_default', 'routing_key': 'cpu.default'},
    'tasks.convert_to_epub': {'queue': 'cpu_default', 'routing_key': 'cpu.default'},
    'tasks.deep_analyze_book': {'queue': 'cpu_default', 'routing_key': 'cpu.default'},
    'tasks.generate_srs_card': {'queue': 'cpu_default', 'routing_key': 'cpu.default'},
    'tasks.sync_book_to_opensearch': {'queue': 'cpu_default', 'routing_key': 'cpu.default'},
}

# ============================================================================
# Celery 配置
# ============================================================================

celery_app.conf.update(
    # 队列配置
    task_queues=CELERY_QUEUES,
    task_routes=CELERY_TASK_ROUTES,
    task_default_queue='cpu_default',
    task_default_exchange='default',
    task_default_routing_key='cpu.default',
    
    # 任务发现
    imports=[
        "app.tasks",  # 主包会导入所有子模块
        "app.tasks.cover_tasks",
        "app.tasks.metadata_tasks",
        "app.tasks.convert_tasks",
        "app.tasks.ocr_tasks",
        "app.tasks.analysis_tasks",
        "app.tasks.index_tasks",  # 向量索引任务
        "app.tasks.embedding_tasks",  # 【2026-01-14】Embedding向量化任务
        "app.search_sync",
    ],
    
    # 任务序列化
    task_serializer='json',
    result_serializer='json',
    accept_content=['json'],
    
    # 任务执行配置
    task_acks_late=True,  # 任务完成后才确认（支持重试）
    worker_prefetch_multiplier=1,  # GPU 任务不预取（避免排队）
    
    # 结果过期时间
    result_expires=3600,  # 1 小时
)

# ============================================================================
# 【2026-01-09】模型预加载（已禁用）
# ============================================================================
# 
# 【重要】预加载功能已禁用，原因：
# 1. BGE-M3 模型加载需要大量内存（~2GB），在 Celery Worker 启动时加载
#    会导致进程被 OOM Killer 杀死 (SIGKILL signal 9)
# 2. 模型加载时间较长，超过 Celery 默认的 Worker 启动超时
# 3. 导致 Worker 进程不断重启死循环
#
# 解决方案：改为懒加载策略
# - BGE-M3: 在 llama_rag.py 中使用单例模式，第一次调用 get_embed_model() 时加载
# - PaddleOCR: 在 ocr.py 中使用单例模式，第一次调用 get_ocr() 时加载
#
# 这样做的好处：
# - Worker 可以正常启动
# - 模型只在实际需要时加载
# - 加载后常驻内存，后续任务直接使用
# ============================================================================

# @worker_process_init.connect  # 已禁用
def preload_models(**kwargs):
    """
    【已禁用】Worker 进程启动时预加载模型
    
    此函数已禁用，改为懒加载策略。详见上方注释。
    """
    pass  # 不再执行预加载
