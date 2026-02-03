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
# 私人数据索引（笔记和高亮）- 必须按 user_id 过滤
USER_NOTES_INDEX = "athena_user_notes"
USER_HIGHLIGHTS_INDEX = "athena_user_highlights"

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL_NAME", "BAAI/bge-m3")
EMBEDDING_DIM = 1024

# 【内存优化配置】
# embed_batch_size: 每次 embedding 的文本数量，RTX 3060/3070 建议 8-16
EMBEDDING_BATCH_SIZE = int(os.getenv("EMBEDDING_BATCH_SIZE", "16"))
# 节点批处理大小：20万字书籍约产生450节点，设为450可一次完成一本书
INDEX_NODE_BATCH_SIZE = int(os.getenv("INDEX_NODE_BATCH_SIZE", "450"))
# GPU 可用性显存阈值（GB），低于此值回退 CPU
GPU_MIN_FREE_GB = float(os.getenv("GPU_MIN_FREE_GB", "2.0"))

# ============================================================================
# Embedding 模型初始化（单例模式）
# ============================================================================

_embed_model = None
_embed_device = None  # 记录当前使用的设备


def check_gpu_memory_available(min_free_gb: float = None) -> bool:
    """
    检查 GPU 是否有足够显存可用
    
    Args:
        min_free_gb: 最小可用显存（GB），默认使用 GPU_MIN_FREE_GB 配置
    
    Returns:
        True 如果有足够显存，False 否则
    """
    if min_free_gb is None:
        min_free_gb = GPU_MIN_FREE_GB
    
    try:
        import torch
        if not torch.cuda.is_available():
            return False
        
        # 获取 GPU 显存信息
        device = torch.cuda.current_device()
        total_memory = torch.cuda.get_device_properties(device).total_memory
        allocated_memory = torch.cuda.memory_allocated(device)
        free_memory = total_memory - allocated_memory
        
        free_gb = free_memory / (1024 ** 3)
        logger.debug(f"[LlamaRAG] GPU memory: {free_gb:.2f}GB free / {total_memory / (1024**3):.2f}GB total")
        
        return free_gb >= min_free_gb
    except Exception as e:
        logger.warning(f"[LlamaRAG] Failed to check GPU memory: {e}")
        return False


def get_gpu_memory_info() -> dict:
    """
    获取 GPU 显存使用信息
    
    Returns:
        包含 total_gb, used_gb, free_gb 的字典，或空字典（如果不可用）
    """
    try:
        import torch
        if not torch.cuda.is_available():
            return {}
        
        device = torch.cuda.current_device()
        total = torch.cuda.get_device_properties(device).total_memory
        allocated = torch.cuda.memory_allocated(device)
        
        return {
            "total_gb": round(total / (1024 ** 3), 2),
            "used_gb": round(allocated / (1024 ** 3), 2),
            "free_gb": round((total - allocated) / (1024 ** 3), 2),
        }
    except Exception:
        return {}


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
    
    global _embed_device
    
    # 设备选择（带显存检查）
    device = "cpu"
    use_gpu = os.getenv("EMBEDDING_USE_GPU", "true").lower() == "true"
    
    if use_gpu:
        try:
            import torch
            if torch.cuda.is_available():
                # 检查显存是否充足
                if check_gpu_memory_available():
                    device = "cuda"
                    mem_info = get_gpu_memory_info()
                    logger.info(f"[LlamaRAG] CUDA available with {mem_info.get('free_gb', '?')}GB free, using GPU")
                else:
                    logger.warning(f"[LlamaRAG] GPU memory below {GPU_MIN_FREE_GB}GB threshold, using CPU")
        except Exception as e:
            logger.warning(f"[LlamaRAG] Failed to check CUDA: {e}, using CPU")
    
    _embed_device = device
    logger.info(f"[LlamaRAG] Loading embedding model {EMBEDDING_MODEL} on {device}")
    logger.info(f"[LlamaRAG] Config: batch_size={EMBEDDING_BATCH_SIZE}, node_batch={INDEX_NODE_BATCH_SIZE}, min_gpu={GPU_MIN_FREE_GB}GB")
    
    # 延迟导入
    from llama_index.embeddings.huggingface import HuggingFaceEmbedding
    import torch
    
    # 【内存优化】使用 FP16 精度减少显存占用 (2.24GB → 1.12GB)
    model_kwargs = {
        "torch_dtype": torch.float16 if device == "cuda" else torch.float32,
    }
    
    # 【性能优化 2026-01-09】
    # max_length: 限制最大token长度（大多数chunk不需要8192这么长）
    MAX_LENGTH = int(os.getenv("EMBEDDING_MAX_LENGTH", "2048"))
    
    _embed_model = HuggingFaceEmbedding(
        model_name=EMBEDDING_MODEL,
        device=device,
        cache_folder=cache_folder,
        embed_batch_size=EMBEDDING_BATCH_SIZE,  # 【优化】使用环境变量配置
        normalize=True,  # BGE-M3 推荐归一化
        model_kwargs=model_kwargs,
        max_length=MAX_LENGTH,  # 【优化】限制最大token长度
    )
    
    logger.info(f"[LlamaRAG] Embedding model loaded successfully on {device}")
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
    - 使用 cosinesimil 作为距离度量（与 BGE-M3 归一化向量配合）
    """
    # 延迟导入
    from llama_index.vector_stores.opensearch import (
        OpensearchVectorStore,
        OpensearchVectorClient,
    )
    
    # llama-index-vector-stores-opensearch 0.6.x 使用 OpensearchVectorClient
    client = OpensearchVectorClient(
        endpoint=OPENSEARCH_URL,
        index=BOOK_CHUNKS_INDEX,
        dim=EMBEDDING_DIM,
        embedding_field="embedding",
        text_field="text",
        engine="nmslib",
        space_type="cosinesimil",  # BGE-M3 使用 cosine 相似度
    )
    
    return OpensearchVectorStore(client=client)


# ============================================================================
# 文本分块
# ============================================================================

def chunk_text(
    text: str,
    chunk_size: int = 1024,
    chunk_overlap: int = 128,  # 【优化 2026-01-12】512→1024, 50→128 减少chunk数量提升语义连贯性
) -> List[str]:
    """
    将文本分块
    
    使用 LlamaIndex 的 SentenceSplitter，支持中文句子边界。
    
    【优化历史】
    - 2026-01-12: chunk_size 512→1024, overlap 50→128
      减少约50%的向量数量，同时保证段落完整性
    
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


def chunk_text_with_sections(
    structured_content: List[dict],
    chunk_size: int = 1024,
    chunk_overlap: int = 128,
    original_format: str = 'epub',
) -> List[dict]:
    """
    将结构化文本分块，保留章节/页码信息
    
    【优化历史】
    - 2026-01-12: chunk_size 512→1024, overlap 50→128
      减少约50%的向量数量，同时保证段落完整性
    
    Args:
        structured_content: 结构化内容列表
            - EPUB: [{"section_index": 0, "filename": "...", "text": "..."}, ...]
            - PDF: [{"page": 1, "text": "..."}, ...]
        chunk_size: 每块最大字符数
        chunk_overlap: 块间重叠字符数
        original_format: 原始格式 'epub' 或 'pdf'
    
    Returns:
        分块列表，每项包含：
        - text: 分块文本
        - section_index: 章节索引（EPUB）
        - page: 页码（PDF）
        - chunk_index: 块在该章节/页内的索引
        - chapter_title: 章节标题（用于元数据注入）
    """
    from llama_index.core import Document
    from llama_index.core.node_parser import SentenceSplitter
    
    splitter = SentenceSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
    )
    
    result_chunks = []
    
    for section in structured_content:
        section_text = section.get('text', '')
        if not section_text or len(section_text.strip()) < 10:
            continue
        
        # 分块此章节/页
        doc = Document(text=section_text)
        nodes = splitter.get_nodes_from_documents([doc])
        
        # 【新增】获取章节标题用于元数据注入
        chapter_title = section.get('title', '')
        
        for i, node in enumerate(nodes):
            chunk_data = {
                'text': node.get_content(),
                'chunk_index': i,
                'chapter_title': chapter_title,  # 【新增】传递章节标题
            }
            
            if original_format == 'epub':
                chunk_data['section_index'] = section.get('section_index', 0)
                # 兼容两种字段名：section_href（index_tasks.py）和 filename（旧代码）
                chunk_data['section_filename'] = section.get('section_href') or section.get('filename', '')
            else:  # PDF
                chunk_data['page'] = section.get('page', 1)
            
            result_chunks.append(chunk_data)
    
    logger.info(f"[LlamaRAG] chunk_text_with_sections: {len(structured_content)} sections → {len(result_chunks)} chunks")
    return result_chunks


# ============================================================================
# 索引操作
# ============================================================================

async def index_book_chunks(
    book_id: str,
    content_sha256: str,
    text_content: str,
    book_title: Optional[str] = None,
    page_mapping: Optional[dict] = None,
    structured_content: Optional[List[dict]] = None,
    original_format: Optional[str] = None,
) -> int:
    """
    为书籍创建向量索引（公共数据，所有用户共享）
    
    Args:
        book_id: 书籍 ID
        content_sha256: 文件内容 SHA256（用于秒传匹配）
        text_content: 书籍文本内容（仅用于回退）
        book_title: 书籍标题
        page_mapping: 字符位置到页码的映射（已废弃）
        structured_content: 结构化内容列表（推荐使用）
            - EPUB: [{"section_index": 0, "filename": "...", "text": "...", "title": "..."}, ...]
            - PDF: [{"page": 1, "text": "..."}, ...]
        original_format: 原始格式 'epub' 或 'pdf'
    
    Returns:
        索引的块数量
    
    【优化历史】
    - 2026-01-12: 实现元数据注入策略
      embedding向量使用"书名 | 章节名 | 正文"拼接，增强语义理解
      存储时text字段只保留纯正文，embedding_text保存完整拼接文本
    - 2026-01-15: 存储优化
      - 直接写入OpenSearch，移除LlamaIndex冗余字段（_node_content等）
      - 向量使用float16存储，节省50%向量存储空间
      - 移除original_text冗余字段（与text字段重复）
    """
    logger.info(f"[LlamaRAG] Starting to index book {book_id}")
    
    # 【2026-01-15 关键修复】确保索引存在且使用正确的映射
    # 必须在写入数据前调用，否则 OpenSearch 会自动推断错误的映射
    await ensure_book_chunks_index()
    
    # 【重要】先删除该书籍的旧索引数据，避免重复
    # 这是幂等操作：无论之前有无数据，都能正确工作
    logger.info(f"[LlamaRAG] Deleting existing index data for book {book_id} before rebuild...")
    await delete_book_index(book_id)
    
    # 延迟导入
    import numpy as np
    import uuid
    from opensearchpy import AsyncOpenSearch
    
    # 获取 embedding 模型
    embed_model = get_embed_model()
    
    # 准备待索引的chunks数据
    chunks_to_index = []
    
    if structured_content and original_format:
        # 【新方案】使用结构化分块，保留 section_index / page
        chunks_with_sections = chunk_text_with_sections(
            structured_content, 
            original_format=original_format
        )
        logger.info(f"[LlamaRAG] Split structured text into {len(chunks_with_sections)} chunks")
        
        for i, chunk_data in enumerate(chunks_with_sections):
            chunk_text_content = chunk_data['text']
            chapter_title = chunk_data.get('chapter_title', '')
            
            # 【元数据注入】构造embedding用的富文本
            prefix_parts = []
            if book_title:
                prefix_parts.append(book_title)
            if chapter_title:
                prefix_parts.append(chapter_title)
            elif original_format == 'pdf':
                page_num = chunk_data.get('page', 1)
                prefix_parts.append(f"第{page_num}页")
            
            if prefix_parts:
                embedding_text = " | ".join(prefix_parts) + " | " + chunk_text_content
            else:
                embedding_text = chunk_text_content
            
            # 【优化 2026-01-15】精简元数据，移除冗余字段
            chunk_info = {
                "embedding_text": embedding_text,  # 用于生成向量
                "text": chunk_text_content,        # 纯正文（用于返回给前端）
                "book_id": book_id,
                "content_sha256": content_sha256,
                "book_title": book_title or "",
                "chapter_title": chapter_title,
                "chunk_index": i,
            }
            
            # 保存章节/页码信息以支持精确跳转
            if original_format == 'epub':
                chunk_info["section_index"] = chunk_data.get('section_index', 0)
                chunk_info["section_filename"] = chunk_data.get('section_filename', '')
            else:  # PDF
                chunk_info["page"] = chunk_data.get('page', 1)
            
            chunks_to_index.append(chunk_info)
    else:
        # 【回退方案】使用旧的纯文本分块
        chunks = chunk_text(text_content)
        logger.info(f"[LlamaRAG] Split text into {len(chunks)} chunks (legacy mode)")
        
        for i, chunk in enumerate(chunks):
            if book_title:
                embedding_text = f"{book_title} | {chunk}"
            else:
                embedding_text = chunk
                
            chunks_to_index.append({
                "embedding_text": embedding_text,
                "text": chunk,
                "book_id": book_id,
                "content_sha256": content_sha256,
                "book_title": book_title or "",
                "chapter_title": "",
                "chunk_index": i,
                "page": None,
            })
    
    # 检查是否有chunks
    if not chunks_to_index:
        logger.warning(f"[LlamaRAG] No chunks generated for book {book_id}")
        return 0
    
    # ================================================================
    # 【优化 2026-01-15】直接写入 OpenSearch，移除 LlamaIndex 冗余
    # ================================================================
    
    BATCH_SIZE = INDEX_NODE_BATCH_SIZE
    total_indexed = 0
    total_batches = (len(chunks_to_index) + BATCH_SIZE - 1) // BATCH_SIZE
    
    logger.info(f"[LlamaRAG] Starting indexing: {len(chunks_to_index)} chunks in {total_batches} batch(es)")
    
    client = AsyncOpenSearch(hosts=[OPENSEARCH_URL], timeout=60)
    
    try:
        for batch_start in range(0, len(chunks_to_index), BATCH_SIZE):
            batch_end = min(batch_start + BATCH_SIZE, len(chunks_to_index))
            batch_chunks = chunks_to_index[batch_start:batch_end]
            batch_num = batch_start // BATCH_SIZE + 1
            
            # 每批处理前检查显存
            if _embed_device == "cuda" and not check_gpu_memory_available():
                logger.warning(f"[LlamaRAG] GPU memory low, clearing cache before batch {batch_num}")
                try:
                    import torch
                    torch.cuda.empty_cache()
                except Exception:
                    pass
            
            logger.info(f"[LlamaRAG] Indexing batch {batch_num}/{total_batches} ({len(batch_chunks)} chunks)")
            
            # 批量生成 embedding
            embedding_texts = [c["embedding_text"] for c in batch_chunks]
            embeddings = embed_model.get_text_embedding_batch(embedding_texts)
            
            # 【2026-01-15 重大优化】向量转换为 int8 (byte 量化)
            # 将 float32 向量转换为 int8，存储空间减少 75%
            # 转换方法：归一化到 [-128, 127] 范围
            embeddings_quantized = []
            for emb in embeddings:
                emb_array = np.array(emb, dtype=np.float32)
                # 归一化向量（L2 norm）
                norm = np.linalg.norm(emb_array)
                if norm > 0:
                    emb_array = emb_array / norm
                # 转换到 int8 范围 [-128, 127]
                # 乘以 127 并四舍五入
                emb_int8 = np.clip(np.round(emb_array * 127), -128, 127).astype(np.int8)
                embeddings_quantized.append(emb_int8.tolist())
            
            # 批量写入 OpenSearch
            bulk_body = []
            for chunk_info, embedding in zip(batch_chunks, embeddings_quantized):
                doc_id = str(uuid.uuid4())
                
                # 【精简存储结构】只存储必要字段
                # 【2026-01-31 修复】将章节标题添加到可搜索的text字段
                # 这确保章节标题也可以被全文搜索匹配到
                searchable_text = chunk_info["text"]
                chapter_title = chunk_info.get("chapter_title", "")
                if chapter_title and chapter_title not in searchable_text:
                    # 将标题作为前缀添加，用分隔符隔开
                    searchable_text = f"【{chapter_title}】{searchable_text}"
                
                doc = {
                    "embedding": embedding,
                    "text": searchable_text,  # 包含章节标题的可搜索文本
                    "metadata": {
                        "book_id": chunk_info["book_id"],
                        "content_sha256": chunk_info["content_sha256"],
                        "book_title": chunk_info["book_title"],
                        "chapter_title": chunk_info["chapter_title"],
                        "chunk_index": chunk_info["chunk_index"],
                    }
                }
                
                # 添加可选字段
                if "section_index" in chunk_info:
                    doc["metadata"]["section_index"] = chunk_info["section_index"]
                if "section_filename" in chunk_info:
                    doc["metadata"]["section_filename"] = chunk_info["section_filename"]
                if "page" in chunk_info and chunk_info["page"] is not None:
                    doc["metadata"]["page"] = chunk_info["page"]
                
                bulk_body.append({"index": {"_index": BOOK_CHUNKS_INDEX, "_id": doc_id}})
                bulk_body.append(doc)
            
            # 执行批量写入
            if bulk_body:
                response = await client.bulk(body=bulk_body, refresh=False)
                if response.get("errors"):
                    error_items = [item for item in response["items"] if "error" in item.get("index", {})]
                    logger.error(f"[LlamaRAG] Bulk indexing errors: {error_items[:3]}")
                else:
                    total_indexed += len(batch_chunks)
            
            # 清理 GPU 缓存
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass
        
        # 最后刷新索引
        await client.indices.refresh(index=BOOK_CHUNKS_INDEX)
        
    finally:
        await client.close()
    
    logger.info(f"[LlamaRAG] Successfully indexed {total_indexed} chunks for book {book_id}")
    return total_indexed


# ============================================================================
# 结构化章节查询
# ============================================================================

import re

def extract_chapter_number(query: str) -> Optional[int]:
    """
    从用户查询中提取章节编号
    
    支持的格式：
    - "第三章" → 3
    - "第3章" → 3
    - "chapter 3" → 3
    - "第一章" → 1
    
    Returns:
        章节编号（1-based），如果没有匹配则返回 None
    """
    # 中文数字映射
    chinese_nums = {
        '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
        '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
        '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15,
        '十六': 16, '十七': 17, '十八': 18, '十九': 19, '二十': 20,
        '二十一': 21, '二十二': 22, '二十三': 23, '二十四': 24, '二十五': 25,
    }
    
    # 匹配 "第X章" 格式（中文数字）
    for cn, num in sorted(chinese_nums.items(), key=lambda x: -len(x[0])):
        if f"第{cn}章" in query:
            return num
    
    # 匹配 "第N章" 格式（阿拉伯数字）
    match = re.search(r'第(\d+)章', query)
    if match:
        return int(match.group(1))
    
    # 匹配 "chapter N" 格式（英文）
    match = re.search(r'chapter\s*(\d+)', query, re.IGNORECASE)
    if match:
        return int(match.group(1))
    
    return None


async def search_by_chapter(
    chapter_num: int,
    content_sha256_list: List[str],
    top_k: int = 10,
) -> List[dict]:
    """
    按章节编号搜索内容
    
    【修复 2026-01-13】改用 metadata.chapter_title 进行匹配
    之前使用 text 字段的 match_phrase 查询，但 text 字段设置了 index: false，导致查询失败
    
    Args:
        chapter_num: 章节编号（1-based）
        content_sha256_list: 书籍SHA256列表
        top_k: 返回结果数量
    
    Returns:
        该章节的内容块列表
    """
    from opensearchpy import AsyncOpenSearch
    
    client = AsyncOpenSearch(hosts=[OPENSEARCH_URL], timeout=30)
    
    try:
        # 构建章节标题的多种可能形式
        chinese_nums = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
                       '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十']
        
        chapter_patterns = []
        if 1 <= chapter_num <= 20:
            chapter_patterns.append(f"第{chinese_nums[chapter_num]}章")
        chapter_patterns.append(f"第{chapter_num}章")
        chapter_patterns.append(f"Chapter {chapter_num}")
        # 添加更多模式
        chapter_patterns.append(f"chapter {chapter_num}")
        chapter_patterns.append(f"CHAPTER {chapter_num}")
        
        logger.info(f"[LlamaRAG] Searching for chapter {chapter_num} with patterns: {chapter_patterns}")
        
        # 【修复】Step 1: 使用 metadata.chapter_title 的 wildcard 查询匹配章节标题
        # 由于 text 字段设置了 index: false，无法使用 match_phrase
        # chapter_title 是 keyword 类型，使用 wildcard 匹配
        should_clauses = []
        for pattern in chapter_patterns:
            should_clauses.append({
                "wildcard": {"metadata.chapter_title": f"*{pattern}*"}
            })
        
        query_body = {
            "size": 50,  # 获取更多结果以找到正确的章节
            "_source": ["metadata.section_index", "metadata.chapter_title", "metadata.chunk_index"],
            "query": {
                "bool": {
                    "should": should_clauses,
                    "minimum_should_match": 1,
                    "filter": [
                        {"terms": {"metadata.content_sha256": content_sha256_list}}
                    ]
                }
            },
            "sort": [
                {"metadata.section_index": "asc"},
                {"metadata.chunk_index": "asc"}
            ]
        }
        
        response = await client.search(index=BOOK_CHUNKS_INDEX, body=query_body)
        
        # 找到该章节的 section_index
        target_section_index = None
        target_chapter_title = None
        for hit in response["hits"]["hits"]:
            meta = hit["_source"].get("metadata", {})
            section_idx = meta.get("section_index")
            chapter_title = meta.get("chapter_title", "")
            
            # 只取第一个匹配的章节（按 section_index 排序）
            if section_idx is not None:
                target_section_index = section_idx
                target_chapter_title = chapter_title
                logger.info(f"[LlamaRAG] Found chapter '{chapter_title}' at section_index={section_idx}")
                break
        
        if target_section_index is None:
            logger.warning(f"[LlamaRAG] Could not find chapter {chapter_num}, returning empty")
            return []
        
        # Step 2: 获取该 section 的所有内容
        section_query = {
            "size": top_k,
            "_source": ["text", "metadata"],
            "query": {
                "bool": {
                    "must": [
                        {"term": {"metadata.section_index": target_section_index}}
                    ],
                    "filter": [
                        {"terms": {"metadata.content_sha256": content_sha256_list}}
                    ]
                }
            },
            "sort": [{"metadata.chunk_index": "asc"}]
        }
        
        section_response = await client.search(index=BOOK_CHUNKS_INDEX, body=section_query)
        
        results = []
        for hit in section_response["hits"]["hits"]:
            src = hit["_source"]
            meta = src.get("metadata", {})
            
            # 【优化 2026-01-15】直接使用text字段（存储的就是纯正文）
            content = src.get("text", "")
            
            results.append({
                "content": content,
                "book_id": meta.get("book_id"),
                "page": meta.get("page"),
                "chapter": meta.get("chapter_title") or f"第{chapter_num}章",
                "section_index": meta.get("section_index"),
                "section_filename": meta.get("section_filename"),
                "chunk_index": meta.get("chunk_index"),
                "score": 1.0  # 精确匹配，给最高分
            })
        
        logger.info(f"[LlamaRAG] Chapter search found {len(results)} chunks for chapter {chapter_num}")
        return results
        
    except Exception as e:
        logger.error(f"[LlamaRAG] Chapter search error: {e}")
        return []
    finally:
        await client.close()


async def search_book_chunks(
    query: str,
    content_sha256_list: List[str],
    top_k: int = 10,
    use_hybrid: bool = True,
    use_rerank: bool = True,
) -> List[dict]:
    """
    在指定书籍中搜索相关内容块
    
    【优化历史】
    - 2026-01-12: 统一使用本地BGE-M3模型，废弃远程SiliconFlow API
      确保索引和搜索使用相同的Embedding模型，避免向量空间不匹配
    - 2026-01-15: 实现混合搜索（向量 + 关键词），提升人名/专有名词搜索效果
    - 2026-01-15: 实现 Reranking 重排序 + 动态结果数量
      1. 初始搜索取 3 倍候选 (30个)
      2. 使用 BGE-Reranker 精排
      3. 按相似度阈值动态过滤，返回高质量结果
    
    架构说明：
    - 向量索引是公共数据，按 content_sha256 匹配
    - 使用本地 BGE-M3 模型将用户问题向量化
    - 混合搜索 = 向量搜索（70%权重）+ 关键词搜索（30%权重）
    - Reranking 使用 SiliconFlow BGE-Reranker API
    - 支持结构化章节查询（如"第三章"）
    
    性能说明：
    - 首次搜索需要加载模型（约2-5s，模型会被缓存）
    - 后续搜索：embedding ~0.1s + k-NN ~0.02s + rerank ~0.3s
    - 支持多人并发（模型是全局单例）
    
    Args:
        query: 用户查询
        content_sha256_list: 要搜索的书籍 SHA256 列表
        top_k: 期望返回的最大结果数量
        use_hybrid: 是否使用混合搜索（向量+关键词），默认True
        use_rerank: 是否使用 Reranking 重排序，默认True
    
    Returns:
        相关内容块列表，每项包含：
        - content: 文本内容
        - book_id: 书籍 ID
        - page: 页码（如果有）
        - score: 相似度分数（Rerank后为 relevance_score）
    """
    import time
    start_time = time.time()
    
    if not content_sha256_list:
        return []
    
    logger.info(f"[LlamaRAG] Searching for: '{query[:50]}...' in {len(content_sha256_list)} books (hybrid={use_hybrid}, rerank={use_rerank})")
    
    # 【新增】Step 0: 检测是否是结构化章节查询
    chapter_num = extract_chapter_number(query)
    if chapter_num:
        logger.info(f"[LlamaRAG] Detected chapter query: chapter {chapter_num}")
        chapter_results = await search_by_chapter(
            chapter_num=chapter_num,
            content_sha256_list=content_sha256_list,
            top_k=top_k
        )
        if chapter_results:
            total_time = time.time() - start_time
            logger.info(f"[LlamaRAG] Chapter search success: {len(chapter_results)} chunks, total: {total_time:.2f}s")
            return chapter_results
        else:
            logger.info(f"[LlamaRAG] Chapter search found nothing, falling back to vector search")
    
    # Step 1: 【优化 2026-01-12】使用本地 Embedding 模型将用户问题向量化
    # 统一使用本地BGE-M3，与索引时保持一致，避免向量空间不匹配
    try:
        embed_start = time.time()
        query_vector = await get_local_embedding(query)
        embed_time = time.time() - embed_start
        logger.info(f"[LlamaRAG] Local embedding: {embed_time:.2f}s")
    except Exception as e:
        logger.error(f"[LlamaRAG] Local embedding failed: {e}")
        return []
    
    # 【2026-01-15 Reranking 优化】
    # 如果启用 Rerank，初始搜索取 3 倍候选用于重排序
    initial_top_k = top_k * 3 if use_rerank else top_k
    
    # Step 2: 【2026-01-15 优化】使用混合搜索或纯向量搜索
    try:
        search_start = time.time()
        
        if use_hybrid:
            # 混合搜索：向量 + 关键词
            results = await opensearch_hybrid_search(
                query_text=query,
                query_vector=query_vector,
                content_sha256_list=content_sha256_list,
                top_k=initial_top_k
            )
            search_type = "hybrid"
        else:
            # 纯向量搜索
            results = await opensearch_knn_search(
                query_vector=query_vector,
                content_sha256_list=content_sha256_list,
                top_k=initial_top_k
            )
            search_type = "knn"
        
        search_time = time.time() - search_start
        logger.info(f"[LlamaRAG] {search_type} search: {search_time:.2f}s, found {len(results)} candidates")
        
        # Step 3: 【2026-01-16 优化】智能Batch Rerank - 行业最佳实践
        # 当候选数量<10时，质量已经足够好，跳过Rerank节省API调用
        if use_rerank and results:
            if len(results) < 10:
                logger.info(f"[LlamaRAG] Rerank skipped: only {len(results)} candidates (< 10), quality sufficient")
                # 截断到top_k
                results = results[:top_k]
            else:
                rerank_start = time.time()
                results = await rerank_results(query, results, top_k)
                rerank_time = time.time() - rerank_start
                logger.info(f"[LlamaRAG] Rerank: {rerank_time:.2f}s, filtered to {len(results)} results")
        
        total_time = time.time() - start_time
        logger.info(f"[LlamaRAG] Total search time: {total_time:.2f}s, final results: {len(results)}")
        return results
        
        total_time = time.time() - start_time
        logger.info(f"[LlamaRAG] Total search time: {total_time:.2f}s, final results: {len(results)}")
        return results
        
    except Exception as e:
        logger.error(f"[LlamaRAG] Search failed: {e}")
        # 【容错】如果混合搜索失败，回退到纯向量搜索
        if use_hybrid:
            logger.warning("[LlamaRAG] Hybrid search failed, falling back to knn search")
            try:
                results = await opensearch_knn_search(
                    query_vector=query_vector,
                    content_sha256_list=content_sha256_list,
                    top_k=initial_top_k
                )
                # 即使回退，也尝试 Rerank
                if use_rerank and results:
                    results = await rerank_results(query, results, top_k)
                return results
            except Exception as e2:
                logger.error(f"[LlamaRAG] Fallback knn search also failed: {e2}")
        return []


# ============================================================================
# Embedding 获取（通过Celery委托给GPU Worker）
# ============================================================================

async def get_embedding_via_celery(text: str, timeout: float = 30.0) -> List[float]:
    """
    通过 Celery 任务获取文本向量（委托给 GPU Worker 执行）
    
    【2026-01-14】架构优化：
    - API容器无GPU，通过Celery任务委托给Worker-GPU执行
    - 保证索引和查询使用完全相同的模型和硬件
    - 向量空间完全一致，搜索结果更准确
    
    Args:
        text: 要向量化的文本
        timeout: 等待任务完成的超时时间（秒）
    
    Returns:
        1024 维浮点数向量
    
    Raises:
        TimeoutError: 任务执行超时
        RuntimeError: 任务执行失败
    """
    import asyncio
    from app.celery_app import celery_app
    
    if not text or not text.strip():
        raise ValueError("Empty text provided for embedding")
    
    logger.info(f"[LlamaRAG] Sending embedding task to GPU Worker ({len(text)} chars)")
    
    # 发送Celery任务到GPU Worker
    task = celery_app.send_task(
        'tasks.get_text_embedding',
        args=[text],
        kwargs={'max_length': 8000},
        queue='gpu_low',
        routing_key='gpu.low',
    )
    
    # 异步等待任务完成
    loop = asyncio.get_event_loop()
    
    def _wait_for_result():
        try:
            result = task.get(timeout=timeout)
            return result
        except Exception as e:
            raise RuntimeError(f"Embedding task failed: {e}")
    
    try:
        embedding = await loop.run_in_executor(None, _wait_for_result)
        
        if embedding is None:
            raise RuntimeError("Embedding task returned None")
        
        logger.info(f"[LlamaRAG] Received embedding from GPU Worker: {len(embedding)} dims")
        return embedding
        
    except asyncio.TimeoutError:
        logger.error(f"[LlamaRAG] Embedding task timeout after {timeout}s")
        raise TimeoutError(f"Embedding task timeout after {timeout}s")


async def get_local_embedding(text: str) -> List[float]:
    """
    获取文本向量（自动选择最佳执行方式）
    
    【2026-01-14】架构重构：
    - 在GPU Worker中：直接本地执行（同进程）
    - 在API容器中：通过Celery委托给GPU Worker
    
    这样保证：
    - 索引和查询使用完全相同的模型
    - API容器不需要GPU也能正常工作
    - 向量空间完全一致
    
    Args:
        text: 要向量化的文本
    
    Returns:
        1024 维浮点数向量
    """
    import os
    import asyncio
    
    # 判断当前运行环境
    # CELERY_QUEUES 环境变量只在 Worker 容器中设置
    is_gpu_worker = os.getenv("CELERY_QUEUES", "").find("gpu") >= 0
    
    if is_gpu_worker:
        # 在GPU Worker中，直接本地执行
        logger.debug("[LlamaRAG] Running in GPU Worker, using local model")
        embed_model = get_embed_model()
        
        loop = asyncio.get_event_loop()
        
        def _embed():
            truncated_text = text[:8000]
            return embed_model.get_text_embedding(truncated_text)
        
        embedding = await loop.run_in_executor(None, _embed)
        logger.debug(f"[LlamaRAG] Local embedding: {len(embedding)} dimensions")
        return embedding
    else:
        # 在API容器中，通过Celery委托给GPU Worker
        logger.info("[LlamaRAG] Running in API container, delegating to GPU Worker via Celery")
        return await get_embedding_via_celery(text)


async def get_remote_embedding(text: str) -> List[float]:
    """
    【已废弃】使用 SiliconFlow Embedding API 获取文本向量
    
    ⚠️ 警告：此函数已废弃，请使用 get_local_embedding()
    保留此函数仅作为回退方案。
    
    问题：
    - 远程API的模型版本可能与本地不同，导致向量空间不一致
    - 需要网络连接，有API调用成本
    
    Args:
        text: 要向量化的文本
    
    Returns:
        1024 维浮点数向量
    """
    import aiohttp
    
    logger.warning("[LlamaRAG] Using deprecated get_remote_embedding(), consider using get_local_embedding()")
    
    api_key = os.getenv("SILICONFLOW_API_KEY")
    if not api_key:
        raise ValueError("SILICONFLOW_API_KEY not configured")
    
    url = "https://api.siliconflow.cn/v1/embeddings"
    
    # 使用 Pro 版 BGE-M3（与索引时使用相同模型，保证向量兼容）
    payload = {
        "model": "Pro/BAAI/bge-m3",
        "input": text[:8000],  # 限制长度，BGE-M3 最大 8192 tokens
        "encoding_format": "float"
    }
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    async with aiohttp.ClientSession() as session:
        async with session.post(url, json=payload, headers=headers, timeout=30) as resp:
            if resp.status != 200:
                error_text = await resp.text()
                raise ValueError(f"Embedding API error {resp.status}: {error_text}")
            
            data = await resp.json()
            embedding = data["data"][0]["embedding"]
            logger.debug(f"[LlamaRAG] Got embedding with {len(embedding)} dimensions")
            return embedding


# 【2026-01-15 新增】相似度阈值配置
# Lucene 引擎的 cosinesimil 返回原始余弦相似度 [-1, 1]
# 设置阈值 0.3 表示只返回余弦相似度 >= 0.3 的结果
MIN_SIMILARITY_SCORE = float(os.getenv("RAG_MIN_SIMILARITY_SCORE", "0.3"))

# 【2026-01-15 新增】Reranking 配置
# Reranker 模型使用 SiliconFlow API
# 【行业最佳实践 2026-01-15】Reranker 只用于重排序，不用于过滤
# 参考 Pinecone: https://www.pinecone.io/learn/series/rag/rerankers/
# 直接使用 top_n 参数取前 N 个结果，无需按分数阈值过滤

# Reranker 超时时间（秒）
RERANK_TIMEOUT = float(os.getenv("RAG_RERANK_TIMEOUT", "10.0"))


async def rerank_results(
    query: str,
    candidates: List[dict],
    top_k: int = 10,
) -> List[dict]:
    """
    使用 Reranker 对搜索结果进行重排序
    
    【2026-01-15 新增】使用 SiliconFlow BGE-Reranker API
    【2026-01-15 修复】遵循行业最佳实践：
    - Reranker 只用于重排序，不用于过滤
    - 直接取 top_n 个结果（由 Reranker API 返回已排序的前 N 个）
    - 参考: https://www.pinecone.io/learn/series/rag/rerankers/
    
    行业标准做法（来自 Pinecone）：
    ```python
    # 向量搜索取 top_k=25 个候选
    top_k_docs = get_docs(query, top_k=25)
    # Reranker 直接返回 top_n=3 个最相关的（不按分数过滤）
    top_n_docs = reranker.rerank(query, docs, top_n=3)
    ```
    
    优势：
    - 更精确的语义相关性评估（Cross-Encoder vs Bi-Encoder）
    - 处理 byte 量化带来的精度损失
    - 提升长尾查询的召回质量
    
    Args:
        query: 用户查询
        candidates: 初始搜索结果（候选文档）
        top_k: 返回的最大结果数量（直接取前 top_k 个，不过滤）
    
    Returns:
        重排序后的结果列表（按相关性降序，取前 top_k 个）
    """
    if not candidates:
        return []
    
    try:
        from .llm_provider import get_reranker
        
        reranker = get_reranker()
        if reranker is None:
            logger.warning("[LlamaRAG] Reranker not available (no API key), skipping rerank")
            return candidates[:top_k]
        
        # 提取文档文本用于重排序
        documents = [c.get("content", "")[:2000] for c in candidates]  # 限制每个文档长度
        
        logger.info(f"[LlamaRAG] Reranking {len(documents)} documents with query: '{query[:30]}...'")
        
        # 调用 Reranker API
        # 【行业最佳实践】直接让 Reranker 返回 top_n 个结果，不自己过滤
        import asyncio
        # 【2026-01-16 修复】使用配置变量而非硬编码
        rerank_results_list = await asyncio.wait_for(
            reranker.rerank(
                query=query,
                documents=documents,
                top_n=top_k,  # 直接取前 top_k 个
                return_documents=False,
            ),
            timeout=RERANK_TIMEOUT  # ✅ 使用配置（默认10秒），而非硬编码5秒
        )
        
        # 按 Reranker 排序结果构建返回列表
        results = []
        for rr in rerank_results_list:
            doc = candidates[rr.index].copy()
            doc["score"] = rr.relevance_score  # 替换为 Reranker 分数
            doc["original_score"] = candidates[rr.index].get("score")  # 保留原始分数
            results.append(doc)
        
        logger.info(f"[LlamaRAG] Rerank complete: {len(candidates)} → {len(results)} (top_k={top_k})")
        return results
        
    except asyncio.TimeoutError:
        logger.warning(f"[LlamaRAG] Rerank timeout after {RERANK_TIMEOUT}s, returning original results")
        return candidates[:top_k]
    except Exception as e:
        logger.error(f"[LlamaRAG] Rerank failed: {e}, returning original results")
        return candidates[:top_k]


def quantize_vector_to_byte(vector: List[float]) -> List[int]:
    """
    将 float32 向量量化为 int8 (byte)
    
    【2026-01-15 新增】用于 Lucene 引擎的 byte 量化搜索
    
    转换方法：
    1. L2 归一化向量
    2. 乘以 127 并四舍五入到 [-128, 127]
    
    Args:
        vector: float32 向量
    
    Returns:
        int8 向量（作为 int 列表）
    """
    import numpy as np
    emb_array = np.array(vector, dtype=np.float32)
    # 归一化向量（L2 norm）
    norm = np.linalg.norm(emb_array)
    if norm > 0:
        emb_array = emb_array / norm
    # 转换到 int8 范围 [-128, 127]
    emb_int8 = np.clip(np.round(emb_array * 127), -128, 127).astype(np.int8)
    return emb_int8.tolist()


async def opensearch_knn_search(
    query_vector: List[float],
    content_sha256_list: List[str],
    top_k: int = 10,
    min_score: float = None,
) -> List[dict]:
    """
    OpenSearch k-NN 向量相似度搜索
    
    【2026-01-15 重大优化】使用 Lucene 引擎 + byte 量化
    - 查询向量自动转换为 int8
    - 使用原生 knn 查询（更高效）
    - 支持相似度阈值过滤
    
    Args:
        query_vector: 用户问题的向量（float32，1024维）
        content_sha256_list: 要搜索的书籍 SHA256 列表，空列表表示搜索全部
        top_k: 返回结果数量
        min_score: 最小相似度分数（余弦相似度 [-1, 1]），默认 0.3
    
    Returns:
        相似内容块列表（已按相似度过滤）
    """
    from opensearchpy import AsyncOpenSearch
    
    if min_score is None:
        min_score = MIN_SIMILARITY_SCORE
    
    # 将查询向量量化为 int8
    query_vector_byte = quantize_vector_to_byte(query_vector)
    
    client = AsyncOpenSearch(hosts=[OPENSEARCH_URL], timeout=30)
    
    try:
        # 构建过滤条件
        filter_clause = []
        if content_sha256_list:
            filter_clause.append({"terms": {"metadata.content_sha256": content_sha256_list}})
        
        # 【2026-01-15】使用 Lucene 原生 knn 查询
        # 这比 script_score 更高效
        query_body = {
            "size": top_k,
            "_source": ["text", "metadata"],
            "query": {
                "knn": {
                    "embedding": {
                        "vector": query_vector_byte,
                        "k": top_k,
                        "filter": {
                            "bool": {
                                "filter": filter_clause
                            }
                        } if filter_clause else None
                    }
                }
            }
        }
        
        # 如果没有过滤条件，移除 filter 字段
        if not filter_clause:
            del query_body["query"]["knn"]["embedding"]["filter"]
        
        response = await client.search(
            index=BOOK_CHUNKS_INDEX,
            body=query_body
        )
        
        results = []
        filtered_count = 0
        
        for hit in response["hits"]["hits"]:
            score = hit["_score"]
            
            # 【2026-01-15】Lucene knn 返回的分数已经是余弦相似度
            # 范围通常在 [0, 1]，但 byte 量化后可能略有偏差
            if score < min_score:
                filtered_count += 1
                continue
            
            src = hit["_source"]
            meta = src.get("metadata", {})
            
            # 【优化 2026-01-15】直接使用text字段（存储的就是纯正文）
            content = src.get("text", "")
            
            results.append({
                "content": content,
                "book_id": meta.get("book_id"),
                "book_title": meta.get("book_title"),
                "page": meta.get("page"),
                "chapter": meta.get("chapter_title"),
                "section_index": meta.get("section_index"),  # EPUB 章节索引，用于精确跳转
                "section_filename": meta.get("section_filename"),  # EPUB 章节文件名
                "chunk_index": meta.get("chunk_index"),  # 【2026-01-31 修复】RRF 融合需要此字段去重
                "score": score,
            })
        
        if filtered_count > 0:
            logger.info(f"[LlamaRAG] Filtered {filtered_count} low-score results (min_score={min_score})")
        
        return results
        
    except Exception as e:
        logger.error(f"[LlamaRAG] OpenSearch k-NN search error: {e}")
        raise
    finally:
        await client.close()


# 【2026-01-15 新增】混合搜索配置
# 向量搜索权重 vs 关键词搜索权重
HYBRID_VECTOR_WEIGHT = float(os.getenv("RAG_HYBRID_VECTOR_WEIGHT", "0.7"))  # 向量搜索权重 70%
HYBRID_KEYWORD_WEIGHT = float(os.getenv("RAG_HYBRID_KEYWORD_WEIGHT", "0.3"))  # 关键词搜索权重 30%


async def opensearch_keyword_search(
    query_text: str,
    content_sha256_list: List[str],
    top_k: int = 10,
) -> List[dict]:
    """
    OpenSearch 关键词搜索（BM25）
    
    用于混合搜索中的关键词部分
    """
    from opensearchpy import AsyncOpenSearch
    
    client = AsyncOpenSearch(hosts=[OPENSEARCH_URL], timeout=30)
    
    try:
        # 构建查询
        filter_clause = []
        if content_sha256_list:
            filter_clause.append({"terms": {"metadata.content_sha256": content_sha256_list}})
        
        query_body = {
            "size": top_k,
            "_source": ["text", "metadata"],
            "query": {
                "bool": {
                    "must": [
                        {"match": {"text": query_text}}
                    ],
                    "filter": filter_clause
                }
            }
        }
        
        response = await client.search(
            index=BOOK_CHUNKS_INDEX,
            body=query_body
        )
        
        results = []
        for hit in response["hits"]["hits"]:
            src = hit["_source"]
            meta = src.get("metadata", {})
            
            results.append({
                "content": src.get("text", ""),
                "book_id": meta.get("book_id"),
                "book_title": meta.get("book_title"),
                "page": meta.get("page"),
                "chapter": meta.get("chapter_title"),
                "section_index": meta.get("section_index"),
                "section_filename": meta.get("section_filename"),
                "chunk_index": meta.get("chunk_index"),  # 【2026-01-31 修复】RRF 融合需要此字段去重
                "score": hit["_score"],
            })
        
        return results
        
    except Exception as e:
        logger.error(f"[LlamaRAG] OpenSearch keyword search error: {e}")
        return []
    finally:
        await client.close()


async def opensearch_hybrid_search(
    query_text: str,
    query_vector: List[float],
    content_sha256_list: List[str],
    top_k: int = 10,
    min_score: float = None,
) -> List[dict]:
    """
    OpenSearch 混合搜索（向量 + 关键词）
    
    【2026-01-15 新增】使用 RRF (Reciprocal Rank Fusion) 算法融合结果
    
    搜索策略：
    1. 分别执行向量搜索和关键词搜索
    2. 使用 RRF 算法融合排名：score = Σ 1/(k + rank)
    3. 按融合分数排序返回 top_k 结果
    
    RRF 的优势：
    - 不依赖原始分数的绝对值
    - 对不同来源的结果有更好的平衡
    - 行业标准的结果融合算法
    
    Args:
        query_text: 用户问题原文（用于关键词搜索）
        query_vector: 用户问题的向量（用于向量搜索）
        content_sha256_list: 要搜索的书籍 SHA256 列表
        top_k: 返回结果数量
        min_score: 最小相似度分数阈值（用于向量搜索过滤）
    
    Returns:
        融合后的相关内容块列表
    """
    if min_score is None:
        min_score = MIN_SIMILARITY_SCORE
    
    # RRF 常数 k，通常设为 60
    RRF_K = 60
    
    try:
        # 1. 并行执行向量搜索和关键词搜索
        import asyncio
        
        vector_task = opensearch_knn_search(
            query_vector=query_vector,
            content_sha256_list=content_sha256_list,
            top_k=top_k * 2,  # 多取一些用于融合
            min_score=min_score
        )
        
        keyword_task = opensearch_keyword_search(
            query_text=query_text,
            content_sha256_list=content_sha256_list,
            top_k=top_k * 2
        )
        
        vector_results, keyword_results = await asyncio.gather(vector_task, keyword_task)
        
        logger.info(f"[LlamaRAG] Hybrid search: vector={len(vector_results)}, keyword={len(keyword_results)}")
        
        # 2. 使用 RRF 算法融合结果
        # 创建一个字典来存储每个文档的 RRF 分数
        rrf_scores = {}  # key: chunk_key, value: {"score": float, "doc": dict}
        
        # 处理向量搜索结果
        for rank, doc in enumerate(vector_results, 1):
            chunk_key = f"{doc.get('book_id')}_{doc.get('section_index')}_{doc.get('chunk_index')}"
            rrf_score = HYBRID_VECTOR_WEIGHT / (RRF_K + rank)
            
            if chunk_key in rrf_scores:
                rrf_scores[chunk_key]["score"] += rrf_score
            else:
                rrf_scores[chunk_key] = {"score": rrf_score, "doc": doc}
        
        # 处理关键词搜索结果
        for rank, doc in enumerate(keyword_results, 1):
            chunk_key = f"{doc.get('book_id')}_{doc.get('section_index')}_{doc.get('chunk_index')}"
            rrf_score = HYBRID_KEYWORD_WEIGHT / (RRF_K + rank)
            
            if chunk_key in rrf_scores:
                rrf_scores[chunk_key]["score"] += rrf_score
            else:
                rrf_scores[chunk_key] = {"score": rrf_score, "doc": doc}
        
        # 3. 按 RRF 分数排序并返回 top_k
        sorted_results = sorted(
            rrf_scores.values(),
            key=lambda x: x["score"],
            reverse=True
        )[:top_k]
        
        results = []
        for item in sorted_results:
            doc = item["doc"]
            doc["score"] = item["score"]  # 使用 RRF 分数
            results.append(doc)
        
        logger.info(f"[LlamaRAG] Hybrid search (RRF) returned {len(results)} results")
        return results
        
    except Exception as e:
        logger.error(f"[LlamaRAG] OpenSearch hybrid search error: {e}")
        raise


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
                    # 【2025-01-16 修复】metadata.book_id 已经是 keyword 类型
                    # 不需要 .keyword 后缀，否则会匹配不到任何文档
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


# ============================================================================
# 书籍向量索引配置（公共数据）
# ============================================================================

async def ensure_book_chunks_index():
    """
    确保书籍向量索引存在，并应用优化配置
    
    【优化配置历史】
    - 2026-01-12: 
      - number_of_replicas: 0（单节点无需副本，节省50%磁盘）
      - text字段: index=false, store=true（只存储不索引，节省空间）
    - 2026-01-15:
      - 【重大优化】使用 Lucene 引擎 + byte 量化
      - 向量存储从 float32 (4字节/维) 压缩到 byte (1字节/维)
      - 向量存储空间减少 75%
      - text字段启用索引，支持向量+关键词混合搜索
      - 总体存储可能更小，同时获得混合搜索能力
    
    如果索引已存在，会尝试更新settings（但mapping不可变）
    """
    from opensearchpy import AsyncOpenSearch
    
    client = AsyncOpenSearch(hosts=[OPENSEARCH_URL])
    try:
        exists = await client.indices.exists(index=BOOK_CHUNKS_INDEX)
        
        if not exists:
            # 【2026-01-15 重大优化】Lucene 引擎 + byte 量化 + 混合搜索
            mapping = {
                "settings": {
                    "index": {
                        "knn": True,
                        "number_of_shards": 1,
                        "number_of_replicas": 0,  # 单节点无需副本
                    },
                },
                "mappings": {
                    "properties": {
                        # 【重大优化】使用 Lucene 引擎 + byte 量化
                        # byte 量化将向量从 float32 (4字节) 压缩到 int8 (1字节)
                        # 存储空间减少 75%，精度损失 < 3%，配合重排序可忽略
                        "embedding": {
                            "type": "knn_vector",
                            "dimension": EMBEDDING_DIM,
                            "data_type": "byte",  # 关键：使用 byte 量化
                            "method": {
                                "name": "hnsw",
                                "engine": "lucene",  # 关键：使用 Lucene 引擎（支持 byte 量化）
                                "space_type": "cosinesimil",
                                "parameters": {
                                    "m": 16,
                                    "ef_construction": 100
                                }
                            }
                        },
                        # 【混合搜索】text字段启用索引
                        "text": {
                            "type": "text",
                            "index": True,   # 启用倒排索引，支持关键词搜索
                            "store": True,   # 存储用于返回给前端
                            "analyzer": "standard",  # 标准分词器
                        },
                        # 元数据字段
                        "metadata": {
                            "properties": {
                                "book_id": {"type": "keyword"},
                                "content_sha256": {"type": "keyword"},
                                "book_title": {"type": "keyword"},
                                "chapter_title": {"type": "keyword"},
                                "chunk_index": {"type": "integer"},
                                "section_index": {"type": "integer"},
                                "section_filename": {"type": "keyword"},
                                "page": {"type": "integer"},
                            }
                        }
                    }
                }
            }
            await client.indices.create(index=BOOK_CHUNKS_INDEX, body=mapping)
            logger.info(f"[LlamaRAG] Created optimized book chunks index with byte quantization: {BOOK_CHUNKS_INDEX}")
            return {"created": True, "optimized": True, "quantization": "byte"}
        else:
            # 索引已存在，尝试更新settings（只有部分设置可动态更新）
            try:
                await client.indices.put_settings(
                    index=BOOK_CHUNKS_INDEX,
                    body={
                        "index": {
                            "number_of_replicas": 0,  # 可动态更新
                        }
                    }
                )
                logger.info(f"[LlamaRAG] Updated book chunks index settings: replicas=0")
                return {"created": False, "settings_updated": True}
            except Exception as e:
                logger.warning(f"[LlamaRAG] Could not update index settings: {e}")
                return {"created": False, "settings_updated": False, "error": str(e)}
    except Exception as e:
        logger.error(f"[LlamaRAG] Failed to ensure book chunks index: {e}")
        return {"error": str(e)}
    finally:
        await client.close()


async def recreate_book_chunks_index():
    """
    删除并重新创建书籍向量索引（用于应用新的mapping配置）
    
    ⚠️ 警告：这会删除所有已索引的书籍向量！
    之后需要重新索引所有书籍。
    """
    from opensearchpy import AsyncOpenSearch
    
    client = AsyncOpenSearch(hosts=[OPENSEARCH_URL])
    try:
        # 删除现有索引
        exists = await client.indices.exists(index=BOOK_CHUNKS_INDEX)
        if exists:
            await client.indices.delete(index=BOOK_CHUNKS_INDEX)
            logger.warning(f"[LlamaRAG] Deleted existing index: {BOOK_CHUNKS_INDEX}")
        
        # 使用优化配置重新创建
        result = await ensure_book_chunks_index()
        logger.info(f"[LlamaRAG] Recreated index with optimized settings: {result}")
        return result
    except Exception as e:
        logger.error(f"[LlamaRAG] Failed to recreate index: {e}")
        return {"error": str(e)}
    finally:
        await client.close()


# ============================================================================
# 用户笔记/高亮向量索引（私人数据 - 必须按 user_id 隔离）
# ============================================================================

async def ensure_user_notes_index():
    """
    确保用户笔记向量索引存在
    索引结构包含 user_id 用于数据隔离
    
    【2026-01-15】架构优化：
    - 使用 Lucene 引擎 + byte 量化（压缩75%）
    - 启用 text 字段索引，支持混合搜索
    """
    from opensearchpy import AsyncOpenSearch
    
    client = AsyncOpenSearch(hosts=[OPENSEARCH_URL])
    try:
        exists = await client.indices.exists(index=USER_NOTES_INDEX)
        if not exists:
            # 【2026-01-15】使用 Lucene 引擎 + byte 量化
            # 与 book_chunks 索引保持一致的架构
            mapping = {
                "settings": {
                    "index": {
                        "knn": True
                    }
                },
                "mappings": {
                    "properties": {
                        "embedding": {
                            "type": "knn_vector",
                            "dimension": EMBEDDING_DIM,
                            "data_type": "byte",  # int8 量化，压缩75%
                            "method": {
                                "name": "hnsw",
                                "space_type": "cosinesimil",
                                "engine": "lucene",  # Lucene 引擎支持 byte
                                "parameters": {
                                    "ef_construction": 128,
                                    "m": 16
                                }
                            }
                        },
                        # 【重要】启用 text 索引，支持 BM25 关键词搜索
                        "text": {
                            "type": "text",
                            "analyzer": "ik_max_word",
                            "index": True  # 启用索引，支持混合搜索
                        },
                        "metadata": {
                            "properties": {
                                "note_id": {"type": "keyword"},
                                "user_id": {"type": "keyword"},  # 关键：隔离键
                                "book_id": {"type": "keyword"},
                                "book_title": {"type": "text", "index": True},
                                "chapter": {"type": "text", "index": True},
                                "page": {"type": "integer"},
                                "note_type": {"type": "keyword"},  # note 或 highlight
                                "created_at": {"type": "date"}
                            }
                        }
                    }
                }
            }
            await client.indices.create(index=USER_NOTES_INDEX, body=mapping)
            logger.info(f"[LlamaRAG] Created user notes index: {USER_NOTES_INDEX} (Lucene + byte)")
    except Exception as e:
        logger.error(f"[LlamaRAG] Failed to create user notes index: {e}")
    finally:
        await client.close()


async def index_user_note(
    note_id: str,
    user_id: str,
    book_id: str,
    content: str,
    book_title: Optional[str] = None,
    chapter: Optional[str] = None,
    page: Optional[int] = None,
    note_type: str = "note",  # note 或 highlight
) -> bool:
    """
    为用户笔记创建向量索引（私人数据）
    
    【2026-01-14】架构优化：
    - 通过Celery任务委托给GPU Worker执行
    - API立即返回，索引在后台异步执行
    - 保证Embedding使用GPU加速
    
    ⚠️ 安全说明：
    - 此索引包含 user_id，搜索时必须按 user_id 过滤
    - 严禁跨用户访问笔记数据
    
    Args:
        note_id: 笔记ID
        user_id: 用户ID（隔离键）
        book_id: 关联书籍ID
        content: 笔记内容
        book_title: 书籍标题
        chapter: 章节
        page: 页码
        note_type: 类型（note 或 highlight）
    
    Returns:
        是否成功发送任务（注意：不是索引是否成功）
    """
    import os
    
    if not content or not content.strip():
        return False
    
    logger.info(f"[LlamaRAG] Queuing user note indexing: {note_id[:8]}... for user {user_id[:8]}...")
    
    # 判断当前运行环境
    is_gpu_worker = os.getenv("CELERY_QUEUES", "").find("gpu") >= 0
    
    if is_gpu_worker:
        # 在GPU Worker中，直接本地执行（同步）
        try:
            await ensure_user_notes_index()
            
            embed_model = get_embed_model()
            truncated_content = content[:2000]
            embedding = embed_model.get_text_embedding(truncated_content)
            
            # 【2026-01-15】向量量化：float32 → int8（Lucene byte 格式）
            byte_embedding = quantize_vector_to_byte(embedding)
            
            from opensearchpy import AsyncOpenSearch
            import time
            
            client = AsyncOpenSearch(hosts=[OPENSEARCH_URL])
            try:
                doc = {
                    "embedding": byte_embedding,  # 使用量化后的 int8 向量
                    "text": content,
                    "metadata": {
                        "note_id": note_id,
                        "user_id": user_id,
                        "book_id": book_id,
                        "book_title": book_title or "",
                        "chapter": chapter or "",
                        "page": page,
                        "note_type": note_type,
                        "created_at": int(time.time() * 1000)
                    }
                }
                
                await client.index(
                    index=USER_NOTES_INDEX,
                    id=note_id,
                    body=doc,
                    refresh=True
                )
                logger.info(f"[LlamaRAG] Indexed user note: {note_id[:8]}... (byte quantized)")
                return True
            finally:
                await client.close()
        except Exception as e:
            logger.error(f"[LlamaRAG] Failed to index user note: {e}")
            return False
    else:
        # 在API容器中，通过Celery任务异步执行
        try:
            from app.celery_app import celery_app
            
            celery_app.send_task(
                'tasks.index_user_note_vectors',
                kwargs={
                    'note_id': note_id,
                    'user_id': user_id,
                    'book_id': book_id,
                    'content': content,
                    'book_title': book_title,
                    'chapter': chapter,
                    'page': page,
                    'note_type': note_type,
                },
                queue='gpu_low',
                routing_key='gpu.low',
            )
            logger.info(f"[LlamaRAG] Queued user note indexing task: {note_id[:8]}...")
            return True  # 任务已发送
        except Exception as e:
            logger.error(f"[LlamaRAG] Failed to queue user note indexing: {e}")
            return False


async def delete_user_note_index(note_id: str) -> bool:
    """删除用户笔记的向量索引"""
    from opensearchpy import AsyncOpenSearch
    
    client = AsyncOpenSearch(hosts=[OPENSEARCH_URL])
    try:
        await client.delete(index=USER_NOTES_INDEX, id=note_id, ignore=[404])
        logger.info(f"[LlamaRAG] Deleted user note index: {note_id[:8]}...")
        return True
    except Exception as e:
        logger.error(f"[LlamaRAG] Failed to delete user note index: {e}")
        return False
    finally:
        await client.close()


async def search_user_notes(
    query: str,
    user_id: str,  # 必须参数！确保数据隔离
    book_ids: Optional[List[str]] = None,
    top_k: int = 5,
    use_hybrid: bool = True,  # 【2026-01-15】默认启用混合搜索
) -> List[dict]:
    """
    搜索用户笔记（私人数据）
    
    【2026-01-15】架构优化：
    - 使用 Lucene knn 查询（适配 byte 量化）
    - 支持混合搜索（向量 + 关键词）
    - 添加相似度阈值过滤
    
    ⚠️ 安全说明：
    - user_id 是必须参数，确保只搜索当前用户的笔记
    - 绝对不能省略 user_id 过滤
    
    Args:
        query: 搜索查询
        user_id: 用户ID（必须）
        book_ids: 限制搜索的书籍ID列表（可选）
        top_k: 返回结果数量
        use_hybrid: 是否使用混合搜索
    
    Returns:
        笔记列表
    """
    if not user_id:
        raise ValueError("user_id is required for searching user notes (security)")
    
    logger.info(f"[LlamaRAG] Searching user notes for user {user_id[:8]}... (hybrid={use_hybrid})")
    
    try:
        # 获取查询向量并量化为 byte 格式
        query_vector = await get_local_embedding(query)
        query_vector_byte = quantize_vector_to_byte(query_vector)
        
        from opensearchpy import AsyncOpenSearch
        client = AsyncOpenSearch(hosts=[OPENSEARCH_URL])
        
        try:
            # 构建过滤条件 - 必须包含 user_id
            base_filter = [
                {"term": {"metadata.user_id": user_id}}  # 关键：安全过滤
            ]
            
            if book_ids:
                base_filter.append({"terms": {"metadata.book_id": book_ids}})
            
            if use_hybrid:
                # 【混合搜索】使用 RRF 算法融合向量和关键词结果
                results = await _search_user_notes_hybrid(
                    client, query, query_vector_byte, base_filter, top_k
                )
            else:
                # 【纯向量搜索】使用 Lucene knn 查询
                results = await _search_user_notes_vector(
                    client, query_vector_byte, base_filter, top_k
                )
            
            # 【2026-01-15】应用相似度阈值过滤
            filtered_results = [
                r for r in results 
                if r.get("score", 0) >= MIN_SIMILARITY_SCORE
            ]
            
            logger.info(f"[LlamaRAG] Found {len(filtered_results)} user notes (filtered from {len(results)})")
            return filtered_results
            
        finally:
            await client.close()
            
    except Exception as e:
        logger.error(f"[LlamaRAG] Failed to search user notes: {e}")
        return []


async def _search_user_notes_vector(
    client,
    query_vector_byte: List[int],
    base_filter: List[dict],
    top_k: int
) -> List[dict]:
    """
    用户笔记纯向量搜索（内部函数）
    使用 Lucene knn 查询格式
    """
    query_body = {
        "size": top_k,
        "_source": ["text", "metadata"],
        "query": {
            "knn": {
                "embedding": {
                    "vector": query_vector_byte,
                    "k": top_k,
                    "filter": {
                        "bool": {
                            "filter": base_filter
                        }
                    }
                }
            }
        }
    }
    
    response = await client.search(
        index=USER_NOTES_INDEX,
        body=query_body
    )
    
    return _parse_user_notes_results(response)


async def _search_user_notes_hybrid(
    client,
    query: str,
    query_vector_byte: List[int],
    base_filter: List[dict],
    top_k: int
) -> List[dict]:
    """
    用户笔记混合搜索（内部函数）
    使用 RRF 算法融合向量和关键词结果
    """
    # 1. 向量搜索
    vector_query = {
        "size": top_k * 2,
        "_source": ["text", "metadata"],
        "query": {
            "knn": {
                "embedding": {
                    "vector": query_vector_byte,
                    "k": top_k * 2,
                    "filter": {
                        "bool": {
                            "filter": base_filter
                        }
                    }
                }
            }
        }
    }
    
    # 2. 关键词搜索（BM25）
    keyword_query = {
        "size": top_k * 2,
        "_source": ["text", "metadata"],
        "query": {
            "bool": {
                "must": [
                    {
                        "multi_match": {
                            "query": query,
                            "fields": ["text^2", "metadata.book_title", "metadata.chapter"],
                            "type": "best_fields"
                        }
                    }
                ],
                "filter": base_filter
            }
        }
    }
    
    # 并行执行两个查询
    import asyncio
    vector_task = client.search(index=USER_NOTES_INDEX, body=vector_query)
    keyword_task = client.search(index=USER_NOTES_INDEX, body=keyword_query)
    
    vector_response, keyword_response = await asyncio.gather(
        vector_task, keyword_task, return_exceptions=True
    )
    
    # 解析结果
    vector_results = []
    keyword_results = []
    
    if not isinstance(vector_response, Exception):
        for i, hit in enumerate(vector_response.get("hits", {}).get("hits", [])):
            vector_results.append({
                "doc_id": hit["_id"],
                "rank": i + 1,
                "score": hit["_score"],
                "source": hit["_source"]
            })
    
    if not isinstance(keyword_response, Exception):
        for i, hit in enumerate(keyword_response.get("hits", {}).get("hits", [])):
            keyword_results.append({
                "doc_id": hit["_id"],
                "rank": i + 1,
                "score": hit["_score"],
                "source": hit["_source"]
            })
    
    # 使用 RRF 算法融合结果
    rrf_scores = {}  # doc_id -> (rrf_score, source, original_score)
    k = 60  # RRF 常数
    
    # 向量结果权重 70%
    for item in vector_results:
        doc_id = item["doc_id"]
        rrf_score = 0.7 / (k + item["rank"])
        if doc_id in rrf_scores:
            rrf_scores[doc_id] = (
                rrf_scores[doc_id][0] + rrf_score,
                item["source"],
                max(rrf_scores[doc_id][2], item["score"])
            )
        else:
            rrf_scores[doc_id] = (rrf_score, item["source"], item["score"])
    
    # 关键词结果权重 30%
    for item in keyword_results:
        doc_id = item["doc_id"]
        rrf_score = 0.3 / (k + item["rank"])
        if doc_id in rrf_scores:
            rrf_scores[doc_id] = (
                rrf_scores[doc_id][0] + rrf_score,
                rrf_scores[doc_id][1],
                max(rrf_scores[doc_id][2], item["score"])
            )
        else:
            rrf_scores[doc_id] = (rrf_score, item["source"], item["score"])
    
    # 按 RRF 分数排序
    sorted_results = sorted(
        rrf_scores.items(),
        key=lambda x: x[1][0],
        reverse=True
    )[:top_k]
    
    # 转换为标准格式
    results = []
    for doc_id, (rrf_score, source, original_score) in sorted_results:
        meta = source.get("metadata", {})
        results.append({
            "content": source.get("text", ""),
            "note_id": meta.get("note_id"),
            "book_id": meta.get("book_id"),
            "book_title": meta.get("book_title"),
            "chapter": meta.get("chapter"),
            "page": meta.get("page"),
            "note_type": meta.get("note_type"),
            "score": original_score  # 使用原始向量相似度分数
        })
    
    return results


def _parse_user_notes_results(response: dict) -> List[dict]:
    """解析用户笔记搜索结果（内部函数）"""
    results = []
    for hit in response.get("hits", {}).get("hits", []):
        src = hit["_source"]
        meta = src.get("metadata", {})
        results.append({
            "content": src.get("text", ""),
            "note_id": meta.get("note_id"),
            "book_id": meta.get("book_id"),
            "book_title": meta.get("book_title"),
            "chapter": meta.get("chapter"),
            "page": meta.get("page"),
            "note_type": meta.get("note_type"),
            "score": hit["_score"]
        })
    return results
