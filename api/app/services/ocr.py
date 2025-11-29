import io
import os
from typing import Any
from ..storage import presigned_get

class MockOCR:
    def recognize(self, bucket: str, key: str) -> dict:
        return {"pages": [], "text": ""}

class PaddleOCREngine:
    def __init__(self, lang: str | None = None):
        from paddleocr import PaddleOCR

        self.ocr = PaddleOCR(
            use_angle_cls=True, lang=lang or os.getenv("OCR_LANG", "ch")
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
        try:
            img = self._fetch_image(bucket, key)
            res = self.ocr.ocr(img, cls=True)
            pages = []
            text = ""
            lines = res[0] if isinstance(res, list) else []
            for item in lines or []:
                s = item[1][0]
                text += s + "\n"
                pages.append({"text": s})
            return {"pages": pages, "text": text.strip()}
        except Exception:
            return {"pages": [], "text": ""}

def get_ocr():
    try:
        return PaddleOCREngine()
    except Exception:
        return MockOCR()
