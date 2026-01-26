"""
Athena API 入口

说明：
- 注册各业务子路由（认证、书籍、阅读、OCR、AI、搜索、定价、账单等）
- 接入 Sentry、Prometheus 指标与链路追踪中间件
- 全局异常处理：返回统一结构的 JSON 错误
- 提供健康检查与 RLS 测试端点
"""
import os

import sentry_sdk
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_fastapi_instrumentator import Instrumentator
from sqlalchemy import text

from .admin import router as admin_router
from .admin_panel import router as admin_panel_router
from .ai import router as ai_router
from .auth import router as auth_router
from .billing import router as billing_router
from .books import router as books_router
from .books import shelves_router
from .db import engine
from .dict import dict_router
from .dict import packages_router as dict_packages_router
from .docs import router as docs_router
from .export import router as export_router
from .notes import highlights_router, notes_router, tags_router
from .invites import router as invites_router
from .ocr import router as ocr_router
from .pricing import admin as pricing_admin_router
from .pricing import router as pricing_router
from .profile import router as profile_router
from .reader import alias as reader_alias_router
from .reader import router as reader_router
from .realtime import router as realtime_router
from .search import router as search_router
from .srs import router as srs_router
from .tracing import init_tracer, tracer_middleware
from .translate import router as translate_router
# TTS 路由 - 已禁用（改用客户端 Web Speech API）
# from .tts import router as tts_router
from .home import router as home_router
from .powersync import router as powersync_router
from .admin_ai import router as admin_ai_router

sentry_dsn = os.getenv("SENTRY_DSN", "")
if sentry_dsn:
    sentry_sdk.init(dsn=sentry_dsn)

app = FastAPI(redirect_slashes=False)  # 禁用尾部斜杠重定向，避免代理问题
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)
init_tracer()
app.middleware("http")(tracer_middleware)
Instrumentator().instrument(app).expose(app)
app.include_router(auth_router)
app.include_router(books_router)
app.include_router(shelves_router)
app.include_router(reader_router)
app.include_router(reader_alias_router)
app.include_router(docs_router)
app.include_router(notes_router)
app.include_router(tags_router)
app.include_router(highlights_router)
app.include_router(search_router)
app.include_router(billing_router)
# TTS 路由 - 已禁用（改用客户端 Web Speech API）
# app.include_router(tts_router)
app.include_router(dict_packages_router)
app.include_router(dict_router)
app.include_router(translate_router)
app.include_router(admin_router)
app.include_router(realtime_router)
app.include_router(pricing_router)
app.include_router(ai_router)
app.include_router(pricing_admin_router)
app.include_router(export_router)
app.include_router(admin_panel_router)
app.include_router(home_router)
app.include_router(powersync_router)
app.include_router(admin_ai_router)


@app.websocket("/ws/docs/{doc_id}")
async def ws_docs(websocket, doc_id: str):
    from .ws import websocket_endpoint as _ep

    return await _ep(websocket, doc_id)


@app.exception_handler(HTTPException)
async def http_exc_handler(request: Request, exc: HTTPException):
    code = str(exc.detail) if isinstance(exc.detail, str) else "http_error"
    return JSONResponse(
        status_code=exc.status_code,
        content={"status": "error", "error": {"code": code, "message": code}},
    )


@app.exception_handler(Exception)
async def generic_exc_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={
            "status": "error",
            "error": {"code": "internal_error", "message": "internal_error"},
        },
    )


app.include_router(ocr_router)
app.include_router(srs_router)
app.include_router(profile_router)
app.include_router(invites_router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/")
def root():
    return {"status": "ok", "service": "athena-api"}


@app.post("/rls/echo")
async def rls_echo(x_user_id: str = Header(None), x_role: str = Header(None)):
    async with engine.begin() as conn:
        if x_user_id:
            await conn.execute(
                text("SELECT set_config('app.user_id', :v, true)"), {"v": x_user_id}
            )
        if x_role:
            await conn.execute(
                text("SELECT set_config('app.role', :v, true)"), {"v": x_role}
            )
        res = await conn.execute(
            text(
                "SELECT current_setting('app.user_id', true), current_setting('app.role', true)"
            )
        )
        row = res.fetchone()
        return {"user_id": row[0], "role": row[1]}


@app.post("/rls/progress")
async def rls_progress(
    x_user_id: str = Header(None), book_id: str = "00000000-0000-0000-0000-000000000001"
):
    async with engine.begin() as conn:
        if x_user_id:
            await conn.execute(
                text("SELECT set_config('app.user_id', :v, true)"), {"v": x_user_id}
            )
        await conn.execute(
            text(
                "INSERT INTO reading_progress(user_id, book_id, progress) VALUES (cast(:u as uuid), cast(:b as uuid), 0.5) ON CONFLICT (user_id, book_id) DO UPDATE SET progress=EXCLUDED.progress, updated_at=now()"
            ),
            {"u": x_user_id, "b": book_id},
        )
        res = await conn.execute(
            text(
                "SELECT user_id, book_id, progress FROM reading_progress WHERE user_id = current_setting('app.user_id')::uuid"
            )
        )
        rows = res.fetchall()
        return [
            {"user_id": str(r[0]), "book_id": str(r[1]), "progress": float(r[2])}
            for r in rows
        ]


@app.get("/error")
def error():
    raise RuntimeError("intentional")
