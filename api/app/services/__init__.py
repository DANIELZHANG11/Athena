"""
服务工厂与统一出口

本模块用于聚合并导出服务工厂方法，方便上层通过单一入口获取能力：
- `get_ocr`：返回 OCR 引擎（生产为 PaddleOCR，测试为 Mock）
- `get_embedder`：返回嵌入向量引擎（生产为本地 BGE-M3，测试为 Mock）
- `get_tts`：返回 TTS 引擎（生产为 Edge TTS，失败回退 Mock）

同时通配导出 `book_service` 内部服务函数，供路由与任务模块调用。
"""
from .book_service import *
from .ocr import get_ocr
from .embedder import get_embedder
from .tts import get_tts
