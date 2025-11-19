import io
import os
import math
import asyncio
from typing import Any

class MockOCR:
    def recognize(self, bucket: str, key: str) -> dict:
        return {"pages": [], "text": ""}

class MockEmbedder:
    def __init__(self, dim: int = 768):
        self.dim = dim
    def embed(self, texts: list[str]) -> list[list[float]]:
        out = []
        for _ in texts:
            vec = [0.0] * self.dim
            out.append(vec)
        return out

class MockTTS:
    def synthesize(self, text: str) -> tuple[bytes, list[dict]]:
        rate = 16000
        duration = max(0.1, len(text) / 32)
        samples = int(duration * rate)
        buf = io.BytesIO()
        import wave
        w = wave.open(buf, "wb")
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        for i in range(samples):
            val = int(32767 * math.sin(2 * math.pi * 440 * (i / rate)))
            w.writeframes(val.to_bytes(2, byteorder="little", signed=True))
        w.close()
        captions = []
        t = 0.0
        for chunk in text.split():
            captions.append({"start": round(t, 2), "end": round(t + 0.2, 2), "text": chunk})
            t += 0.2
        return buf.getvalue(), captions

class PaddleOCREngine:
    def __init__(self, lang: str | None = None):
        from paddleocr import PaddleOCR
        self.ocr = PaddleOCR(use_angle_cls=True, lang=lang or os.getenv("OCR_LANG", "ch"))
    def _fetch_image(self, bucket: str, key: str) -> Any:
        from .storage import presigned_get
        import requests
        from PIL import Image
        import numpy as np
        url = key if isinstance(key, str) and key.startswith("http") else presigned_get(bucket, key)
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

class LocalEmbedder:
    def __init__(self):
        from FlagEmbedding import BGEM3Embedding
        cache = os.getenv("HF_HOME") or os.getenv("TRANSFORMERS_CACHE") or "/app/.hf_cache"
        os.environ["HF_HOME"] = cache
        os.environ["TRANSFORMERS_CACHE"] = cache
        os.environ["HUGGINGFACE_HUB_CACHE"] = cache
        name = os.getenv("EMBEDDING_MODEL_NAME", "BAAI/bge-m3")
        self.model = BGEM3Embedding(model_name_or_path=name, device="cpu")
    def embed(self, texts: list[str]) -> list[list[float]]:
        try:
            out = self.model.embed(texts)
            vecs = out.get("dense_vecs") if isinstance(out, dict) else out
            return [list(map(float, v)) for v in vecs]
        except Exception:
            return [[0.0] * 1024 for _ in texts]

class EdgeTTSEngine:
    def __init__(self, voice: str | None = None, rate: str | None = None):
        self.voice = voice or os.getenv("TTS_VOICE", "zh-CN-XiaoxiaoNeural")
        self.rate = rate or os.getenv("TTS_RATE", "+0%")
    async def _gen(self, text: str) -> bytes:
        import edge_tts
        c = edge_tts.Communicate(text, voice=self.voice, rate=self.rate)
        audio = b""
        async for chunk in c.stream():
            if chunk["type"] == "audio":
                audio += chunk["data"]
        return audio
    def synthesize(self, text: str) -> tuple[bytes, list[dict]]:
        try:
            audio = asyncio.get_event_loop().run_until_complete(self._gen(text))
        except Exception:
            audio = asyncio.run(self._gen(text))
        captions = []
        t = 0.0
        for w in text.split():
            s = t
            e = t + 0.2
            captions.append({"start": round(s, 2), "end": round(e, 2), "text": w})
            t = e
        return audio, captions

    def synthesize_vtt(self, text: str) -> tuple[bytes, str]:
        audio, caps = self.synthesize(text)
        def _fmt(t: float) -> str:
            ms = int(round(t * 1000))
            h = ms // 3600000
            ms = ms % 3600000
            m = ms // 60000
            ms = ms % 60000
            s = ms // 1000
            ms = ms % 1000
            return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"
        lines = ["WEBVTT"]
        idx = 1
        for c in caps:
            start = _fmt(float(c["start"]))
            end = _fmt(float(c["end"]))
            lines.append(str(idx))
            lines.append(f"{start} --> {end}")
            lines.append(str(c["text"]))
            lines.append("")
            idx += 1
        vtt = "\n".join(lines)
        return audio, vtt

def get_ocr():
    try:
        return PaddleOCREngine()
    except Exception:
        return MockOCR()

def get_embedder():
    try:
        return LocalEmbedder()
    except Exception:
        return MockEmbedder()

def get_tts():
    try:
        return EdgeTTSEngine()
    except Exception:
        return MockTTS()