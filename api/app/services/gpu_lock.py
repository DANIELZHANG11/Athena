"""
GPU 任务锁服务

使用 Redis 分布式锁确保 GPU 密集型任务（OCR、向量索引）串行执行，
避免多任务同时占用 GPU 导致显存溢出。

使用方式:
    from app.services.gpu_lock import gpu_lock, acquire_gpu_lock

    # 方式1：上下文管理器
    with gpu_lock():
        # GPU 密集型操作
        process_ocr()

    # 方式2：装饰器（用于 Celery 任务）
    @acquire_gpu_lock
    def my_gpu_task():
        ...
"""
import os
import time
import logging
from contextlib import contextmanager
from functools import wraps
from typing import Optional

logger = logging.getLogger(__name__)

# Redis 配置
REDIS_URL = os.getenv("REDIS_URL", "redis://valkey:6379")
GPU_LOCK_KEY = "athena:gpu_task_lock"
GPU_LOCK_TIMEOUT = int(os.getenv("GPU_LOCK_TIMEOUT", "7200"))  # 默认 2 小时
GPU_LOCK_RETRY_INTERVAL = float(os.getenv("GPU_LOCK_RETRY_INTERVAL", "5.0"))  # 重试间隔

_redis_client = None


def _get_redis():
    """获取 Redis 客户端（延迟初始化）"""
    global _redis_client
    if _redis_client is None:
        import redis
        _redis_client = redis.from_url(REDIS_URL, decode_responses=True)
    return _redis_client


class GPULockAcquisitionError(Exception):
    """无法获取 GPU 锁"""
    pass


class GPULock:
    """
    Redis 分布式 GPU 锁
    
    确保同一时刻只有一个 GPU 密集型任务运行，
    适用于 RTX 3060/3070 等消费级显卡（显存 8-12GB）。
    """
    
    def __init__(
        self,
        lock_key: str = GPU_LOCK_KEY,
        timeout: int = GPU_LOCK_TIMEOUT,
        blocking: bool = True,
        blocking_timeout: Optional[float] = None,
    ):
        self.lock_key = lock_key
        self.timeout = timeout
        self.blocking = blocking
        self.blocking_timeout = blocking_timeout  # None 表示无限等待
        self._lock = None
        self._lock_id = None
    
    def acquire(self) -> bool:
        """
        获取 GPU 锁
        
        Returns:
            True 如果成功获取，False 如果非阻塞模式下获取失败
        
        Raises:
            GPULockAcquisitionError: 阻塞模式下超时
        """
        import uuid
        redis_client = _get_redis()
        self._lock_id = str(uuid.uuid4())
        
        start_time = time.time()
        
        while True:
            # 尝试设置锁（NX = 不存在时才设置，EX = 过期时间）
            acquired = redis_client.set(
                self.lock_key,
                self._lock_id,
                nx=True,
                ex=self.timeout,
            )
            
            if acquired:
                logger.info(f"[GPULock] Acquired lock: {self._lock_id}")
                return True
            
            if not self.blocking:
                logger.warning(f"[GPULock] Failed to acquire lock (non-blocking)")
                return False
            
            # 检查超时
            if self.blocking_timeout is not None:
                elapsed = time.time() - start_time
                if elapsed >= self.blocking_timeout:
                    raise GPULockAcquisitionError(
                        f"Failed to acquire GPU lock after {elapsed:.1f}s"
                    )
            
            # 等待后重试
            current_holder = redis_client.get(self.lock_key)
            logger.debug(f"[GPULock] Lock held by {current_holder}, waiting {GPU_LOCK_RETRY_INTERVAL}s...")
            time.sleep(GPU_LOCK_RETRY_INTERVAL)
    
    def release(self) -> bool:
        """
        释放 GPU 锁
        
        使用 Lua 脚本确保只有锁的持有者才能释放锁（防止误删）
        
        Returns:
            True 如果成功释放，False 如果锁已不属于当前持有者
        """
        if self._lock_id is None:
            return False
        
        redis_client = _get_redis()
        
        # Lua 脚本：只有锁 ID 匹配时才删除
        lua_script = """
        if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
        else
            return 0
        end
        """
        
        result = redis_client.eval(lua_script, 1, self.lock_key, self._lock_id)
        
        if result:
            logger.info(f"[GPULock] Released lock: {self._lock_id}")
        else:
            logger.warning(f"[GPULock] Lock {self._lock_id} was not held or already released")
        
        self._lock_id = None
        return bool(result)
    
    def extend(self, additional_time: int = None) -> bool:
        """
        延长锁的过期时间
        
        Args:
            additional_time: 额外时间（秒），默认使用初始 timeout
        
        Returns:
            True 如果成功延长
        """
        if self._lock_id is None:
            return False
        
        if additional_time is None:
            additional_time = self.timeout
        
        redis_client = _get_redis()
        
        # Lua 脚本：只有锁 ID 匹配时才延长
        lua_script = """
        if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("expire", KEYS[1], ARGV[2])
        else
            return 0
        end
        """
        
        result = redis_client.eval(lua_script, 1, self.lock_key, self._lock_id, additional_time)
        
        if result:
            logger.debug(f"[GPULock] Extended lock by {additional_time}s")
        
        return bool(result)
    
    def __enter__(self):
        self.acquire()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.release()
        return False


@contextmanager
def gpu_lock(
    timeout: int = GPU_LOCK_TIMEOUT,
    blocking: bool = True,
    blocking_timeout: Optional[float] = None,
):
    """
    GPU 锁上下文管理器
    
    用法:
        with gpu_lock():
            # GPU 密集型操作
            process_ocr()
    """
    lock = GPULock(
        timeout=timeout,
        blocking=blocking,
        blocking_timeout=blocking_timeout,
    )
    lock.acquire()
    try:
        yield lock
    finally:
        lock.release()


def acquire_gpu_lock(func):
    """
    GPU 锁装饰器
    
    用法:
        @acquire_gpu_lock
        def my_gpu_task():
            ...
    """
    @wraps(func)
    def wrapper(*args, **kwargs):
        with gpu_lock():
            return func(*args, **kwargs)
    return wrapper


def get_gpu_lock_status() -> dict:
    """
    获取 GPU 锁状态
    
    Returns:
        包含 locked, holder, ttl 的字典
    """
    try:
        redis_client = _get_redis()
        holder = redis_client.get(GPU_LOCK_KEY)
        ttl = redis_client.ttl(GPU_LOCK_KEY) if holder else -1
        
        return {
            "locked": holder is not None,
            "holder": holder,
            "ttl_seconds": ttl if ttl > 0 else None,
        }
    except Exception as e:
        logger.error(f"[GPULock] Failed to get lock status: {e}")
        return {"locked": False, "error": str(e)}


def force_release_gpu_lock() -> bool:
    """
    强制释放 GPU 锁（管理员操作）
    
    警告：这可能导致正在运行的 GPU 任务出现问题
    
    Returns:
        True 如果成功释放
    """
    try:
        redis_client = _get_redis()
        result = redis_client.delete(GPU_LOCK_KEY)
        logger.warning(f"[GPULock] Force released GPU lock")
        return bool(result)
    except Exception as e:
        logger.error(f"[GPULock] Failed to force release: {e}")
        return False
