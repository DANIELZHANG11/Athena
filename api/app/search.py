from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import text
from .auth import require_user
import os
import json
from urllib import request
from .db import engine
from .search_sync import index_note, index_highlight, index_book


router = APIRouter(prefix="/api/v1/search", tags=["search"])


@router.get("")
async def search(q: str | None = Query(None), kind: str | None = Query(None), tag_ids: list[str] | None = Query(None), sort_by: str | None = Query(None), limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0), auth=Depends(require_user), response: Response = None):
    user_id, _ = auth
    items = []
    used_es = False
    es_url = os.getenv("ES_URL", "http://elasticsearch:9200")
    if es_url:
        queries = []
        if kind in (None, "note"):
            qnote = {
                "query": {
                    "bool": {
                        "must": ([{"match": {"content": q}}] if q else [{"match_all": {}}]),
                        "filter": [{"match": {"user_id": user_id}}] + ([{"terms": {"tag_ids": tag_ids}}] if tag_ids else [])
                    }
                },
                "highlight": {"fields": {"content": {}}},
                "from": offset,
                "size": limit
            }
            if sort_by == "updated_at":
                qnote["sort"] = [{"updated_at": {"order": "desc"}}]
            queries.append((f"{es_url}/{os.getenv('ES_INDEX_NOTES', 'notes')}/_search", qnote, "note"))
        if kind in (None, "highlight"):
            qhl = {
                "query": {
                    "bool": {
                        "must": ([{"match": {"text_content": q}}] if q else [{"match_all": {}}]),
                        "filter": [{"match": {"user_id": user_id}}] + ([{"terms": {"tag_ids": tag_ids}}] if tag_ids else [])
                    }
                },
                "highlight": {"fields": {"text_content": {}}},
                "from": offset,
                "size": limit
            }
            if sort_by == "updated_at":
                qhl["sort"] = [{"updated_at": {"order": "desc"}}]
            queries.append((f"{es_url}/{os.getenv('ES_INDEX_HIGHLIGHTS', 'highlights')}/_search", qhl, "highlight"))
        if kind in (None, "book"):
            qbook = {
                "query": {
                    "bool": {
                        "must": ([{"multi_match": {"query": q, "fields": ["title^2", "author"]}}] if q else [{"match_all": {}}]),
                        "filter": [{"match": {"user_id": user_id}}]
                    }
                },
                "highlight": {"fields": {"title": {}, "author": {}}},
                "from": offset,
                "size": limit
            }
            if sort_by == "updated_at":
                qbook["sort"] = [{"updated_at": {"order": "desc"}}]
            queries.append((f"{es_url}/{os.getenv('ES_INDEX_BOOKS', 'books')}/_search", qbook, "book"))
        for url, payload, k in queries:
            try:
                data = json.dumps(payload).encode()
                req = request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
                with request.urlopen(req, timeout=5) as resp:
                    out = json.loads(resp.read().decode())
                    hits = out.get("hits", {}).get("hits", [])
                    for h in hits:
                        src = h.get("_source", {})
                        hl = h.get("highlight", {})
                        fragments = []
                        if k == "note":
                            fragments = hl.get("content", []) or []
                        elif k == "highlight":
                            fragments = hl.get("text_content", []) or []
                        else:
                            fragments = (hl.get("title", []) or []) + (hl.get("author", []) or [])
                        items.append({
                            "kind": k,
                            "id": src.get("id"),
                            ("content" if k == "note" else ("comment" if k == "highlight" else "title")): src.get("content") if k == "note" else (src.get("text_content") if k == "highlight" else src.get("title")),
                            ("book_id" if k != "book" else "author"): src.get("book_id") if k != "book" else src.get("author"),
                            "score": float(h.get("_score") or 0),
                            "highlight": {"fragments": fragments}
                        })
                used_es = True
            except Exception:
                used_es = False
    if not used_es:
        async with engine.begin() as conn:
            await conn.execute(text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id})
            if kind in (None, "note"):
                base = "SELECT 'note' as kind, id::text, content, book_id::text, updated_at, version, 0 AS score FROM notes WHERE user_id = current_setting('app.user_id')::uuid AND deleted_at IS NULL"
                params = {"q": q, "limit": limit, "offset": offset}
                if tag_ids:
                    base += " AND EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = notes.id AND nt.tag_id = ANY(:tids))"
                    params["tids"] = tag_ids
                if q:
                    base += " AND content ILIKE '%' || CAST(:q AS text) || '%'"
                base += " ORDER BY updated_at DESC LIMIT :limit OFFSET :offset"
                res = await conn.execute(text(base), params)
                rows = res.fetchall()
                for r in rows:
                    items.append({"kind": r[0], "id": r[1], "content": r[2], "book_id": r[3], "updated_at": str(r[4]), "etag": f"W/\"{int(r[5])}\"", "score": float(r[6])})
            if kind in (None, "highlight"):
                base = "SELECT 'highlight' as kind, id::text, comment, book_id::text, updated_at, version, 0 AS score FROM highlights WHERE user_id = current_setting('app.user_id')::uuid AND deleted_at IS NULL"
                params = {"q": q, "limit": limit, "offset": offset}
                if tag_ids:
                    base += " AND EXISTS (SELECT 1 FROM highlight_tags ht WHERE ht.highlight_id = highlights.id AND ht.tag_id = ANY(:tids))"
                    params["tids"] = tag_ids
                if q:
                    base += " AND comment ILIKE '%' || CAST(:q AS text) || '%'"
                base += " ORDER BY updated_at DESC LIMIT :limit OFFSET :offset"
                res = await conn.execute(text(base), params)
                rows = res.fetchall()
                for r in rows:
                    items.append({"kind": r[0], "id": r[1], "comment": r[2], "book_id": r[3], "updated_at": str(r[4]), "etag": f"W/\"{int(r[5])}\"", "score": float(r[6])})
            if kind in (None, "book"):
                base = "SELECT 'book' as kind, id::text, title, author, updated_at, version FROM books WHERE user_id = current_setting('app.user_id')::uuid"
                params = {"q": q, "limit": limit, "offset": offset}
                if q:
                    base += " AND (title ILIKE '%' || :q || '%' OR author ILIKE '%' || :q || '%')"
                base += " ORDER BY updated_at DESC LIMIT :limit OFFSET :offset"
                res = await conn.execute(text(base), params)
                rows = res.fetchall()
                for r in rows:
                    items.append({"kind": r[0], "id": r[1], "title": r[2], "author": r[3], "updated_at": str(r[4]), "etag": f"W/\"{int(r[5])}\""})
    if response is not None:
        response.headers["X-Search-Engine"] = "elasticsearch" if used_es else "postgres-tsvector"
    return {"status": "success", "data": items}

@router.post("/reindex")
async def reindex(limit: int = Query(100, ge=1, le=1000), auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id})
        resn = await conn.execute(text("SELECT id::text, book_id::text, content FROM notes WHERE user_id = current_setting('app.user_id')::uuid AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT :limit"), {"limit": limit})
        for r in resn.fetchall():
            index_note(r[0], user_id, r[1], r[2], None)
        resh = await conn.execute(text("SELECT id::text, book_id::text, comment, color FROM highlights WHERE user_id = current_setting('app.user_id')::uuid AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT :limit"), {"limit": limit})
        for r in resh.fetchall():
            index_highlight(r[0], user_id, r[1], r[2], r[3], None)
    return {"status": "success"}

@router.post("/reindex_all")
async def reindex_all(limit: int = Query(1000, ge=1, le=5000), auth=Depends(require_user)):
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.role', 'admin', true)"))
        resn = await conn.execute(text("SELECT id::text, user_id::text, book_id::text, content FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT :limit"), {"limit": limit})
        for r in resn.fetchall():
            index_note(r[0], r[1], r[2], r[3], None)
        resh = await conn.execute(text("SELECT id::text, user_id::text, book_id::text, comment, color FROM highlights WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT :limit"), {"limit": limit})
        for r in resh.fetchall():
            index_highlight(r[0], r[1], r[2], r[3], r[4], None)
    return {"status": "success"}

@router.post("/reindex_books")
async def reindex_books(limit: int = Query(1000, ge=1, le=5000), auth=Depends(require_user)):
    user_id, _ = auth
    async with engine.begin() as conn:
        await conn.execute(text("SELECT set_config('app.user_id', :v, true)"), {"v": user_id})
        resb = await conn.execute(text("SELECT id::text, title, author FROM books WHERE user_id = current_setting('app.user_id')::uuid ORDER BY updated_at DESC LIMIT :limit"), {"limit": limit})
        for r in resb.fetchall():
            index_book(r[0], user_id, r[1], r[2])
    return {"status": "success"}