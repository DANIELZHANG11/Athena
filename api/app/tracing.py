import os
import time
import uuid
from fastapi import Request
from opentracing import Tracer
from jaeger_client import Config

_tracer: Tracer | None = None

def init_tracer():
    global _tracer
    if _tracer is not None:
        return
    host = os.getenv("JAEGER_HOST", "jaeger")
    service = os.getenv("SERVICE_NAME", "athena-api")
    cfg = Config(config={
        'sampler': {'type': 'const', 'param': 1},
        'local_agent': {'reporting_host': host, 'reporting_port': 6831},
        'logging': False,
    }, service_name=service)
    _tracer = cfg.initialize_tracer()

async def tracer_middleware(request: Request, call_next):
    global _tracer
    if _tracer is None:
        return await call_next(request)
    name = f"HTTP {request.method} {request.url.path}"
    span = _tracer.start_span(name)
    span.set_tag("http.method", request.method)
    span.set_tag("http.url", str(request.url))
    start = time.time()
    try:
        response = await call_next(request)
        span.set_tag("http.status_code", response.status_code)
        return response
    finally:
        span.log_kv({"duration_ms": int((time.time() - start) * 1000)})
        span.finish()