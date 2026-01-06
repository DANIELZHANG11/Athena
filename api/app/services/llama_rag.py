"""
LlamaIndex RAG 服务

基于 02 号技术文档 2.5 节实现：
- 向量存储: OpenSearch
- Embedding: BGE-M3 (via HuggingFace)
- RAG Pipeline: Query Rewrite → Vector Search → Rerank → LLM

技术栈：
- llama-index>=0.10.0
- llama-index-vector-stores-opensearch
- llama-index-embeddings-huggingface

注意：所有 LlamaIndex 导入使用延迟加载，避免模块导入时初始化 PyTorch CUDA。
"""
import os
import logging
from typing import Optional, List, TYPE_CHECKING

# 类型检查时导入（不会执行）
if TYPE_CHECKING:
    from llama_index.embeddings.huggingface import HuggingFaceEmbedding
    from llama_index.vector_stores.opensearch import OpensearchVectorStore

logger = logging.getLogger(__name__)


# ============================================================================
# 配置常量
# ============================================================================

OPENSEARCH_URL = os.getenv("ES_URL", "http://opensearch:9200")
BOOK_CHUNKS_INDEX = "athena_book_chunks"
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL_NAME", "BAAI/bge-m3")
EMBEDDING_DIM = 1024

# ============================================================================
# Embedding 模型初始化（单例模式）
# ============================================================================

_embed_model = None


def get_embed_model():
    """
    获取 Embedding 模型实例（单例模式）
    
    使用 LlamaIndex 的 HuggingFaceEmbedding，自动处理：
    - GPU/CPU 设备检测
    - 模型缓存
    - 批量编码
    
    与之前的 embedder.py 不同，LlamaIndex 在失败时会直接抛出异常，
    而不是静默返回零向量。
    """
    global _embed_model
    
    if _embed_model is not None:
        return _embed_model
    
    # 缓存目录
    cache_folder = os.getenv("HF_HOME", "/app/.hf_cache")
    
    # 设备选择
    device = "cpu"
    use_gpu = os.getenv("EMBEDDING_USE_GPU", "true").lower() == "true"
    
    if use_gpu:
        try:
            import torch
            if torch.cuda.is_available():
                device = "cuda"
                logger.info("[LlamaRAG] CUDA available, using GPU for embeddings")
        except Exception as e:
            logger.warning(f"[LlamaRAG] Failed to check CUDA: {e}, using CPU")
    
    logger.info(f"[LlamaRAG] Loading embedding model {EMBEDDING_MODEL} on {device}")
    
    # 延迟导入
    from llama_index.embeddings.huggingface import HuggingFaceEmbedding
    
    _embed_model = HuggingFaceEmbedding(
        model_name=EMBEDDING_MODEL,
        device=device,
        cache_folder=cache_folder,
        embed_batch_size=32,
        normalize=True,  # BGE-M3 推荐归一化
    )
    
    logger.info(f"[LlamaRAG] Embedding model loaded successfully")
    return _embed_model


# ============================================================================
# OpenSearch Vector Store
# ============================================================================

def get_vector_store():
    """
    获取 OpenSearch Vector Store 实例
    
    配置：
    - 索引名: athena_book_chunks
    - 向量维度: 1024 (BGE-M3)
    - 使用 IK Analyzer 中文分词
    """
    # 延迟导入
    from llama_index.vector_stores.opensearch import OpensearchVectorStore
    
    return OpensearchVectorStore(
        opensearch_url=OPENSEARCH_URL,
        index=BOOK_CHUNKS_INDEX,
        dim=EMBEDDING_DIM,
    )


# ============================================================================
# 文本分块
# ============================================================================

def chunk_text(
    text: str,
    chunk_size: int = 512,
    chunk_overlap: int = 64,
) -> List[str]:
    """
    将文本分块
    
    使用 LlamaIndex 的 SentenceSplitter，支持中文句子边界。
    
    Args:
        text: 原始文本
        chunk_size: 每块最大字符数
        chunk_overlap: 块间重叠字符数
    
    Returns:
        分块文本列表
    """
    # 延迟导入
    from llama_index.core import Document
    from llama_index.core.node_parser import SentenceSplitter
    
    splitter = SentenceSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
    )
    
    # 创建文档并分块
    doc = Document(text=text)
    nodes = splitter.get_nodes_from_documents([doc])
    
    return [node.get_content() for node in nodes]


# ============================================================================
# 索引操作
# ============================================================================

async def index_book_chunks(
    book_id: str,
    user_id: str,
    text_content: str,
    book_title: Optional[str] = None,
    page_mapping: Optional[dict] = None,
) -> int:
    """
    为书籍创建向量索引
    
    Args:
        book_id: 书籍 ID
        user_id: 用户 ID
        text_content: 书籍文本内容
        book_title: 书籍标题
        page_mapping: 字符位置到页码的映射
    
    Returns:
        索引的块数量
    """
    logger.info(f"[LlamaRAG] Starting to index book {book_id}")
    
    # 延迟导入
    from llama_index.core import VectorStoreIndex, Settings, StorageContext
    from llama_index.core.schema import TextNode
    
    # 获取 embedding 模型
    embed_model = get_embed_model()
    Settings.embed_model = embed_model
    
    # 分块
    chunks = chunk_text(text_content)
    logger.info(f"[LlamaRAG] Split text into {len(chunks)} chunks")
    
    if not chunks:
        logger.warning(f"[LlamaRAG] No chunks generated for book {book_id}")
        return 0
    
    # 创建节点（带元数据）
    nodes = []
    for i, chunk in enumerate(chunks):
        # 计算页码（如果有映射）
        page = None
        if page_mapping:
            # 简化：使用块索引估算
            pass
        
        node = TextNode(
            text=chunk,
            metadata={
                "book_id": book_id,
                "user_id": user_id,
                "book_title": book_title or "",
                "chunk_index": i,
                "page": page,
            },
            excluded_embed_metadata_keys=["user_id"],  # 不将 user_id 嵌入向量
        )
        nodes.append(node)
    
    # 获取 vector store
    vector_store = get_vector_store()
    storage_context = StorageContext.from_defaults(vector_store=vector_store)
    
    # 创建索引（这会自动生成向量并存储）
    index = VectorStoreIndex(
        nodes,
        storage_context=storage_context,
        show_progress=True,
    )
    
    logger.info(f"[LlamaRAG] Successfully indexed {len(nodes)} chunks for book {book_id}")
    return len(nodes)


async def search_book_chunks(
    query: str,
    book_ids: List[str],
    user_id: str,
    top_k: int = 10,
) -> List[dict]:
    """
    在指定书籍中搜索相关内容块
    
    Args:
        query: 用户查询
        book_ids: 要搜索的书籍 ID 列表
        user_id: 用户 ID
        top_k: 返回结果数量
    
    Returns:
        相关内容块列表，每项包含：
        - content: 文本内容
        - book_id: 书籍 ID
        - page: 页码（如果有）
        - score: 相似度分数
    """
    if not book_ids:
        return []
    
    logger.info(f"[LlamaRAG] Searching for: '{query[:50]}...' in {len(book_ids)} books")
    
    # 延迟导入
    from llama_index.core import VectorStoreIndex, Settings
    
    # 配置 embedding 模型
    embed_model = get_embed_model()
    Settings.embed_model = embed_model
    
    # 获取 vector store
    vector_store = get_vector_store()
    
    # 从现有 vector store 创建索引
    index = VectorStoreIndex.from_vector_store(vector_store)
    
    # 创建检索器，带过滤条件
    retriever = index.as_retriever(
        similarity_top_k=top_k * 2,  # 多取一些，后续过滤
    )
    
    # 执行检索
    nodes = retriever.retrieve(query)
    
    # 过滤：只保留指定书籍和用户的结果
    results = []
    for node in nodes:
        meta = node.metadata or {}
        node_book_id = meta.get("book_id")
        node_user_id = meta.get("user_id")
        
        # 过滤条件
        if node_book_id in book_ids and node_user_id == user_id:
            results.append({
                "content": node.get_content(),
                "book_id": node_book_id,
                "page": meta.get("page"),
                "chapter": meta.get("chapter"),
                "score": node.score,
            })
        
        if len(results) >= top_k:
            break
    
    logger.info(f"[LlamaRAG] Found {len(results)} relevant chunks")
    return results


async def delete_book_index(book_id: str) -> bool:
    """
    删除书籍的所有向量索引
    
    Args:
        book_id: 书籍 ID
    
    Returns:
        是否成功
    """
    logger.info(f"[LlamaRAG] Deleting index for book {book_id}")
    
    # TODO: LlamaIndex OpenSearch 集成目前不支持按条件删除
    # 需要直接使用 opensearch-py 客户端
    from opensearchpy import AsyncOpenSearch
    
    client = AsyncOpenSearch(hosts=[OPENSEARCH_URL])
    try:
        response = await client.delete_by_query(
            index=BOOK_CHUNKS_INDEX,
            body={
                "query": {
                    "term": {"metadata.book_id": book_id}
                }
            },
            wait_for_completion=True,
        )
        deleted = response.get("deleted", 0)
        logger.info(f"[LlamaRAG] Deleted {deleted} chunks for book {book_id}")
        return True
    except Exception as e:
        logger.error(f"[LlamaRAG] Failed to delete book index: {e}")
        return False
    finally:
        await client.close()


async def get_index_stats() -> dict:
    """
    获取索引统计信息
    """
    from opensearchpy import AsyncOpenSearch
    
    client = AsyncOpenSearch(hosts=[OPENSEARCH_URL])
    try:
        count_response = await client.count(index=BOOK_CHUNKS_INDEX)
        return {
            "index": BOOK_CHUNKS_INDEX,
            "count": count_response.get("count", 0),
        }
    except Exception as e:
        logger.error(f"[LlamaRAG] Failed to get index stats: {e}")
        return {"index": BOOK_CHUNKS_INDEX, "count": 0, "error": str(e)}
    finally:
        await client.close()
