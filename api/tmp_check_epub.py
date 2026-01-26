"""检查EPUB章节结构"""
import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup
import io
import boto3

# 下载EPUB
s3 = boto3.client('s3', 
    endpoint_url='http://minio:9000',
    aws_access_key_id='athena',
    aws_secret_access_key='athena_dev_key'
)
minio_key = 'users/4504335b-c5d4-4b89-90ce-104e996cf2d9/0ee9e953-e03c-4539-ad95-09335289761a/converted/1843f377-5dea-4c58-a55d-12f838582009.epub'
response = s3.get_object(Bucket='athena-books', Key=minio_key)
epub_data = response['Body'].read()

book = epub.read_epub(io.BytesIO(epub_data))
html_items = [item for item in book.get_items() if item.get_type() == ebooklib.ITEM_DOCUMENT]

print(f'Total HTML items: {len(html_items)}')
print('\n' + '='*60)

for item in html_items:
    content = item.get_content().decode('utf-8', errors='ignore')
    soup = BeautifulSoup(content, 'html.parser')
    
    # 移除head后查找
    if soup.head:
        soup.head.decompose()
    
    h1 = soup.find('h1')
    h2 = soup.find('h2')
    h3 = soup.find('h3')
    p_class = soup.find('p', class_=True)
    
    heading_text = None
    if h1:
        heading_text = f"h1: {h1.get_text(strip=True)[:60]}"
    elif h2:
        heading_text = f"h2: {h2.get_text(strip=True)[:60]}"
    elif h3:
        heading_text = f"h3: {h3.get_text(strip=True)[:60]}"
    elif p_class:
        heading_text = f"p.{p_class.get('class')}: {p_class.get_text(strip=True)[:60]}"
    
    print(f'{item.get_name()}: {heading_text or "NO HEADING"}')
