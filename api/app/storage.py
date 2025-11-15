import os
import uuid
from datetime import timedelta
from minio import Minio
from urllib.parse import urlparse, urlunparse


def get_minio():
    endpoint = os.getenv("MINIO_ENDPOINT", "minio:9000")
    access = os.getenv("MINIO_ACCESS_KEY")
    secret = os.getenv("MINIO_SECRET_KEY")
    secure = os.getenv("MINIO_SECURE", "false").lower() == "true"
    return Minio(endpoint, access_key=access, secret_key=secret, secure=secure)


def ensure_bucket(client: Minio, bucket: str):
    if not client.bucket_exists(bucket):
        client.make_bucket(bucket)


def make_object_key(user_id: str, filename: str) -> str:
    return f"users/{user_id}/{uuid.uuid4()}/{filename}"


def presigned_put(bucket: str, key: str, expires_hours: int = 1) -> str:
    client = get_minio()
    ensure_bucket(client, bucket)
    url = client.presigned_put_object(bucket, key, expires=timedelta(hours=expires_hours))
    return _rewrite_public(url)


def presigned_get(bucket: str, key: str, expires_hours: int = 24) -> str:
    client = get_minio()
    ensure_bucket(client, bucket)
    url = client.presigned_get_object(bucket, key, expires=timedelta(hours=expires_hours))
    return _rewrite_public(url)

def upload_bytes(bucket: str, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    client = get_minio()
    ensure_bucket(client, bucket)
    import io
    client.put_object(bucket, key, io.BytesIO(data), length=len(data), content_type=content_type)

def read_head(bucket: str, key: str, length: int = 65536) -> bytes | None:
    try:
        client = get_minio()
        ensure_bucket(client, bucket)
        resp = client.get_object(bucket, key)
        data = resp.read(length)
        resp.close()
        resp.release_conn()
        return data
    except Exception:
        return None

def stat_etag(bucket: str, key: str) -> str | None:
    try:
        client = get_minio()
        ensure_bucket(client, bucket)
        stat = client.stat_object(bucket, key)
        return getattr(stat, 'etag', None)
    except Exception:
        return None

def _rewrite_public(url: str) -> str:
    pub = os.getenv("MINIO_PUBLIC_ENDPOINT", "").strip()
    if not pub:
        return url
    try:
        u = urlparse(url)
        p = urlparse(pub if pub.startswith("http") else f"http://{pub}")
        return urlunparse((p.scheme or u.scheme, p.netloc or u.netloc, u.path, u.params, u.query, u.fragment))
    except Exception:
        return url