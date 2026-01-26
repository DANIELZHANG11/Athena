"""
检查并排队处理所有未OCR、未向量化的书籍

使用方式:
    在 worker-gpu 容器内运行:
    cd /app && python -m scripts.check_and_queue_books

    可选参数:
    --check-only       仅检查，不排队处理
    --queue-ocr        排队需要OCR的书籍
    --queue-vector     排队需要向量索引的书籍  
    --queue-all        排队所有需要处理的书籍
    --delay 5          每个任务之间的延迟秒数（模拟前端用户）

功能:
1. 检查所有书籍的OCR状态和向量索引状态
2. 识别需要OCR的图片型PDF
3. 识别需要向量索引的书籍（包括已完成OCR的PDF和EPUB）
4. 将任务一个一个地排入Celery队列（使用countdown延迟，模拟前端用户）
"""

import argparse
import asyncio
import logging
import sys
from datetime import datetime
from typing import List, Dict, Any

# 添加 app 目录到路径
sys.path.insert(0, "/app")

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("check_queue")

# 数据库连接
DATABASE_URL = "postgresql+asyncpg://athena:athena_dev@pgbouncer:6432/athena"


async def get_all_books_status(engine) -> List[Dict[str, Any]]:
    """获取所有书籍的状态"""
    async with engine.connect() as conn:
        result = await conn.execute(
            text("""
                SELECT 
                    id, 
                    user_id,
                    title, 
                    author,
                    original_format,
                    minio_key,
                    is_digitalized,
                    initial_digitalization_confidence,
                    ocr_status,
                    ocr_requested_at,
                    vector_indexed_at,
                    content_sha256,
                    deleted_at,
                    created_at
                FROM books 
                WHERE deleted_at IS NULL
                ORDER BY created_at ASC
            """)
        )
        
        books = []
        for row in result.fetchall():
            books.append({
                "id": str(row[0]),
                "user_id": str(row[1]),
                "title": row[2],
                "author": row[3],
                "original_format": row[4],
                "minio_key": row[5],
                "is_digitalized": row[6],
                "confidence": float(row[7]) if row[7] else None,
                "ocr_status": row[8],
                "ocr_requested_at": row[9],
                "vector_indexed_at": row[10],
                "content_sha256": row[11],
                "created_at": row[13],
            })
        
        return books


def analyze_book_status(book: Dict[str, Any]) -> Dict[str, Any]:
    """
    分析单本书的处理状态
    
    返回:
        - needs_ocr: bool - 是否需要OCR
        - needs_vector: bool - 是否需要向量索引
        - ocr_reason: str - OCR需求原因
        - vector_reason: str - 向量索引需求原因
    """
    result = {
        "needs_ocr": False,
        "needs_vector": False,
        "ocr_reason": None,
        "vector_reason": None,
        "ready_for_vector": False,  # 是否可以立即建向量索引
    }
    
    fmt = book["original_format"]
    is_digitalized = book["is_digitalized"]
    confidence = book["confidence"]
    ocr_status = book["ocr_status"]
    vector_indexed_at = book["vector_indexed_at"]
    
    # 判断是否是图片型PDF（需要OCR）
    is_image_pdf = False
    if fmt == "pdf":
        # 图片型 PDF: is_digitalized=False 或 confidence < 0.8
        if is_digitalized is False:
            is_image_pdf = True
        elif is_digitalized is True and confidence is not None and confidence < 0.8:
            is_image_pdf = True
    
    # OCR 需求判断
    if is_image_pdf:
        if ocr_status is None:
            result["needs_ocr"] = True
            result["ocr_reason"] = "图片型PDF，未开始OCR"
        elif ocr_status == "pending":
            result["needs_ocr"] = True
            result["ocr_reason"] = "图片型PDF，OCR排队中"
        elif ocr_status == "failed":
            result["needs_ocr"] = True
            result["ocr_reason"] = "图片型PDF，OCR失败需重试"
        elif ocr_status == "processing":
            result["ocr_reason"] = "OCR处理中"
        elif ocr_status == "completed":
            result["ocr_reason"] = "OCR已完成"
            result["ready_for_vector"] = True
    else:
        # 非图片型PDF或EPUB，可以直接建向量索引
        if fmt in ["pdf", "epub"]:
            result["ready_for_vector"] = True
    
    # 向量索引需求判断
    if vector_indexed_at is None:
        if result["ready_for_vector"]:
            result["needs_vector"] = True
            if fmt == "epub":
                result["vector_reason"] = "EPUB，未建立向量索引"
            elif is_image_pdf and ocr_status == "completed":
                result["vector_reason"] = "图片型PDF已完成OCR，未建立向量索引"
            else:
                result["vector_reason"] = "文字型PDF，未建立向量索引"
        elif is_image_pdf and ocr_status != "completed":
            result["vector_reason"] = "等待OCR完成后才能建立向量索引"
        else:
            result["vector_reason"] = "格式不支持或条件不满足"
    else:
        result["vector_reason"] = f"已于 {vector_indexed_at} 建立向量索引"
    
    return result


def print_status_report(books: List[Dict[str, Any]]):
    """打印状态报告"""
    total = len(books)
    needs_ocr = []
    needs_vector = []
    ocr_in_progress = []
    fully_indexed = []
    other = []
    
    for book in books:
        status = analyze_book_status(book)
        book["_status"] = status
        
        if status["needs_ocr"]:
            needs_ocr.append(book)
        elif status["needs_vector"]:
            needs_vector.append(book)
        elif book["vector_indexed_at"] is not None:
            fully_indexed.append(book)
        elif book["ocr_status"] == "processing":
            ocr_in_progress.append(book)
        else:
            other.append(book)
    
    print("\n" + "=" * 70)
    print("📚 书籍处理状态报告")
    print("=" * 70)
    print(f"\n📊 总计: {total} 本书籍")
    print(f"   ✅ 已完成向量索引: {len(fully_indexed)}")
    print(f"   🔄 OCR处理中: {len(ocr_in_progress)}")
    print(f"   ⏳ 需要OCR: {len(needs_ocr)}")
    print(f"   📦 需要向量索引: {len(needs_vector)}")
    print(f"   ❓ 其他: {len(other)}")
    
    if needs_ocr:
        print("\n" + "-" * 70)
        print("⏳ 需要 OCR 的书籍:")
        print("-" * 70)
        for book in needs_ocr:
            print(f"  📕 {book['title'][:40]:<40}")
            print(f"     ID: {book['id']}")
            print(f"     格式: {book['original_format']}, 置信度: {book['confidence']}")
            print(f"     状态: {book['_status']['ocr_reason']}")
    
    if needs_vector:
        print("\n" + "-" * 70)
        print("📦 需要向量索引的书籍:")
        print("-" * 70)
        for book in needs_vector:
            print(f"  📗 {book['title'][:40]:<40}")
            print(f"     ID: {book['id']}")
            print(f"     格式: {book['original_format']}")
            print(f"     原因: {book['_status']['vector_reason']}")
    
    if fully_indexed:
        print("\n" + "-" * 70)
        print("✅ 已完成全部处理的书籍:")
        print("-" * 70)
        for book in fully_indexed:
            print(f"  📘 {book['title'][:50]}")
            print(f"     向量索引: {book['vector_indexed_at']}")
    
    print("\n" + "=" * 70)
    
    return {
        "total": total,
        "needs_ocr": needs_ocr,
        "needs_vector": needs_vector,
        "ocr_in_progress": ocr_in_progress,
        "fully_indexed": fully_indexed,
        "other": other,
    }


def queue_tasks(report: Dict, delay_seconds: int = 5, queue_ocr: bool = True, queue_vector: bool = True):
    """
    将任务排入Celery队列
    
    使用 countdown 参数实现延迟执行，模拟前端用户一个一个上传书籍的行为。
    这样可以避免一次性提交所有任务导致系统过载。
    """
    from app.celery_app import celery_app
    
    queued_ocr = 0
    queued_vector = 0
    current_delay = 0
    
    # 排队OCR任务
    if queue_ocr and report["needs_ocr"]:
        print("\n🚀 正在排队OCR任务...")
        for book in report["needs_ocr"]:
            book_id = book["id"]
            user_id = book["user_id"]
            title = book["title"]
            
            # 使用 countdown 延迟执行
            celery_app.send_task(
                "tasks.process_book_ocr",
                args=[book_id, user_id],
                countdown=current_delay,
            )
            
            queued_ocr += 1
            print(f"   ✓ [{queued_ocr}] {title[:40]} (延迟 {current_delay}s)")
            current_delay += delay_seconds
    
    # 排队向量索引任务
    if queue_vector and report["needs_vector"]:
        print("\n🚀 正在排队向量索引任务...")
        for book in report["needs_vector"]:
            book_id = book["id"]
            title = book["title"]
            
            # 使用 countdown 延迟执行
            celery_app.send_task(
                "tasks.index_book_vectors",
                args=[book_id],
                countdown=current_delay,
            )
            
            queued_vector += 1
            print(f"   ✓ [{queued_vector}] {title[:40]} (延迟 {current_delay}s)")
            current_delay += delay_seconds
    
    print(f"\n📋 任务排队完成:")
    print(f"   OCR任务: {queued_ocr} 个")
    print(f"   向量索引任务: {queued_vector} 个")
    print(f"   总预计时间: {current_delay}s (不含实际处理时间)")
    
    return queued_ocr, queued_vector


async def verify_opensearch_vectors():
    """验证OpenSearch中的向量数据"""
    try:
        from opensearchpy import AsyncOpenSearch
        
        client = AsyncOpenSearch(hosts=["http://opensearch:9200"])
        
        try:
            # 检查索引是否存在
            exists = await client.indices.exists(index="athena_book_chunks")
            if not exists:
                print("\n⚠️ OpenSearch 索引 'athena_book_chunks' 不存在")
                return
            
            # 获取文档总数
            count_resp = await client.count(index="athena_book_chunks")
            total_chunks = count_resp.get("count", 0)
            
            # 获取每本书的块数
            agg_resp = await client.search(
                index="athena_book_chunks",
                body={
                    "size": 0,
                    "aggs": {
                        "books": {
                            "terms": {
                                "field": "metadata.book_id.keyword",
                                "size": 100,
                            }
                        }
                    }
                }
            )
            
            book_stats = {}
            for bucket in agg_resp["aggregations"]["books"]["buckets"]:
                book_stats[bucket["key"]] = bucket["doc_count"]
            
            print("\n" + "-" * 70)
            print("🔍 OpenSearch 向量索引验证:")
            print("-" * 70)
            print(f"   总文档数: {total_chunks}")
            print(f"   已索引书籍数: {len(book_stats)}")
            
            if book_stats:
                print("   各书籍索引块数:")
                for book_id, count in sorted(book_stats.items(), key=lambda x: x[1], reverse=True):
                    print(f"     - {book_id[:8]}...: {count} chunks")
            
        finally:
            await client.close()
            
    except Exception as e:
        print(f"\n⚠️ OpenSearch 验证失败: {e}")


async def main():
    parser = argparse.ArgumentParser(description="检查并排队处理所有未OCR、未向量化的书籍")
    parser.add_argument("--check-only", action="store_true", help="仅检查，不排队处理")
    parser.add_argument("--queue-ocr", action="store_true", help="排队需要OCR的书籍")
    parser.add_argument("--queue-vector", action="store_true", help="排队需要向量索引的书籍")
    parser.add_argument("--queue-all", action="store_true", help="排队所有需要处理的书籍")
    parser.add_argument("--delay", type=int, default=5, help="每个任务之间的延迟秒数（默认5秒）")
    parser.add_argument("--verify", action="store_true", help="验证OpenSearch中的向量数据")
    
    args = parser.parse_args()
    
    start_time = datetime.now()
    logger.info("=" * 60)
    logger.info("[Check] 开始检查书籍处理状态")
    logger.info("=" * 60)
    
    # 创建数据库引擎
    engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
    
    try:
        # 获取所有书籍状态
        logger.info("\n[Step 1] 获取所有书籍状态...")
        books = await get_all_books_status(engine)
        logger.info(f"[Check] 找到 {len(books)} 本书籍")
        
        # 打印状态报告
        report = print_status_report(books)
        
        # 验证OpenSearch
        if args.verify:
            await verify_opensearch_vectors()
        
        # 排队任务
        if args.check_only:
            print("\n📝 仅检查模式，不排队任务")
        elif args.queue_all:
            queue_tasks(report, args.delay, queue_ocr=True, queue_vector=True)
        elif args.queue_ocr or args.queue_vector:
            queue_tasks(report, args.delay, queue_ocr=args.queue_ocr, queue_vector=args.queue_vector)
        else:
            print("\n💡 提示: 使用以下参数排队任务:")
            print("   --queue-ocr     排队需要OCR的书籍")
            print("   --queue-vector  排队需要向量索引的书籍")
            print("   --queue-all     排队所有需要处理的书籍")
            print("   --delay N       每个任务之间延迟N秒（默认5秒）")
            print("   --verify        验证OpenSearch中的向量数据")
        
        # 打印总结
        duration = (datetime.now() - start_time).total_seconds()
        print(f"\n⏱️ 检查耗时: {duration:.1f}s")
        
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
