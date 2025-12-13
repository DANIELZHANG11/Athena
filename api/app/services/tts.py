"""
TTS（文本转语音）引擎封装

职责：
- 生产环境优先使用 Edge TTS（微软在线合成），支持设置 `voice` 与 `rate`
- 失败或本地离线时回退到 `MockTTS`，生成示例正弦波与简单字幕分割

返回：
- `synthesize(text) -> (audio_bytes, captions)`
- `synthesize_vtt(text) -> (audio_bytes, vtt_string)`
"""
import asyncio
import io
import math
import os

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
            captions.append(
                {"start": round(t, 2), "end": round(t + 0.2, 2), "text": chunk}
            )
            t += 0.2
        return buf.getvalue(), captions

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

def get_tts():
    """
    获取 TTS 引擎实例
    生产环境返回 `EdgeTTSEngine`，异常时回退到 `MockTTS`
    """
    try:
        return EdgeTTSEngine()
    except Exception:
        return MockTTS()
