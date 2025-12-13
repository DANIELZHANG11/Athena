#!/usr/bin/env python3
"""
测试 PyMuPDF 文字嵌入与坐标对齐

这个测试创建一个带有已知位置文字的 PDF，然后验证嵌入的透明文字层是否对齐。
"""
import sys
sys.path.insert(0, '/app')

import fitz
import io

def test_coordinate_alignment():
    """测试坐标对齐"""
    print("=" * 60)
    print("测试 PyMuPDF 文字嵌入坐标对齐")
    print("=" * 60)
    
    # 模拟 OCR 结果
    # 假设 OCR 图片尺寸是 1000x1414（类似 A4 的比例）
    ocr_width = 1000
    ocr_height = 1414
    
    # 模拟 PaddleOCR 返回的区域
    # polygon 格式: [[左上x,左上y], [右上x,右上y], [右下x,右下y], [左下x,左下y]]
    mock_ocr_pages = [
        {
            "page_num": 1,
            "width": ocr_width,
            "height": ocr_height,
            "regions": [
                {
                    "text": "测试文字一",
                    "confidence": 0.99,
                    "polygon": [[100, 100], [300, 100], [300, 140], [100, 140]],
                },
                {
                    "text": "第二行文字",
                    "confidence": 0.98,
                    "polygon": [[100, 200], [350, 200], [350, 240], [100, 240]],
                },
                {
                    "text": "English Text",
                    "confidence": 0.97,
                    "polygon": [[100, 300], [400, 300], [400, 340], [100, 340]],
                },
                {
                    "text": "底部测试",
                    "confidence": 0.96,
                    "polygon": [[100, 1300], [280, 1300], [280, 1340], [100, 1340]],
                },
            ]
        }
    ]
    
    # 创建一个空白 PDF 页面
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)  # A4 尺寸
    
    pdf_width = page.rect.width
    pdf_height = page.rect.height
    
    # 计算缩放比例
    scale_x = pdf_width / ocr_width
    scale_y = pdf_height / ocr_height
    
    print(f"\nPDF 尺寸: {pdf_width} x {pdf_height}")
    print(f"OCR 图片尺寸: {ocr_width} x {ocr_height}")
    print(f"缩放比例: scale_x={scale_x:.4f}, scale_y={scale_y:.4f}")
    
    # 遍历并嵌入文字
    for region in mock_ocr_pages[0]["regions"]:
        text = region["text"]
        polygon = region["polygon"]
        
        # 提取多边形顶点
        p0, p1, p2, p3 = polygon[0], polygon[1], polygon[2], polygon[3]
        
        # 缩放到 PDF 坐标（无需 Y 轴翻转）
        pdf_x0, pdf_y0 = p0[0] * scale_x, p0[1] * scale_y
        pdf_x1, pdf_y1 = p1[0] * scale_x, p1[1] * scale_y
        pdf_x2, pdf_y2 = p2[0] * scale_x, p2[1] * scale_y
        pdf_x3, pdf_y3 = p3[0] * scale_x, p3[1] * scale_y
        
        # 计算宽度和高度
        text_width = ((pdf_x1 - pdf_x0) ** 2 + (pdf_y1 - pdf_y0) ** 2) ** 0.5
        text_height = ((pdf_x3 - pdf_x0) ** 2 + (pdf_y3 - pdf_y0) ** 2) ** 0.5
        
        # 计算字体大小
        char_count = len(text)
        cjk_count = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
        eng_count = char_count - cjk_count
        avg_char_width_ratio = (cjk_count * 1.0 + eng_count * 0.5) / max(char_count, 1)
        
        font_size_by_height = text_height * 0.85
        font_size_by_width = text_width / (char_count * avg_char_width_ratio) if avg_char_width_ratio > 0 else font_size_by_height
        font_size = min(font_size_by_height, font_size_by_width)
        font_size = max(4, min(font_size, 72))
        
        # 插入点和基线
        insert_x = pdf_x0
        baseline_y = pdf_y0 + text_height * 0.80
        
        print(f"\n文字: '{text}'")
        print(f"  OCR polygon: {polygon}")
        print(f"  PDF 左上角: ({pdf_x0:.1f}, {pdf_y0:.1f})")
        print(f"  区域尺寸: {text_width:.1f} x {text_height:.1f}")
        print(f"  字体大小: {font_size:.1f}")
        print(f"  基线位置: ({insert_x:.1f}, {baseline_y:.1f})")
        
        # 先画一个矩形框来标记原始区域
        rect = fitz.Rect(pdf_x0, pdf_y0, pdf_x1, pdf_y2)
        page.draw_rect(rect, color=(1, 0, 0), width=0.5)  # 红色边框
        
        # 插入透明文字
        page.insert_text(
            (insert_x, baseline_y),
            text,
            fontsize=font_size,
            fontname="china-s",
            color=(0.2, 0.2, 0.8),  # 蓝色（用于可视化测试）
        )
    
    # 保存 PDF
    pdf_data = doc.tobytes()
    doc.close()
    
    # 保存到文件
    output_path = "/tmp/test_alignment.pdf"
    with open(output_path, "wb") as f:
        f.write(pdf_data)
    
    print(f"\n✅ 测试 PDF 已保存到: {output_path}")
    print("   红色框 = OCR 检测到的文字区域")
    print("   蓝色文字 = 嵌入的透明文字层")
    print("\n请使用 'docker cp athena-api-1:/tmp/test_alignment.pdf .' 复制到本地检查")
    
    # 验证文字可以被提取
    doc2 = fitz.open(stream=pdf_data, filetype="pdf")
    extracted_text = doc2[0].get_text()
    doc2.close()
    
    print(f"\n提取的文字:\n{extracted_text}")
    
    return True

if __name__ == "__main__":
    test_coordinate_alignment()
