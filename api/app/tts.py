"""
TTS 文本转语音接口

职责：
- `/api/v1/tts`：根据定价规则扣费后生成示例 WAV（占位实现）并返回下载链接
- `/api/v1/tts/heartbeat`：累计本次合成时长（毫秒），用于计费统计

说明：
- 仅新增注释，不改动接口与业务逻辑
- 真正的在线合成由 services/tts 提供（Edge TTS），此处为占位 API
"""
import math
import os
import struct
import wave

from fastapi import APIRouter, Body, Depends, HTTPException

from .auth import require_user
from .db import engine
from .storage import make_object_key, presigned_get, upload_bytes

router = APIRouter(prefix="/api/v1/tts", tags=["tts"])


def _sine_wav(text: str) -> bytes:
    framerate = 8000
    duration = max(1.0, min(len(text) / 20.0, 10.0))
    freq = 440.0
    nframes = int(framerate * duration)
    buf = bytearray()
    for i in range(nframes):
        val = int(32767.0 * math.sin(2.0 * math.pi * freq * (i / framerate)))
        buf += struct.pack("<h", val)
    import io

    mem = io.BytesIO()
    w = wave.open(mem, "wb")
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(framerate)
    w.writeframes(buf)
    w.close()
    return mem.getvalue()


@router.post("")
async def tts(body: dict = Body(...), auth=Depends(require_user)):
    user_id, _ = auth
    input_text = body.get("text") or ""
    if not input_text:
        raise HTTPException(status_code=400, detail="invalid_text")
    async with engine.begin() as conn:
        await conn.exec_driver_sql(
            "SELECT set_config('app.user_id', '%s', true)" % user_id
        )
        res = await conn.exec_driver_sql(
            "SELECT price_amount, unit_size, currency FROM pricing_rules WHERE service_type = 'TTS' AND unit_type = 'CHARS' AND is_active = TRUE ORDER BY updated_at DESC LIMIT 1"
        )
        rule = res.fetchone()
        amt = 0
        cur = "CNY"
        if rule:
            units = max(1, int((len(input_text) + int(rule[1]) - 1) / int(rule[1])))
            amt = int(round(float(rule[0]) * 100)) * units
            cur = rule[2]
        if amt > 0:
            bal = await conn.exec_driver_sql(
                "SELECT balance FROM credit_accounts WHERE owner_id = current_setting('app.user_id')::uuid"
            )
            b = bal.fetchone()
            if not b or int(b[0]) < amt:
                raise HTTPException(status_code=400, detail="insufficient_balance")
            await conn.exec_driver_sql(
                "UPDATE credit_accounts SET balance = balance - %s, updated_at = now() WHERE owner_id = current_setting('app.user_id')::uuid"
                % amt
            )
            await conn.exec_driver_sql(
                "INSERT INTO credit_ledger(id, owner_id, amount, currency, reason, direction) VALUES (gen_random_uuid(), current_setting('app.user_id')::uuid, %s, '%s', 'tts', 'debit')"
                % (amt, cur)
            )
    wav = _sine_wav(input_text)
    key = make_object_key(user_id, "tts.wav")
    upload_bytes(os.getenv("MINIO_BUCKET", "athena"), key, wav, "audio/wav")
    req_id = None
    try:
        import uuid as _uuid

        req_id = str(_uuid.uuid4())
        async with engine.begin() as conn:
            await conn.exec_driver_sql(
                "INSERT INTO tts_requests(id, user_id, duration_ms) VALUES ('%s', '%s'::uuid, 0)"
                % (req_id, user_id)
            )
    except Exception:
        pass
    return {
        "status": "success",
        "data": {
            "download_url": presigned_get(os.getenv("MINIO_BUCKET", "athena"), key),
            "request_id": req_id,
        },
    }


@router.post("/heartbeat")
async def tts_heartbeat(body: dict = Body(...), auth=Depends(require_user)):
    user_id, _ = auth
    req_id = body.get("request_id")
    delta_ms = int(body.get("delta_ms") or 0)
    if not req_id or delta_ms < 0:
        raise HTTPException(status_code=400, detail="invalid_request")
    async with engine.begin() as conn:
        await conn.exec_driver_sql(
            "SELECT set_config('app.user_id', '%s', true)" % user_id
        )
        res = await conn.exec_driver_sql(
            "UPDATE tts_requests SET duration_ms = COALESCE(duration_ms,0) + %s, updated_at = now() WHERE id = cast('%s' as uuid) AND user_id = current_setting('app.user_id')::uuid RETURNING duration_ms"
            % (delta_ms, req_id)
        )
        row = res.fetchone()
        if not row:
            try:
                await conn.exec_driver_sql(
                    "INSERT INTO tts_requests(id, user_id, duration_ms) VALUES ('%s', current_setting('app.user_id')::uuid, 0)"
                    % req_id
                )
                res2 = await conn.exec_driver_sql(
                    "UPDATE tts_requests SET duration_ms = COALESCE(duration_ms,0) + %s, updated_at = now() WHERE id = cast('%s' as uuid) AND user_id = current_setting('app.user_id')::uuid RETURNING duration_ms"
                    % (delta_ms, req_id)
                )
                row = res2.fetchone()
            except Exception:
                raise HTTPException(status_code=404, detail="request_not_found")
        return {"status": "success", "data": {"duration_ms": int(row[0])}}
