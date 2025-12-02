import io
import os
from typing import Any
from ..storage import presigned_get


class MockOCR:
    """Mock OCR for CI/testing environments"""
    def recognize(self, bucket: str, key: str) -> dict:
        return {"pages": [], "text": ""}


class PaddleOCREngine:
    """
    PP-OCRv5 Mobile Engine
    - 支持：简体中文、繁体中文、英文、日文、手写体
    - GPU 内存：~3.5GB/实例
    - 推荐并发：2 Workers (8GB GPU) / 3 Workers (12GB GPU)
    """
    
    def __init__(self, lang: str | None = None):
        from paddleocr import PaddleOCR

        # GPU 内存限制（每个 Worker 3.5GB，开发环境 8GB 可跑 2 个）
        gpu_mem = int(os.getenv("OCR_GPU_MEM", "3500"))
        cpu_threads = int(os.getenv("OCR_CPU_THREADS", "6"))
        use_gpu = os.getenv("OCR_USE_GPU", "true").lower() == "true"
        
        self.ocr = PaddleOCR(
            use_angle_cls=True,
            lang=lang or os.getenv("OCR_LANG", "ch"),
            use_gpu=use_gpu,
            gpu_mem=gpu_mem,
            cpu_threads=cpu_threads,
            enable_mkldnn=True,  # Intel CPU 优化
            # PP-OCRv5 mobile 模型（精度+效率平衡）
            # 如需更高精度可切换为 server 版本
            det_model_dir=os.getenv("OCR_DET_MODEL"),  # None = 自动下载
            rec_model_dir=os.getenv("OCR_REC_MODEL"),  # None = 自动下载
            show_log=False,
        )

    def _fetch_image(self, bucket: str, key: str) -> Any:
        import numpy as np
        import requests
        from PIL import Image

        url = (
            key
            if isinstance(key, str) and key.startswith("http")
            else presigned_get(bucket, key)
        )
        data = requests.get(url, timeout=30).content
        img = Image.open(io.BytesIO(data)).convert("RGB")
        return np.array(img)

    def recognize(self, bucket: str, key: str) -> dict:
        """
        识别单张图片
        返回: {"pages": [{"text": "行文本"}], "text": "完整文本"}
        """
        try:
            img = self._fetch_image(bucket, key)
            res = self.ocr.ocr(img, cls=True)
            pages = []
            text = ""
            lines = res[0] if isinstance(res, list) else []
            for item in lines or []:
                s = item[1][0]
                text += s + "\n"
                pages.append({"text": s, "confidence": item[1][1]})
            return {"pages": pages, "text": text.strip()}
        except Exception as e:
            import logging
            logging.warning(f"[OCR] Recognition failed: {e}")
            return {"pages": [], "text": ""}


def get_ocr():
    """
    获取 OCR 引擎实例
    生产环境返回 PaddleOCREngine，CI/测试环境返回 MockOCR
    """
    try:
        return PaddleOCREngine()
    except Exception as e:
        import logging
        logging.warning(f"[OCR] Failed to load PaddleOCR, using MockOCR: {e}")
        return MockOCR()
