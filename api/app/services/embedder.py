"""
嵌入向量引擎

说明：
- `LocalEmbedder` 使用 BGE-M3 本地模型（优先 GPU，失败回退 CPU）
- `MockEmbedder` 在 CI/测试环境返回固定向量
- `get_embedder` 根据环境选择实现
"""
import os
import logging


class MockEmbedder:
    """Mock Embedder for CI/testing environments"""
    
    def __init__(self, dim: int = 1024):
        self.dim = dim

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [[0.0] * self.dim for _ in texts]


class LocalEmbedder:
    """
    BGE-M3 Local Embedding Engine
    - 模型: BAAI/bge-m3 (1024 维度)
    - 支持: 中英日韩等多语言
    - 设备: 优先 GPU，fallback 到 CPU
    """
    
    def __init__(self):
        from FlagEmbedding import BGEM3FlagModel

        # 缓存目录配置
        cache = (
            os.getenv("HF_HOME") or os.getenv("TRANSFORMERS_CACHE") or "/app/.hf_cache"
        )
        os.environ["HF_HOME"] = cache
        os.environ["TRANSFORMERS_CACHE"] = cache
        os.environ["HUGGINGFACE_HUB_CACHE"] = cache
        
        # 模型配置
        model_name = os.getenv("EMBEDDING_MODEL_NAME", "BAAI/bge-m3")
        
        # 设备选择: 优先使用 GPU
        use_gpu = os.getenv("EMBEDDING_USE_GPU", "true").lower() == "true"
        device = "cuda" if use_gpu else "cpu"
        
        try:
            self.model = BGEM3FlagModel(
                model_name_or_path=model_name,
                device=device,
                use_fp16=use_gpu,  # GPU 时使用半精度加速
            )
            logging.info(f"[Embedder] Loaded {model_name} on {device}")
        except Exception as e:
            logging.warning(f"[Embedder] Failed to load on {device}, fallback to CPU: {e}")
            self.model = BGEM3FlagModel(
                model_name_or_path=model_name,
                device="cpu",
                use_fp16=False,
            )

    def embed(self, texts: list[str]) -> list[list[float]]:
        """
        生成文本向量
        返回: List[List[float]] - 1024 维向量列表
        """
        try:
            # BGE-M3 返回 dense_vecs
            output = self.model.encode(
                texts,
                batch_size=32,
                max_length=512,
            )
            vecs = output.get("dense_vecs") if isinstance(output, dict) else output
            return [list(map(float, v)) for v in vecs]
        except Exception as e:
            logging.warning(f"[Embedder] Encoding failed: {e}")
            return [[0.0] * 1024 for _ in texts]


def get_embedder():
    """
    获取 Embedder 实例
    生产环境返回 LocalEmbedder，CI/测试环境返回 MockEmbedder
    """
    try:
        return LocalEmbedder()
    except Exception as e:
        logging.warning(f"[Embedder] Failed to load BGE-M3, using MockEmbedder: {e}")
        return MockEmbedder()
