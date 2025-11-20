from fastapi import WebSocket

channels: dict[str, set[WebSocket]] = {}
server = None


async def broadcast(doc_id: str, message: str):
    for ws in list(channels.get(doc_id, set())):
        try:
            await ws.send_text(message)
        except Exception:
            pass


async def websocket_endpoint(websocket: WebSocket, doc_id: str):
    await websocket.accept()
    channels.setdefault(doc_id, set()).add(websocket)
    try:
        global server
        if server is None:
            from ypy_websocket.websocket_server import WebsocketServer

            server = WebsocketServer()
        await server.serve(websocket, doc_id)
    finally:
        try:
            channels.get(doc_id, set()).discard(websocket)
        except Exception:
            pass
