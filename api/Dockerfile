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

# ⚠️ GPU 优先策略环境变量
# PyTorch GPU 配置
ENV CUDA_VISIBLE_DEVICES=0
ENV TORCH_CUDA_ARCH_LIST="7.5;8.0;8.6;8.9;9.0"

# PaddlePaddle GPU 配置 - 限制显存使用，避免 OOM
ENV FLAGS_fraction_of_gpu_memory_to_use=0.3
ENV FLAGS_gpu_memory_limit_mb=3500
ENV FLAGS_initial_gpu_memory_in_mb=500
ENV FLAGS_reallocate_gpu_memory_in_mb=500

# HuggingFace Embedding GPU 配置
ENV SENTENCE_TRANSFORMERS_HOME=/app/.hf_cache
ENV HF_DATASETS_OFFLINE=0

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
    build-essential \
    && rm -rf /var/lib/apt/lists/* || \
    (apt-get update && apt-get install -y --fix-missing \
    libgl1 libglib2.0-0 libgomp1 curl build-essential \
    tesseract-ocr tesseract-ocr-chi-sim tesseract-ocr-chi-tra tesseract-ocr-eng \
    ghostscript unpaper && rm -rf /var/lib/apt/lists/*)

# 升级 pip 并安装基础依赖
COPY requirements.txt /app/requirements.txt
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r /app/requirements.txt

# 安装重型 AI 依赖（OCR + Embedding + TTS）
# SKIP_HEAVY=false 时安装完整版本
# ⚠️ GPU 优先策略：所有 AI 任务优先使用 GPU，只有 GPU 内存不足时才回退 CPU
RUN if [ "$SKIP_HEAVY" != "true" ]; then \
    # ========================================
    # 1. PaddlePaddle GPU 版本 - 支持 PP-OCRv5
    # 官方安装文档: https://www.paddlepaddle.org.cn/install/quick
    # 
    # 注意：paddlepaddle-gpu 本身在 GPU 不可用时会自动回退到 CPU
    # 无需单独安装 CPU 版本作为备用
    # ========================================
    pip install --no-cache-dir paddlepaddle-gpu -i https://www.paddlepaddle.org.cn/packages/stable/cu126/ --timeout 600 || \
    pip install --no-cache-dir paddlepaddle-gpu -i https://www.paddlepaddle.org.cn/packages/stable/cu118/ --timeout 600 || \
    pip install --no-cache-dir paddlepaddle-gpu --timeout 600 && \
    # PaddleOCR 3.x (支持 PP-OCRv5 mobile)
    pip install --no-cache-dir paddleocr==3.3.2 --timeout 300 && \
    # ========================================
    # 2. BGE-M3 Embedding 模型
    # ========================================
    pip install --no-cache-dir FlagEmbedding --timeout 300; \
    # 注意：edge-tts 已移除，TTS 功能已迁移到客户端 (Sherpa-ONNX WASM)
    fi


COPY app /app/app
COPY alembic.ini /app/alembic.ini
COPY alembic /app/alembic

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
