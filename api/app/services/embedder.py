import os

class MockEmbedder:
    def __init__(self, dim: int = 768):
        self.dim = dim

    def embed(self, texts: list[str]) -> list[list[float]]:
        out = []
        for _ in texts:
            vec = [0.0] * self.dim
            out.append(vec)
        return out

class LocalEmbedder:
    def __init__(self):
        from FlagEmbedding import BGEM3Embedding

        cache = (
            os.getenv("HF_HOME") or os.getenv("TRANSFORMERS_CACHE") or "/app/.hf_cache"
        )
        os.environ["HF_HOME"] = cache
        os.environ["TRANSFORMERS_CACHE"] = cache
        os.environ["HUGGINGFACE_HUB_CACHE"] = cache
        name = os.getenv("EMBEDDING_MODEL_NAME", "BAAI/bge-m3")
        self.model = BGEM3Embedding(model_name_or_path=name, device="cpu")

    def embed(self, texts: list[str]) -> list[list[float]]:
        try:
            out = self.model.embed(texts)
            vecs = out.get("dense_vecs") if isinstance(out, dict) else out
            return [list(map(float, v)) for v in vecs]
        except Exception:
            return [[0.0] * 1024 for _ in texts]

def get_embedder():
    try:
        return LocalEmbedder()
    except Exception:
        return MockEmbedder()
