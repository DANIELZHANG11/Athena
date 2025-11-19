import os
import json
import time
from celery import shared_task
import requests

ES_URL = os.getenv("ES_URL", "http://opensearch:9200")
NOTES_INDEX = os.getenv("ES_INDEX_NOTES", "notes")
HIGHLIGHTS_INDEX = os.getenv("ES_INDEX_HIGHLIGHTS", "highlights")
BOOKS_INDEX = os.getenv("ES_INDEX_BOOKS", "books")

def _put(url: str, payload: dict):
    try:
        resp = requests.put(url, json=payload, timeout=5)
        resp.raise_for_status()
    except Exception:
        raise

def _delete(url: str):
    try:
        resp = requests.delete(url, timeout=5)
        resp.raise_for_status()
    except Exception:
        raise

@shared_task(bind=True, name="search.index_note", autoretry_for=(Exception,), retry_backoff=True, retry_kwargs={"max_retries": 8})
def task_index_note(self, id: str, user_id: str, book_id: str, content: str, tags: list[str] | None):
    if not ES_URL:
        return
    doc = {"id": id, "user_id": user_id, "book_id": book_id, "content": content, "tag_ids": tags or [], "updated_at": int(time.time()*1000)}
    url = f"{ES_URL}/{NOTES_INDEX}/_doc/{id}"
    _put(url, doc)

@shared_task(bind=True, name="search.delete_note", autoretry_for=(Exception,), retry_backoff=True, retry_kwargs={"max_retries": 8})
def task_delete_note(self, id: str):
    if not ES_URL:
        return
    url = f"{ES_URL}/{NOTES_INDEX}/_doc/{id}"
    _delete(url)

@shared_task(bind=True, name="search.index_highlight", autoretry_for=(Exception,), retry_backoff=True, retry_kwargs={"max_retries": 8})
def task_index_highlight(self, id: str, user_id: str, book_id: str, comment: str, color: str, tags: list[str] | None):
    if not ES_URL:
        return
    doc = {"id": id, "user_id": user_id, "book_id": book_id, "text_content": comment or "", "color": color or "", "tag_ids": tags or [], "updated_at": int(time.time()*1000)}
    url = f"{ES_URL}/{HIGHLIGHTS_INDEX}/_doc/{id}"
    _put(url, doc)

@shared_task(bind=True, name="search.delete_highlight", autoretry_for=(Exception,), retry_backoff=True, retry_kwargs={"max_retries": 8})
def task_delete_highlight(self, id: str):
    if not ES_URL:
        return
    url = f"{ES_URL}/{HIGHLIGHTS_INDEX}/_doc/{id}"
    _delete(url)

@shared_task(bind=True, name="search.index_book", autoretry_for=(Exception,), retry_backoff=True, retry_kwargs={"max_retries": 8})
def task_index_book(self, id: str, user_id: str, title: str, author: str):
    if not ES_URL:
        return
    doc = {"id": id, "user_id": user_id, "title": title or "", "author": author or "", "updated_at": int(time.time()*1000)}
    url = f"{ES_URL}/{BOOKS_INDEX}/_doc/{id}"
    _put(url, doc)

@shared_task(bind=True, name="search.delete_book", autoretry_for=(Exception,), retry_backoff=True, retry_kwargs={"max_retries": 8})
def task_delete_book(self, id: str):
    if not ES_URL:
        return
    url = f"{ES_URL}/{BOOKS_INDEX}/_doc/{id}"
    _delete(url)

def index_note(id: str, user_id: str, book_id: str, content: str, tags: list[str] | None):
    if not ES_URL:
        return
    try:
        task_index_note.delay(id, user_id, book_id, content, tags)
    except Exception:
        pass

def delete_note(id: str):
    if not ES_URL:
        return
    try:
        task_delete_note.delay(id)
    except Exception:
        pass

def index_highlight(id: str, user_id: str, book_id: str, comment: str, color: str, tags: list[str] | None):
    if not ES_URL:
        return
    try:
        task_index_highlight.delay(id, user_id, book_id, comment, color, tags)
    except Exception:
        pass

def delete_highlight(id: str):
    if not ES_URL:
        return
    try:
        task_delete_highlight.delay(id)
    except Exception:
        pass

def index_book(id: str, user_id: str, title: str, author: str):
    if not ES_URL:
        return
    try:
        task_index_book.delay(id, user_id, title, author)
    except Exception:
        pass

def delete_book(id: str):
    if not ES_URL:
        return
    try:
        task_delete_book.delay(id)
    except Exception:
        pass