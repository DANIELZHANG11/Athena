"""
OCRmyPDF PaddleOCR Plugin

【已废弃 - 2025-01-26】
此模块已被 ocrmypdf_paddleocr_service.py 取代。

新方案使用官方 OCRmyPDF + 社区 PaddleOCR 插件：
- https://github.com/ocrmypdf/OCRmyPDF
- https://github.com/clefru/ocrmypdf-paddleocr

优势：
- 使用标准 hOCR 格式，文字对齐精确
- 支持 return_word_box=True 获取单词级边界框
- 使用 OCRmyPDF 的 hocrtransform 生成透明文字层
- 代码简洁，维护成本低

---------- 以下为旧代码，保留供参考 ----------

参照 OCRmyPDF-EasyOCR 的实现模式，创建 PaddleOCR 插件。
使用 PaddleOCR 的精确多边形坐标生成双层 PDF。

关键特性：
- 使用 pikepdf 直接生成文字层 PDF（与 OCRmyPDF-EasyOCR 相同的方法）
- PaddleOCR 的多边形坐标 (polygon) 提供精确的文字位置
- 透明文字层（Rendering Mode 3）完美覆盖原图
- 支持旋转文本（使用文字矩阵 Tm）

【2025-01-XX 精确对齐优化】
核心改进：使用逐字符定位替代整行均匀拉伸
- 原问题：整行使用 Tz 均匀拉伸，但中文字符间距不均匀
- 解决方案：为每个字符单独设置 Tm 定位矩阵
- 字符宽度计算：行框宽度 / 字符数 = 每个字符的槽位宽度
- 每个字符在其槽位中心定位，并使用 Tz 拉伸到槽位宽度
"""

import logging
import os
from math import atan2, cos, hypot, sin
from pathlib import Path
from typing import Iterable, NamedTuple

from pikepdf import (
    ContentStreamInstruction,
    Dictionary,
    Name,
    Operator,
    Pdf,
    unparse_content_stream,
)
from PIL import Image

log = logging.getLogger(__name__)

# 字符宽高比（用于水平拉伸计算）
# 中文字符近似方形，aspect ≈ 1.0
# 但 GlyphlessFont 的字形宽度不是 1em，需要调整因子
# 【优化 2025-01-XX】根据实际测试调整为 1.0（方形字符）
CHAR_ASPECT = 1.0


class PaddleOCRResult(NamedTuple):
    """PaddleOCR 识别结果"""
    polygon: list  # 四边形坐标 [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
    text: str
    confidence: float


def paddle_result_to_quad(region: dict) -> PaddleOCRResult:
    """
    将 PaddleOCR 的 region 转换为标准格式
    
    PaddleOCR 输出格式:
    {
        "text": "文本内容",
        "confidence": 0.95,
        "polygon": [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]  # 左上、右上、右下、左下
    }
    """
    polygon = region.get("polygon", [])
    if not polygon or len(polygon) < 4:
        # 如果没有 polygon，尝试从 bbox 生成
        bbox = region.get("bbox") or region.get("box")
        if bbox:
            if isinstance(bbox[0], list):
                x1, y1 = bbox[0]
                x2, y2 = bbox[2]
            else:
                x1, y1, x2, y2 = bbox[:4]
            polygon = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
    
    # 展平为一维列表 [x1, y1, x2, y2, x3, y3, x4, y4]
    quad = []
    for point in polygon[:4]:  # 只取前4个点
        quad.extend(point[:2])  # 只取 x, y
    
    return PaddleOCRResult(
        polygon=quad,
        text=region.get("text", ""),
        confidence=region.get("confidence", 1.0)
    )


def pt_from_pixel(polygon, scale, height):
    """
    将像素坐标转换为 PDF 点坐标
    
    Args:
        polygon: 一维列表 [x1, y1, x2, y2, x3, y3, x4, y4]
        scale: (scale_x, scale_y) 缩放比例
        height: 图片高度（用于 Y 轴翻转）
    
    Returns:
        PDF 点坐标列表 [x1, y1, x2, y2, x3, y3, x4, y4]
    """
    point_pairs = [
        (x * scale[0], (height - y) * scale[1]) 
        for x, y in zip(polygon[0::2], polygon[1::2])
    ]
    return [elm for pt in point_pairs for elm in pt]


def bbox_string(bbox):
    """格式化边界框坐标为字符串"""
    return ", ".join(f"{elm:.0f}" for elm in bbox)


class ContentStreamBuilder:
    """PDF 内容流构建器（与 OCRmyPDF-EasyOCR 相同）"""
    
    def __init__(self, instructions=None):
        self._instructions = instructions or []

    def q(self):
        """保存图形状态"""
        inst = [ContentStreamInstruction([], Operator("q"))]
        return ContentStreamBuilder(self._instructions + inst)

    def Q(self):
        """恢复图形状态"""
        inst = [ContentStreamInstruction([], Operator("Q"))]
        return ContentStreamBuilder(self._instructions + inst)

    def BT(self):
        """开始文本对象"""
        inst = [ContentStreamInstruction([], Operator("BT"))]
        return ContentStreamBuilder(self._instructions + inst)

    def ET(self):
        """结束文本对象"""
        inst = [ContentStreamInstruction([], Operator("ET"))]
        return ContentStreamBuilder(self._instructions + inst)

    def BDC(self, mctype: Name, mcid: int):
        """开始标记内容序列"""
        inst = [
            ContentStreamInstruction([mctype, Dictionary(MCID=mcid)], Operator("BDC"))
        ]
        return ContentStreamBuilder(self._instructions + inst)

    def EMC(self):
        """结束标记内容序列"""
        inst = [ContentStreamInstruction([], Operator("EMC"))]
        return ContentStreamBuilder(self._instructions + inst)

    def Tf(self, font: Name, size: float):
        """设置文本字体和大小"""
        inst = [ContentStreamInstruction([font, size], Operator("Tf"))]
        return ContentStreamBuilder(self._instructions + inst)

    def Tm(self, a: float, b: float, c: float, d: float, e: float, f: float):
        """设置文本矩阵（用于定位和旋转文字）"""
        inst = [ContentStreamInstruction([a, b, c, d, e, f], Operator("Tm"))]
        return ContentStreamBuilder(self._instructions + inst)

    def Tr(self, mode: int):
        """设置文本渲染模式 (3 = 不可见/透明)"""
        inst = [ContentStreamInstruction([mode], Operator("Tr"))]
        return ContentStreamBuilder(self._instructions + inst)

    def Tz(self, scale: float):
        """设置文本水平缩放"""
        inst = [ContentStreamInstruction([scale], Operator("Tz"))]
        return ContentStreamBuilder(self._instructions + inst)

    def TJ(self, text):
        """显示文本"""
        inst = [ContentStreamInstruction([[text.encode("utf-16be")]], Operator("TJ"))]
        return ContentStreamBuilder(self._instructions + inst)

    def build(self):
        return self._instructions

    def add(self, other):
        return ContentStreamBuilder(self._instructions + other._instructions)


def generate_text_content_stream(
    results: Iterable[PaddleOCRResult],
    scale: tuple[float, float],
    height: int,
):
    """
    生成 PDF 文本内容流（精确逐字符定位版本）
    
    【2025-01-XX 重大优化】
    原算法问题：
    - 对整行使用均匀 Tz 拉伸，假设每个字符占用相同宽度
    - 但实际上 OCR 返回的是整行边界框，不知道每个字符的实际位置
    - 结果：文本层字符间距均匀，但图片层字符间距不均匀，导致不对齐
    
    新算法原理：
    - 每个字符单独定位，使用 Tm 矩阵设置其起始位置
    - 字符位置 = 行起点 + (字符索引 * 字符槽位宽度)
    - 字符槽位宽度 = 行宽 / 字符数
    - 每个字符独立使用 Tz 拉伸以填满其槽位
    
    这样即使 OCR 没有提供逐字符坐标，也能通过均匀分配空间来改善对齐。
    虽然不是100%完美（因为实际字符宽度可能不均匀），但比原方案好很多。
    
    Args:
        results: PaddleOCR 识别结果列表
        scale: (scale_x, scale_y) 缩放比例
        height: 图片高度
    
    Returns:
        PDF 内容流指令列表
    """
    cs = ContentStreamBuilder()
    cs = cs.add(cs.q())
    
    for n, result in enumerate(results):
        if not result.text:
            continue
        
        text = result.text
        char_count = len(text)
        
        if char_count == 0:
            continue
        
        log.debug(f"Textline '{text}' in-image bbox: {bbox_string(result.polygon)}")
        
        # 转换为 PDF 坐标（Y轴翻转）
        bbox = pt_from_pixel(result.polygon, scale, height)
        
        # 计算文字角度（基于底边）
        # bbox 格式: [x1, y1, x2, y2, x3, y3, x4, y4] = [左上, 右上, 右下, 左下]
        # 底边: 点3(右下) 到 点4(左下)
        angle = -atan2(bbox[5] - bbox[7], bbox[4] - bbox[6])
        if abs(angle) < 0.01:  # 小于 0.57 度，视为水平
            angle = 0.0
        cos_a, sin_a = cos(angle), sin(angle)
        
        # 计算字体大小（基于左边的高度）
        # 左边: 点1(左上) 到 点4(左下)
        font_size = hypot(bbox[0] - bbox[6], bbox[1] - bbox[7])
        
        if font_size == 0:
            continue
        
        log.debug(f"Textline '{text}' PDF bbox: {bbox_string(bbox)}")
        
        # 计算文字框宽度（底边长度）
        box_width = hypot(bbox[4] - bbox[6], bbox[5] - bbox[7])
        
        if box_width == 0:
            continue
        
        # 计算每个字符的槽位宽度
        char_slot_width = box_width / char_count
        
        # 起始位置（左下角）
        start_x, start_y = bbox[6], bbox[7]
        
        # 【核心改进】逐字符定位
        # 每个字符使用独立的 BT...ET 块，精确设置其位置
        for char_idx, char in enumerate(text):
            # 计算当前字符的 X 偏移（沿旋转后的方向）
            char_offset = char_idx * char_slot_width
            
            # 应用旋转计算实际位置
            char_x = start_x + char_offset * cos_a
            char_y = start_y + char_offset * (-sin_a)  # 注意负号，因为 PDF Y 轴向上
            
            # 计算水平拉伸比例
            # GlyphlessFont 的字形宽度约为字体大小的一半
            # 我们需要将其拉伸到 char_slot_width
            # h_stretch = (目标宽度 / 实际宽度) * 100
            # 实际宽度 ≈ font_size / 2（GlyphlessFont 特性）
            # 所以: h_stretch = char_slot_width / (font_size / 2) * 100
            #                 = 200 * char_slot_width / font_size
            # 但这个公式不准确，需要考虑 CHAR_ASPECT
            h_stretch = 100.0 * char_slot_width / font_size * CHAR_ASPECT * 2
            
            # 限制拉伸比例在合理范围内
            h_stretch = max(10.0, min(500.0, h_stretch))
            
            # 构建单字符文本对象
            cs = cs.add(
                ContentStreamBuilder()
                .BT()
                .BDC(Name.Span, n * 1000 + char_idx)  # 唯一标记 ID
                .Tr(3)  # 透明模式
                .Tm(cos_a, -sin_a, sin_a, cos_a, char_x, char_y)  # 字符位置和旋转
                .Tf(Name("/f-0-0"), font_size)
                .Tz(h_stretch)  # 水平拉伸
                .TJ(char)  # 单个字符
                .EMC()
                .ET()
            )
    
    cs = cs.Q()
    return cs.build()


def paddle_to_pdf(
    image_filename: Path,
    image_scale: float,
    regions: list,
    output_pdf: Path,
):
    """
    使用 PaddleOCR 结果生成文字层 PDF（完全参照 OCRmyPDF-EasyOCR）
    
    Args:
        image_filename: 原始图片路径
        image_scale: 图片缩放比例（1.0 = 原始大小）
        regions: PaddleOCR 识别结果列表（dict 格式）
        output_pdf: 输出 PDF 路径
    
    Returns:
        output_pdf
    """
    # 转换为标准格式
    results = [paddle_result_to_quad(r) for r in regions]
    
    # 获取图片尺寸和 DPI
    with Image.open(image_filename) as im:
        dpi = im.info.get("dpi", (72, 72))
        scale = 72.0 / dpi[0] / image_scale, 72.0 / dpi[1] / image_scale
        width = im.width
        height = im.height
    
    # 创建 PDF
    with Pdf.new() as pdf:
        # 创建空白页
        pdf.add_blank_page(page_size=(width * scale[0], height * scale[1]))
        
        # 注册 GlyphLessFont（无字形字体，用于透明文字层）
        from .glyphless_font import register_glyphlessfont
        pdf.pages[0].Resources = Dictionary(
            Font=Dictionary({"/f-0-0": register_glyphlessfont(pdf)})
        )
        
        # 生成文本内容流
        cs = generate_text_content_stream(results, scale, height)
        pdf.pages[0].Contents = pdf.make_stream(unparse_content_stream(cs))
        
        pdf.save(output_pdf)
    
    return output_pdf


def create_layered_pdf_with_paddle(pdf_path: str, output_path: str, ocr_pages: list) -> bool:
    """
    使用 PaddleOCR 结果和 OCRmyPDF 创建双层 PDF
    
    工作流程：
    1. 将 PDF 每页转换为图片
    2. 为每页生成带文字层的 PDF（使用 paddle_to_pdf）
    3. 使用 OCRmyPDF 的 sandwich 模式将文字层叠加到原始 PDF
    
    Args:
        pdf_path: 原始 PDF 路径
        output_path: 输出 PDF 路径
        ocr_pages: OCR 结果列表（PaddleOCR 格式）
    
    Returns:
        bool: 成功返回 True
    """
    import fitz  # PyMuPDF
    import tempfile
    import ocrmypdf
    
    try:
        doc = fitz.open(pdf_path)
        temp_dir = tempfile.mkdtemp()
        
        log.info(f"[PaddleOCR Plugin] Processing {len(ocr_pages)} pages...")
        
        # 为每页生成带文字层的 PDF
        text_pdfs = []
        for page_info in ocr_pages:
            page_num = page_info.get("page_num", 1)
            page_idx = page_num - 1
            
            if page_idx >= len(doc):
                continue
            
            page = doc[page_idx]
            
            # 渲染页面为图片
            pix = page.get_pixmap(dpi=150)
            img_path = Path(temp_dir) / f"page_{page_num}.png"
            pix.save(str(img_path))
            
            # 生成文字层 PDF
            text_pdf_path = Path(temp_dir) / f"text_{page_num}.pdf"
            regions = page_info.get("regions", [])
            
            paddle_to_pdf(
                image_filename=img_path,
                image_scale=1.0,
                regions=regions,
                output_pdf=text_pdf_path,
            )
            
            text_pdfs.append(text_pdf_path)
        
        doc.close()
        
        # 使用 OCRmyPDF 的 sandwich 模式合并
        # 注意：这里直接使用 OCRmyPDF 的内部 API 会更高效
        # 但为了简单起见，先使用基本的叠加方法
        
        log.info(f"[PaddleOCR Plugin] Merging text layers with original PDF...")
        
        # 简化方案：直接使用 pikepdf 叠加
        _merge_text_layers(pdf_path, text_pdfs, output_path)
        
        # 清理临时文件
        import shutil
        shutil.rmtree(temp_dir)
        
        log.info(f"[PaddleOCR Plugin] Successfully created layered PDF: {output_path}")
        return True
        
    except Exception as e:
        log.error(f"[PaddleOCR Plugin] Failed to create layered PDF: {e}")
        import traceback
        traceback.print_exc()
        return False


def _merge_text_layers(original_pdf: str, text_pdfs: list, output_pdf: str):
    """
    将文字层 PDF 叠加到原始 PDF
    
    使用 pikepdf 将透明文字层复制到原始 PDF 的每一页
    
    关键：使用 copy_foreign() 复制来自其他 PDF 的对象，
    避免 "attempted to unparse a pikepdf.Object from a destroyed pikepdf.Pdf" 错误
    """
    from pikepdf import Pdf, Page, Array
    
    # 打开原始 PDF（不使用 with，因为需要在循环中保持打开状态直到保存）
    original = Pdf.open(original_pdf)
    
    try:
        # 为每页添加文字层
        for i, text_pdf_path in enumerate(text_pdfs):
            if i >= len(original.pages):
                break
            
            # 打开文字层 PDF
            text_pdf = Pdf.open(text_pdf_path)
            
            try:
                if len(text_pdf.pages) == 0:
                    continue
                
                # 获取原始页面和文字层页面
                original_page = original.pages[i]
                text_page = text_pdf.pages[0]
                
                # 复制文字层的内容流和资源
                # 关键：使用 copy_foreign() 将对象复制到目标 PDF
                if '/Contents' in text_page:
                    # 复制内容流（必须使用 copy_foreign）
                    if isinstance(text_page.Contents, Array):
                        copied_contents = [original.copy_foreign(c) for c in text_page.Contents]
                    else:
                        copied_contents = [original.copy_foreign(text_page.Contents)]
                    
                    # 如果原始页面已有内容流，追加文字层内容
                    if '/Contents' in original_page:
                        # 确保 Contents 是数组
                        if isinstance(original_page.Contents, Array):
                            for c in copied_contents:
                                original_page.Contents.append(c)
                        else:
                            # 转换为数组
                            original_contents = original_page.Contents
                            original_page.Contents = Array([original_contents] + copied_contents)
                    else:
                        if len(copied_contents) == 1:
                            original_page.Contents = copied_contents[0]
                        else:
                            original_page.Contents = Array(copied_contents)
                
                # 合并资源（字体）- 同样需要 copy_foreign
                if '/Resources' in text_page:
                    if '/Resources' not in original_page:
                        original_page.Resources = Dictionary()
                    
                    if '/Font' in text_page.Resources:
                        if '/Font' not in original_page.Resources:
                            original_page.Resources.Font = Dictionary()
                        
                        # 复制字体资源（必须使用 copy_foreign）
                        for font_name, font_obj in text_page.Resources.Font.items():
                            original_page.Resources.Font[font_name] = original.copy_foreign(font_obj)
            
            finally:
                text_pdf.close()
        
        # 保存结果
        original.save(output_pdf)
    
    finally:
        original.close()
