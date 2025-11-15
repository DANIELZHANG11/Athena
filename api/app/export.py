import io
import uuid
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import text
from reportlab.pdfgen import canvas
from .db import engine
from .auth import require_user
from .storage import upload_bytes, presigned_get, make_object_key

router = APIRouter(prefix="/api/v1/export", tags=["export"])

def _to_pdf(text: str) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    y = 800
    for line in text.splitlines():
        c.drawString(40, y, line[:120])
        y -= 16
        if y < 40:
            c.showPage()
            y = 800
    c.save()
    return buf.getvalue()

@router.get("/ocr/{job_id}")
async def export_ocr(job_id: str, format: str = Query("txt"), auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id})
        res = await conn.execute(text("SELECT result_text FROM ocr_jobs WHERE id = cast(:id as uuid) AND owner_id = current_setting('app.user_id')::uuid"), {"id": job_id})
        row = res.fetchone()
        if not row or not row[0]:
            raise HTTPException(status_code=404, detail="not_found")
        text_content = row[0]
    bucket = "athena"
    key = make_object_key(user_id, f"ocr-export-{job_id}.{format}")
    if format == "txt":
        upload_bytes(bucket, key, text_content.encode("utf-8"), "text/plain")
    elif format in ("md","markdown"):
        md = f"# OCR Export\n\n{text_content}"
        upload_bytes(bucket, key, md.encode("utf-8"), "text/markdown")
    elif format == "pdf":
        pdf = _to_pdf(text_content)
        upload_bytes(bucket, key, pdf, "application/pdf")
    else:
        raise HTTPException(status_code=400, detail="unsupported_format")
    return {"status": "success", "data": {"download_url": presigned_get(bucket, key)}}

@router.get("/notes")
async def export_notes(format: str = Query("md"), auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id})
        res = await conn.execute(text("SELECT content, book_id::text, created_at FROM notes WHERE user_id = current_setting('app.user_id')::uuid AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 500"))
        rows = res.fetchall()
    lines = []
    if format == "txt":
        for r in rows:
            lines.append(r[0])
        data = ("\n\n".join(lines)).encode("utf-8")
        ct = "text/plain"
    elif format in ("md","markdown"):
        for r in rows:
            lines.append(f"- {r[0]}")
        md = "# Notes Export\n\n" + "\n".join(lines)
        data = md.encode("utf-8")
        ct = "text/markdown"
    elif format == "pdf":
        text_content = "\n".join([r[0] for r in rows])
        data = _to_pdf(text_content)
        ct = "application/pdf"
    else:
        raise HTTPException(status_code=400, detail="unsupported_format")
    bucket = "athena"
    key = make_object_key(user_id, f"notes-export-{uuid.uuid4()}.{format}")
    upload_bytes(bucket, key, data, ct)
    return {"status": "success", "data": {"download_url": presigned_get(bucket, key)}}

@router.get("/ai/{conversation_id}")
async def export_ai(conversation_id: str, format: str = Query("md"), auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id})
        res = await conn.execute(text("SELECT role, content, created_at FROM ai_messages WHERE owner_id = current_setting('app.user_id')::uuid AND conversation_id = cast(:cid as uuid) ORDER BY created_at ASC"), {"cid": conversation_id})
        rows = res.fetchall()
    lines = []
    for r in rows:
        ts = r[2]
        try:
            ts_str = ts.strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            ts_str = str(ts)
        lines.append("[" + r[0] + "] " + ts_str + "\n" + r[1])
    text_content = "\n\n".join(lines)
    bucket = "athena"
    key = make_object_key(user_id, f"ai-export-{conversation_id}.{format}")
    if format == "txt":
        upload_bytes(bucket, key, text_content.encode("utf-8"), "text/plain")
    elif format in ("md","markdown"):
        md = "# AI Conversation\n\n" + "\n\n".join(["## " + l.split("\n",1)[0] + "\n" + l.split("\n",1)[1] for l in lines])
        upload_bytes(bucket, key, md.encode("utf-8"), "text/markdown")
    elif format == "pdf":
        pdf = _to_pdf(text_content)
        upload_bytes(bucket, key, pdf, "application/pdf")
    else:
        raise HTTPException(status_code=400, detail="unsupported_format")
    return {"status": "success", "data": {"download_url": presigned_get(bucket, key)}}