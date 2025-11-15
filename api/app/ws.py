from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import text
from .db import engine

channels: dict[str, set[WebSocket]] = {}
event_counts: dict[str, int] = {}
doc_versions: dict[str, int] = {}

async def broadcast(doc_id: str, message: str):
    for ws in list(channels.get(doc_id, set())):
        try:
            await ws.send_text(message)
        except Exception:
            pass

async def _ensure(conn):
    await conn.exec_driver_sql(
        """
        CREATE TABLE IF NOT EXISTS doc_events (
          id UUID PRIMARY KEY,
          doc_id TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS doc_snapshots (
          id UUID PRIMARY KEY,
          doc_id TEXT NOT NULL,
          snapshot TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        );
        """
    )

async def websocket_endpoint(websocket: WebSocket, doc_id: str):
    await websocket.accept()
    channels.setdefault(doc_id, set()).add(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            base_version = None
            try:
                import json as _j
                obj = _j.loads(data)
                base_version = int(obj.get("base_version")) if isinstance(obj, dict) and obj.get("base_version") is not None else None
                content = obj.get("content") if isinstance(obj, dict) else data
            except Exception:
                content = data
            cur_ver = doc_versions.get(doc_id, 0)
            if base_version is not None and base_version != cur_ver:
                async with engine.begin() as conn:
                    await _ensure(conn)
                    await conn.execute(text("INSERT INTO doc_conflicts(doc_id, base_version, actual_version) VALUES (:d, :b, :a)"), {"d": doc_id, "b": base_version, "a": cur_ver})
                    await conn.execute(text("INSERT INTO doc_drafts(doc_id, snapshot) SELECT :d, COALESCE((SELECT snapshot FROM doc_snapshots WHERE doc_id = :d ORDER BY created_at DESC LIMIT 1), '')"), {"d": doc_id})
            cur_ver += 1
            doc_versions[doc_id] = cur_ver
            try:
                msg = content if isinstance(content, str) else data
                import json as _j
                payload = _j.dumps({"version": cur_ver, "content": msg})
            except Exception:
                payload = data
            # broadcast
            for ws in list(channels.get(doc_id, set())):
                try:
                    await ws.send_text(payload)
                except Exception:
                    pass
            # persist events
            async with engine.begin() as conn:
                await _ensure(conn)
                await conn.execute(text("INSERT INTO doc_events(id, doc_id, content) VALUES (gen_random_uuid(), :d, :c)"), {"d": doc_id, "c": payload})
            # snapshot threshold
            cnt = event_counts.get(doc_id, 0) + 1
            event_counts[doc_id] = cnt
            if cnt % 20 == 0:
                async with engine.begin() as conn:
                    await conn.execute(text("INSERT INTO doc_snapshots(id, doc_id, snapshot) SELECT gen_random_uuid(), :d, string_agg(content, '\n') FROM doc_events WHERE doc_id = :d"), {"d": doc_id})
    except WebSocketDisconnect:
        pass
    finally:
        channels.get(doc_id, set()).discard(websocket)