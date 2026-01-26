"""临时脚本：检查书籍和向量索引状态 - 完整统计表"""
import psycopg2
from opensearchpy import OpenSearch

conn = psycopg2.connect('postgresql://athena:athena_dev@pgbouncer:6432/athena')
cur = conn.cursor()

# 获取所有书籍
cur.execute("SELECT id, title, author, minio_key, size FROM books ORDER BY title")
books = cur.fetchall()

os_client = OpenSearch(['http://opensearch:9200'])

# 获取向量索引总体统计
index_stats = os_client.indices.stats(index='athena_book_chunks')
total_docs = index_stats['indices']['athena_book_chunks']['primaries']['docs']['count']
total_size_bytes = index_stats['indices']['athena_book_chunks']['primaries']['store']['size_in_bytes']

print("=" * 100)
print("雅典娜书籍与向量索引统计表")
print("=" * 100)
print(f"{'书名':<40} | {'作者':<15} | {'文件大小':>10} | {'Chunks':>8} | {'向量占比':>8}")
print("-" * 100)

total_file_size = 0
total_chunks = 0
book_stats = []

for book in books:
    book_id, title, author, minio_key, file_size = book
    
    # 查询该书的向量数量
    try:
        response = os_client.count(
            index='athena_book_chunks',
            body={'query': {'term': {'metadata.book_id': str(book_id)}}}
        )
        chunk_count = response['count']
    except Exception as e:
        chunk_count = 0
    
    file_size = file_size or 0
    total_file_size += file_size
    total_chunks += chunk_count
    
    # 截断长标题
    display_title = title[:38] + ".." if len(title) > 40 else title
    display_author = (author or "未知")[:13] + ".." if len(author or "") > 15 else (author or "未知")
    
    file_size_mb = f"{file_size/1024/1024:.2f} MB"
    chunk_percent = f"{chunk_count/total_docs*100:.1f}%" if total_docs > 0 else "0%"
    
    print(f"{display_title:<40} | {display_author:<15} | {file_size_mb:>10} | {chunk_count:>8} | {chunk_percent:>8}")
    
    book_stats.append({
        'title': title,
        'author': author,
        'file_size': file_size,
        'chunks': chunk_count
    })

print("-" * 100)
print(f"{'总计':<40} | {'':<15} | {total_file_size/1024/1024:.2f} MB | {total_chunks:>8} | 100.0%")
print("=" * 100)
print(f"\n向量索引存储统计:")
print(f"  - 索引名: athena_book_chunks")
print(f"  - 文档总数: {total_docs}")
print(f"  - 索引大小: {total_size_bytes/1024/1024:.2f} MB")
print(f"  - 平均每chunk: {total_size_bytes/total_docs:.0f} bytes" if total_docs > 0 else "")

cur.close()
conn.close()
