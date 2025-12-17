FROM zukubq0aouv2k2.xuanyuan.run/python:3.11-slim

WORKDIR /app

# 环境变量配置
ENV HF_HOME=/app/.hf_cache
ENV TRANSFORMERS_CACHE=/app/.hf_cache
ENV HUGGINGFACE_HUB_CACHE=/app/.hf_cache

# pip 配置：使用国内镜像 + 增加超时 + 重试
ENV PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ENV PIP_TRUSTED_HOST=pypi.tuna.tsinghua.edu.cn
ENV PIP_DEFAULT_TIMEOUT=300
ENV PIP_RETRIES=5

# OCR/Embedding GPU 配置
ENV FLAGS_fraction_of_gpu_memory_to_use=0.4
ENV OCR_GPU_MEM=3500
ENV OCR_CPU_THREADS=6

ARG SKIP_HEAVY=true

# 使用国内 Debian 镜像源加速
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list 2>/dev/null || true

# 安装系统依赖（适配 Debian Trixie）
RUN apt-get update && \
    apt-get install -y --no-install-recommends --fix-missing \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    curl \
    tesseract-ocr \
    tesseract-ocr-chi-sim \
    tesseract-ocr-chi-tra \
    tesseract-ocr-eng \
    ghostscript \
    unpaper \
    && rm -rf /var/lib/apt/lists/* || \
    (apt-get update && apt-get install -y --fix-missing \
    libgl1 libglib2.0-0 libgomp1 curl \
    tesseract-ocr tesseract-ocr-chi-sim tesseract-ocr-chi-tra tesseract-ocr-eng \
    ghostscript unpaper && rm -rf /var/lib/apt/lists/*)

# 升级 pip 并安装基础依赖
COPY requirements.txt /app/requirements.txt
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r /app/requirements.txt

# 安装重型 AI 依赖（OCR + Embedding + TTS）
# SKIP_HEAVY=false 时安装完整版本
RUN if [ "$SKIP_HEAVY" != "true" ]; then \
    # PaddlePaddle GPU 版本 (CUDA 11.8) - 支持 PP-OCRv5
    pip install --no-cache-dir paddlepaddle-gpu==3.0.0 -i https://www.paddlepaddle.org.cn/packages/stable/cu118/ --timeout 300 && \
    # PaddleOCR 3.x (支持 PP-OCRv5 mobile) - 3.3.2 修复与 PaddleX 3.3.10 的兼容性
    pip install --no-cache-dir paddleocr==3.3.2 --timeout 300 && \
    # BGE-M3 Embedding 模型
    pip install --no-cache-dir FlagEmbedding --timeout 300 && \
    # Edge TTS
    pip install --no-cache-dir edge-tts --timeout 300; \
    fi

COPY app /app/app
COPY alembic.ini /app/alembic.ini
COPY alembic /app/alembic

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
