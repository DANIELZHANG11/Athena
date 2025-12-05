"""
对象存储封装（MinIO/S3）

功能：
- 生成预签名上传/下载 URL
- 读写对象（全量/头部）、查询 ETag、删除对象
- 公网域名重写，兼容前端访问与代理
"""
import os
import uuid
from datetime import timedelta
from urllib.parse import urlparse, urlunparse

import boto3


def get_s3():
    endpoint = os.getenv("MINIO_ENDPOINT", "seaweed:8333")
    access = os.getenv("MINIO_ACCESS_KEY")
    secret = os.getenv("MINIO_SECRET_KEY")
    secure = os.getenv("MINIO_SECURE", "false").lower() == "true"
    scheme = "https" if secure else "http"
    endpoint_url = endpoint if endpoint.startswith("http") else f"{scheme}://{endpoint}"
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=access,
        aws_secret_access_key=secret,
    )


def ensure_bucket(client, bucket: str):
    try:
        client.head_bucket(Bucket=bucket)
    except Exception:
        try:
            client.create_bucket(Bucket=bucket)
        except Exception:
            pass


def make_object_key(user_id: str, filename: str) -> str:
    return f"users/{user_id}/{uuid.uuid4()}/{filename}"


def presigned_put(bucket: str, key: str, expires_hours: int = 1, content_type: str | None = None) -> str:
    client = get_s3()
    ensure_bucket(client, bucket)
    url = client.generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key, **({"ContentType": content_type} if content_type else {})},
        ExpiresIn=int(timedelta(hours=expires_hours).total_seconds()),
    )
    return _rewrite_public(url)


def presigned_get(bucket: str, key: str, expires_hours: int = 24) -> str:
    client = get_s3()
    ensure_bucket(client, bucket)
    url = client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=int(timedelta(hours=expires_hours).total_seconds()),
    )
    return _rewrite_public(url)


def upload_bytes(
    bucket: str, key: str, data: bytes, content_type: str = "application/octet-stream"
) -> None:
    client = get_s3()
    ensure_bucket(client, bucket)
    client.put_object(Bucket=bucket, Key=key, Body=data, ContentType=content_type)


def read_head(bucket: str, key: str, length: int = 65536) -> bytes | None:
    try:
        client = get_s3()
        ensure_bucket(client, bucket)
        resp = client.get_object(Bucket=bucket, Key=key)
        body = resp.get("Body")
        if not body:
            return None
        data = body.read(length)
        return data
    except Exception:
        return None


def read_full(bucket: str, key: str) -> bytes | None:
    """读取完整文件内容"""
    try:
        client = get_s3()
        ensure_bucket(client, bucket)
        resp = client.get_object(Bucket=bucket, Key=key)
        body = resp.get("Body")
        if not body:
            return None
        data = body.read()
        return data
    except Exception:
        return None


def stat_etag(bucket: str, key: str) -> str | None:
    try:
        client = get_s3()
        ensure_bucket(client, bucket)
        head = client.head_object(Bucket=bucket, Key=key)
        etag = head.get("ETag")
        if isinstance(etag, str):
            return etag.strip('"')
        return None
    except Exception:
        return None


def delete_object(bucket: str, key: str) -> bool:
    """删除 MinIO 对象，返回是否成功"""
    try:
        client = get_s3()
        client.delete_object(Bucket=bucket, Key=key)
        return True
    except Exception as e:
        print(f"[Storage] Failed to delete {bucket}/{key}: {e}")
        return False


def _rewrite_public(url: str) -> str:
    pub = os.getenv("MINIO_PUBLIC_ENDPOINT", "").strip()
    if not pub:
        return url
    try:
        u = urlparse(url)
        p = urlparse(pub if pub.startswith("http") else f"http://{pub}")
        return urlunparse(
            (
                p.scheme or u.scheme,
                p.netloc or u.netloc,
                u.path,
                u.params,
                u.query,
                u.fragment,
            )
        )
    except Exception:
        return url
