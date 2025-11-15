import os
import json
import time
import threading
from urllib import request, error

ES_URL = os.getenv("ES_URL", "http://elasticsearch:9200")
NOTES_INDEX = os.getenv("ES_INDEX_NOTES", "notes")
HIGHLIGHTS_INDEX = os.getenv("ES_INDEX_HIGHLIGHTS", "highlights")
BOOKS_INDEX = os.getenv("ES_INDEX_BOOKS", "books")

def _put(url: str, payload: dict):
    try:
        data = json.dumps(payload).encode()
        req = request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="PUT")
        with request.urlopen(req, timeout=5) as resp:
            resp.read()
    except Exception:
        pass

def _delete(url: str):
    try:
        req = request.Request(url, headers={"Content-Type": "application/json"}, method="DELETE")
        with request.urlopen(req, timeout=5) as resp:
            resp.read()
    except Exception:
        pass

def index_note(id: str, user_id: str, book_id: str, content: str, tags: list[str] | None):
    if not ES_URL:
        return
    doc = {"id": id, "user_id": user_id, "book_id": book_id, "content": content, "tag_ids": tags or [], "updated_at": int(time.time()*1000)}
    url = f"{ES_URL}/{NOTES_INDEX}/_doc/{id}"
    threading.Thread(target=_put, args=(url, doc), daemon=True).start()

def delete_note(id: str):
    if not ES_URL:
        return
    url = f"{ES_URL}/{NOTES_INDEX}/_doc/{id}"
    threading.Thread(target=_delete, args=(url,), daemon=True).start()

def index_highlight(id: str, user_id: str, book_id: str, comment: str, color: str, tags: list[str] | None):
    if not ES_URL:
        return
    doc = {"id": id, "user_id": user_id, "book_id": book_id, "text_content": comment or "", "color": color or "", "tag_ids": tags or [], "updated_at": int(time.time()*1000)}
    url = f"{ES_URL}/{HIGHLIGHTS_INDEX}/_doc/{id}"
    threading.Thread(target=_put, args=(url, doc), daemon=True).start()

def delete_highlight(id: str):
    if not ES_URL:
        return
    url = f"{ES_URL}/{HIGHLIGHTS_INDEX}/_doc/{id}"
    threading.Thread(target=_delete, args=(url,), daemon=True).start()

def index_book(id: str, user_id: str, title: str, author: str):
    if not ES_URL:
        return
    doc = {"id": id, "user_id": user_id, "title": title or "", "author": author or "", "updated_at": int(time.time()*1000)}
    url = f"{ES_URL}/{BOOKS_INDEX}/_doc/{id}"
    threading.Thread(target=_put, args=(url, doc), daemon=True).start()

def delete_book(id: str):
    if not ES_URL:
        return
    url = f"{ES_URL}/{BOOKS_INDEX}/_doc/{id}"
    threading.Thread(target=_delete, args=(url,), daemon=True).start()