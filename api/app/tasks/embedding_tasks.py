"""
Embedding 向量化 Celery 任务

【2026-01-14】架构优化：
- 将Embedding计算从API容器迁移到Worker-GPU容器
- API容器无GPU，通过Celery任务委托给Worker-GPU执行
- 保证索引和查询使用完全相同的模型和硬件

队列：gpu_low（与书籍索引任务同优先级）

任务类型：
- get_text_embedding: 单文本向量化（用户提问、笔记等）
- get_batch_embeddings: 批量文本向量化（未来优化）
"""

import logging
from typing import List, Optional

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(
    name="tasks.get_text_embedding",
    bind=True,
    max_retries=3,
    default_retry_delay=5,
    autoretry_for=(Exception,),
    retry_backoff=True,
)
def get_text_embedding(self, text: str, max_length: int = 8000) -> Optional[List[float]]:
    """
    获取文本的向量表示（在GPU Worker中执行）
    
    【关键】此任务在 worker-gpu 容器中执行，使用GPU加速
    
    Args:
        text: 要向量化的文本
        max_length: 最大文本长度，默认8000字符
    
    Returns:
        1024维浮点数向量列表，失败返回None
    """
    if not text or not text.strip():
        logger.warning("[EmbeddingTask] Empty text provided")
        return None
    
    try:
        # 延迟导入，避免在API容器中加载模型
        from app.services.llama_rag import get_embed_model
        
        # 获取模型（单例，会被缓存）
        embed_model = get_embed_model()
        
        # 截断文本
        truncated_text = text[:max_length]
        
        # 执行向量化
        embedding = embed_model.get_text_embedding(truncated_text)
        
        logger.info(f"[EmbeddingTask] Generated embedding: {len(embedding)} dims for text ({len(truncated_text)} chars)")
        return embedding
        
    except Exception as e:
        logger.error(f"[EmbeddingTask] Failed to generate embedding: {e}")
        raise  # 让Celery处理重试


@shared_task(
    name="tasks.get_batch_embeddings",
    bind=True,
    max_retries=2,
    default_retry_delay=10,
)
def get_batch_embeddings(self, texts: List[str], max_length: int = 8000) -> Optional[List[List[float]]]:
    """
    批量获取文本向量（在GPU Worker中执行）
    
    用于需要同时向量化多个文本的场景（如批量索引用户笔记）
    
    Args:
        texts: 文本列表
        max_length: 每个文本的最大长度
    
    Returns:
        向量列表，每个向量1024维
    """
    if not texts:
        return []
    
    try:
        from app.services.llama_rag import get_embed_model
        
        embed_model = get_embed_model()
        
        # 截断所有文本
        truncated_texts = [t[:max_length] for t in texts]
        
        # 批量向量化
        embeddings = embed_model.get_text_embedding_batch(truncated_texts)
        
        logger.info(f"[EmbeddingTask] Generated {len(embeddings)} batch embeddings")
        return embeddings
        
    except Exception as e:
        logger.error(f"[EmbeddingTask] Batch embedding failed: {e}")
        raise


@shared_task(
    name="tasks.index_user_note_vectors",
    bind=True,
    max_retries=3,
    default_retry_delay=5,
)
def index_user_note_vectors(
    self,
    note_id: str,
    user_id: str,
    book_id: str,
    content: str,
    book_title: Optional[str] = None,
    chapter: Optional[str] = None,
    page: Optional[int] = None,
    note_type: str = "note",
) -> bool:
    """
    为用户笔记创建向量索引（在GPU Worker中执行）
    
    【关键】此任务在 worker-gpu 容器中执行
    - 使用本地BGE-M3模型生成向量
    - 存储到OpenSearch用户笔记索引
    
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
        是否成功
    """
    import asyncio
    
    async def _index():
        from app.services.llama_rag import (
            ensure_user_notes_index,
            get_embed_model,
            quantize_vector_to_byte,  # 【2026-01-15】添加向量量化
            USER_NOTES_INDEX,
            OPENSEARCH_URL,
        )
        from opensearchpy import AsyncOpenSearch
        import time
        
        if not content or not content.strip():
            logger.warning(f"[EmbeddingTask] Empty content for note {note_id[:8]}...")
            return False
        
        logger.info(f"[EmbeddingTask] Indexing user note: {note_id[:8]}... for user {user_id[:8]}...")
        
        try:
            # 确保索引存在
            await ensure_user_notes_index()
            
            # 使用本地模型生成向量
            embed_model = get_embed_model()
            truncated_content = content[:2000]  # 笔记通常较短
            embedding = embed_model.get_text_embedding(truncated_content)
            
            # 【2026-01-15】向量量化：float32 → int8（Lucene byte 格式）
            byte_embedding = quantize_vector_to_byte(embedding)
            
            # 存储到OpenSearch
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
                logger.info(f"[EmbeddingTask] Successfully indexed user note: {note_id[:8]}... (byte quantized)")
                return True
            finally:
                await client.close()
                
        except Exception as e:
            logger.error(f"[EmbeddingTask] Failed to index user note: {e}")
            return False
    
    # 运行异步函数
    return asyncio.run(_index())
