import os
import time

import requests
from celery import shared_task

ES_URL = os.getenv("ES_URL", "http://opensearch:9200")
NOTES_INDEX = os.getenv("ES_INDEX_NOTES", "notes")
HIGHLIGHTS_INDEX = os.getenv("ES_INDEX_HIGHLIGHTS", "highlights")
BOOKS_INDEX = os.getenv("ES_INDEX_BOOKS", "books")
BOOK_CONTENT_INDEX = os.getenv("ES_INDEX_BOOK_CONTENT", "book_content")


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


def _bulk(index: str, docs: list[dict]):
    """批量索引文档"""
    if not docs:
        return
    try:
        lines = []
        for doc in docs:
            doc_id = doc.get("id")
            lines.append(f'{{"index": {{"_index": "{index}", "_id": "{doc_id}"}}}}')
            lines.append(requests.compat.json.dumps(doc, ensure_ascii=False))
        body = "\n".join(lines) + "\n"
        resp = requests.post(
            f"{ES_URL}/_bulk",
            data=body.encode("utf-8"),
            headers={"Content-Type": "application/x-ndjson"},
            timeout=30,
        )
        resp.raise_for_status()
        result = resp.json()
        if result.get("errors"):
            print(f"[Search] Bulk index had errors: {result}")
    except Exception as e:
        print(f"[Search] Bulk index failed: {e}")
        raise


@shared_task(
    bind=True,
    name="search.index_note",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 8},
)
def task_index_note(
    self, id: str, user_id: str, book_id: str, content: str, tags: list[str] | None
):
    if not ES_URL:
        return
    doc = {
        "id": id,
        "user_id": user_id,
        "book_id": book_id,
        "content": content,
        "tag_ids": tags or [],
        "updated_at": int(time.time() * 1000),
    }
    url = f"{ES_URL}/{NOTES_INDEX}/_doc/{id}"
    _put(url, doc)


@shared_task(
    bind=True,
    name="search.delete_note",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 8},
)
def task_delete_note(self, id: str):
    if not ES_URL:
        return
    url = f"{ES_URL}/{NOTES_INDEX}/_doc/{id}"
    _delete(url)


@shared_task(
    bind=True,
    name="search.index_highlight",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 8},
)
def task_index_highlight(
    self,
    id: str,
    user_id: str,
    book_id: str,
    comment: str,
    color: str,
    tags: list[str] | None,
):
    if not ES_URL:
        return
    doc = {
        "id": id,
        "user_id": user_id,
        "book_id": book_id,
        "text_content": comment or "",
        "color": color or "",
        "tag_ids": tags or [],
        "updated_at": int(time.time() * 1000),
    }
    url = f"{ES_URL}/{HIGHLIGHTS_INDEX}/_doc/{id}"
    _put(url, doc)


@shared_task(
    bind=True,
    name="search.delete_highlight",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 8},
)
def task_delete_highlight(self, id: str):
    if not ES_URL:
        return
    url = f"{ES_URL}/{HIGHLIGHTS_INDEX}/_doc/{id}"
    _delete(url)


@shared_task(
    bind=True,
    name="search.index_book",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 8},
)
def task_index_book(self, id: str, user_id: str, title: str, author: str):
    if not ES_URL:
        return
    doc = {
        "id": id,
        "user_id": user_id,
        "title": title or "",
        "author": author or "",
        "updated_at": int(time.time() * 1000),
    }
    url = f"{ES_URL}/{BOOKS_INDEX}/_doc/{id}"
    _put(url, doc)


@shared_task(
    bind=True,
    name="search.delete_book",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 8},
)
def task_delete_book(self, id: str):
    if not ES_URL:
        return
    url = f"{ES_URL}/{BOOKS_INDEX}/_doc/{id}"
    _delete(url)


@shared_task(
    bind=True,
    name="search.index_book_content",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 5},
)
def task_index_book_content(self, book_id: str, user_id: str, ocr_pages: list[dict]):
    """
    索引书籍 OCR 内容，按页分段存储
    每页作为一个文档，支持全文搜索
    """
    if not ES_URL:
        return
    
    # 确保索引存在
    try:
        mapping = {
            "mappings": {
                "properties": {
                    "book_id": {"type": "keyword"},
                    "user_id": {"type": "keyword"},
                    "page": {"type": "integer"},
                    "content": {
                        "type": "text",
                        "analyzer": "ik_max_word",
                        "search_analyzer": "ik_smart"
                    },
                    "updated_at": {"type": "date", "format": "epoch_millis"}
                }
            }
        }
        requests.put(f"{ES_URL}/{BOOK_CONTENT_INDEX}", json=mapping, timeout=10)
    except Exception:
        pass  # 索引可能已存在
    
    # 按页分组内容
    page_docs = {}
    for item in ocr_pages:
        page_num = item.get("page", 1)
        text = item.get("text", "")
        if text:
            if page_num not in page_docs:
                page_docs[page_num] = []
            page_docs[page_num].append(text)
    
    # 创建批量索引文档
    docs = []
    now = int(time.time() * 1000)
    for page_num, texts in page_docs.items():
        doc_id = f"{book_id}_p{page_num}"
        docs.append({
            "id": doc_id,
            "book_id": book_id,
            "user_id": user_id,
            "page": page_num,
            "content": "\n".join(texts),
            "updated_at": now,
        })
    
    # 分批索引（每批 100 个文档）
    batch_size = 100
    for i in range(0, len(docs), batch_size):
        batch = docs[i:i + batch_size]
        _bulk(BOOK_CONTENT_INDEX, batch)
    
    print(f"[Search] Indexed {len(docs)} pages for book {book_id}")


def index_note(
    id: str, user_id: str, book_id: str, content: str, tags: list[str] | None
):
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


def index_highlight(
    id: str,
    user_id: str,
    book_id: str,
    comment: str,
    color: str,
    tags: list[str] | None,
):
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


def index_book_content(book_id: str, user_id: str, ocr_pages: list[dict]):
    """索引书籍 OCR 内容"""
    if not ES_URL:
        return
    try:
        task_index_book_content.delay(book_id, user_id, ocr_pages)
    except Exception:
        pass
