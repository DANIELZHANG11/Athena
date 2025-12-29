import base64
import json
import os
import time
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from jose import jwt
from sqlalchemy import text

from .db import engine

router = APIRouter()

AUTH_SECRET = os.getenv("AUTH_SECRET", "dev_secret")

_clients: dict[str, set] = {}
_versions: dict[str, int] = {}
_counters: dict[str, int] = {}
_last_snapshot_at: dict[str, float] = {}

# 广播频道客户端映射
_broadcast_clients: dict[str, set] = {}


async def ws_broadcast(channel: str, message: str):
    """向指定频道的所有 WebSocket 客户端广播消息"""
    clients = _broadcast_clients.get(channel, set())
    for ws in list(clients):
        try:
            await ws.send_text(message)
        except Exception:
            # 客户端可能已断开
            clients.discard(ws)


async def _load_version(user_id: str, note_id: str) -> int:
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        res = await conn.execute(
            text(
                "SELECT COALESCE(MAX(version_number), 0) FROM note_versions WHERE owner_id = current_setting('app.user_id')::uuid AND note_id = cast(:nid as uuid)"
            ),
            {"nid": note_id},
        )
        row = res.fetchone()
        return int(row[0] or 0)


async def _snapshot(user_id: str, note_id: str, version: int, update_bytes: bytes):
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id}
        )
        vid = str(uuid.uuid4())
        await conn.execute(
            text(
                "INSERT INTO note_versions(id, owner_id, note_id, version_number, update_data) VALUES (cast(:id as uuid), current_setting('app.user_id')::uuid, cast(:nid as uuid), :ver, :upd)"
            ),
            {"id": vid, "nid": note_id, "ver": version, "upd": update_bytes},
        )


@router.websocket("/ws/notes/{note_id}")
async def ws_note(websocket: WebSocket, note_id: str):
    await websocket.accept()
    token = websocket.query_params.get("token") or websocket.query_params.get(
        "access_token"
    )
    if not token:
        await websocket.send_text(json.dumps({"type": "error", "code": "unauthorized"}))
        await websocket.close()
        return
    try:
        # 【重要】verify_aud=False 因为 token 包含 aud: authenticated (PowerSync 要求)
        payload = jwt.decode(token, AUTH_SECRET, options={"verify_aud": False})
        user_id = payload["sub"]
    except Exception:
        await websocket.send_text(
            json.dumps({"type": "error", "code": "invalid_token"})
        )
        await websocket.close()
        return
    if note_id not in _versions:
        _versions[note_id] = await _load_version(user_id, note_id)
        _counters[note_id] = 0
        _last_snapshot_at[note_id] = time.monotonic()
    if note_id not in _clients:
        _clients[note_id] = set()
    _clients[note_id].add(websocket)
    await websocket.send_text(
        json.dumps({"type": "ready", "version": _versions[note_id]})
    )
    try:
        while True:
            msg = await websocket.receive_text()
            data = json.loads(msg)
            if data.get("type") == "update":
                client_ver = int(data.get("client_version") or 0)
                upd_b64 = data.get("update") or ""
                if _versions[note_id] > client_ver:
                    await websocket.send_text(
                        json.dumps({"type": "conflict", "version": _versions[note_id]})
                    )
                    continue
                upd_bytes = base64.b64decode(upd_b64)
                _versions[note_id] = _versions[note_id] + 1
                _counters[note_id] = _counters[note_id] + 1
                for ws in list(_clients.get(note_id, set())):
                    try:
                        await ws.send_text(
                            json.dumps(
                                {
                                    "type": "apply",
                                    "version": _versions[note_id],
                                    "update": upd_b64,
                                }
                            )
                        )
                    except Exception:
                        pass
                need_snap = False
                if _counters[note_id] >= 100:
                    need_snap = True
                else:
                    if time.monotonic() - _last_snapshot_at[note_id] >= 300:
                        need_snap = True
                if need_snap:
                    await _snapshot(user_id, note_id, _versions[note_id], upd_bytes)
                    _counters[note_id] = 0
                    _last_snapshot_at[note_id] = time.monotonic()
            else:
                await websocket.send_text(
                    json.dumps({"type": "error", "code": "bad_message"})
                )
    except WebSocketDisconnect:
        pass
    finally:
        try:
            _clients.get(note_id, set()).discard(websocket)
        except Exception:
            pass
