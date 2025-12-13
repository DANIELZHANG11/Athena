#!/usr/bin/env python3
"""验证 PyMuPDF 坐标系"""
import fitz

# 创建一个测试PDF
doc = fitz.open()
page = doc.new_page(width=595, height=842)

print(f'Page rect: {page.rect}')
print(f'Page origin: ({page.rect.x0}, {page.rect.y0})')
print(f'Page dimensions: {page.rect.width} x {page.rect.height}')

# 在不同位置插入文字
page.insert_text((50, 50), 'Y=50 (top?)', fontsize=20, fontname='helv')
page.insert_text((50, 421), 'Y=421 (middle)', fontsize=20, fontname='helv')
page.insert_text((50, 800), 'Y=800 (bottom?)', fontsize=20, fontname='helv')

# 保存并查看
pdf_data = doc.tobytes()
doc.close()

# 重新打开获取文字位置
doc2 = fitz.open(stream=pdf_data, filetype='pdf')
page2 = doc2[0]

# 获取所有文字块
blocks = page2.get_text('dict')['blocks']
for block in blocks:
    if block.get('type') == 0:  # text block
        for line in block.get('lines', []):
            for span in line.get('spans', []):
                bbox = span['bbox']
                print(f"Text: '{span['text']}' at y={bbox[1]:.1f}")

doc2.close()

print('\n结论:')
print('  - PyMuPDF 坐标系原点在左上角')
print('  - Y=0 在页面顶部, Y 增加向下')
print('  - 这与 OCR 坐标系相同，不需要 Y 轴翻转!')
