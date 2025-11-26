FROM python:3.11-slim
WORKDIR /app
ENV HF_HOME=/app/.hf_cache
ENV TRANSFORMERS_CACHE=/app/.hf_cache
ENV HUGGINGFACE_HUB_CACHE=/app/.hf_cache
ENV PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple
ENV PIP_TRUSTED_HOST=mirrors.aliyun.com
ARG SKIP_HEAVY=true
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt && \
    if [ "$SKIP_HEAVY" != "true" ]; then pip install --no-cache-dir paddlepaddle paddleocr FlagEmbedding edge-tts; fi
COPY app /app/app
COPY alembic.ini /app/alembic.ini
COPY alembic /app/alembic
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
