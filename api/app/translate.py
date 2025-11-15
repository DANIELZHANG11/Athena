import os
import uuid
from fastapi import APIRouter, Body, Depends, HTTPException
import requests
from sqlalchemy import text
from .db import engine
from .auth import require_user
from .storage import upload_bytes, presigned_get, make_object_key

router = APIRouter(prefix="/api/v1/translate", tags=["translate"])

def _mock_translate(text: str, target_lang: str) -> str:
    return f"[{target_lang}] " + text[::-1]

def _openrouter_translate(text: str, target_lang: str) -> str | None:
    key = os.getenv("OPENROUTER_API_KEY", "").strip()
    model = os.getenv("OPENROUTER_MODEL", "openrouter/auto")
    if not key:
        return None
    try:
        resp = requests.post(
            "https://api.openrouter.ai/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": "You are a translation engine."},
                    {"role": "user", "content": f"Translate to {target_lang}: {text}"}
                ]
            }, timeout=10
        )
        j = resp.json()
        return j.get("choices", [{}])[0].get("message", {}).get("content")
    except Exception:
        return None

@router.post("")
async def translate(body: dict = Body(...), auth=Depends(require_user)):
    user_id, _ = auth
    text_in = body.get("text") or ""
    target = body.get("target_lang") or "zh"
    if not text_in:
        raise HTTPException(status_code=400, detail="invalid_text")
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id})
        res = await conn.execute(text("SELECT price_amount, unit_size, currency FROM pricing_rules WHERE service_type = 'AI_CALL' AND unit_type IN ('CHARS','TOKENS') AND is_active = TRUE ORDER BY updated_at DESC LIMIT 1"))
        rule = res.fetchone()
        amt = 0
        cur = 'CNY'
        if rule:
            units = max(1, int((len(text_in) + int(rule[1]) - 1) / int(rule[1])))
            amt = int(round(float(rule[0]) * 100)) * units
            cur = rule[2]
        if amt > 0:
            bal = await conn.execute(text("SELECT balance FROM credit_accounts WHERE owner_id = current_setting('app.user_id')::uuid"))
            b = bal.fetchone()
            if not b or int(b[0]) < amt:
                raise HTTPException(status_code=400, detail="insufficient_balance")
            await conn.execute(text("UPDATE credit_accounts SET balance = balance - :amt, updated_at = now() WHERE owner_id = current_setting('app.user_id')::uuid"), {"amt": amt})
            lid = str(uuid.uuid4())
            await conn.execute(text("INSERT INTO credit_ledger(id, owner_id, amount, currency, reason, direction) VALUES (cast(:id as uuid), current_setting('app.user_id')::uuid, :amt, :cur, 'ai_translate', 'debit')"), {"id": lid, "amt": amt, "cur": cur})
    out = _openrouter_translate(text_in, target) or _mock_translate(text_in, target)
    key = make_object_key(user_id, "translation.txt")
    upload_bytes(os.getenv("MINIO_BUCKET", "athena"), key, out.encode("utf-8"), "text/plain")
    return {"status": "success", "data": {"text": out, "download_url": presigned_get(os.getenv("MINIO_BUCKET", "athena"), key)}}