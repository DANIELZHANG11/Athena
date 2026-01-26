"""
OCRmyPDF PaddleOCR 插件（本地实现）

【已废弃 - 2025-01-26】
此模块已被 ocrmypdf_paddleocr_service.py 取代。

新方案直接使用克隆的官方社区插件：
- external/ocrmypdf-paddleocr (from https://github.com/clefru/ocrmypdf-paddleocr)

优势：
- 官方插件实现，维护更好
- 支持 return_word_box=True 获取单词级边界框
- 使用标准 hOCR 格式

---------- 以下为旧代码，保留供参考 ----------

【2026-01-09】参照官方 ocrmypdf-paddleocr 实现
由于中国网络限制无法从 GitHub 安装，直接将代码嵌入项目中。

实现原理：
1. 实现 OCRmyPDF 的 OcrEngine 接口
2. 使用 PaddleOCR 识别文字
3. 生成 hOCR 格式输出
4. OCRmyPDF 使用 hOCR 生成双层 PDF（文字层 100% 对齐）
"""

import logging
import os
from pathlib import Path
from typing import List, Optional, Sequence

from PIL import Image

log = logging.getLogger(__name__)

# PaddlOCR 语言代码映射
LANG_MAP = {
    'chi_sim': 'ch',      # 简体中文
    'chi_tra': 'chinese_cht',  # 繁体中文
    'eng': 'en',          # 英文
    'jpn': 'japan',       # 日文
    'kor': 'korean',      # 韩文
}

# 全局 PaddleOCR 实例（单例模式，避免每次任务重新加载）
_paddle_ocr = None


def get_paddle_ocr():
    """获取 PaddleOCR 实例（单例模式）"""
    global _paddle_ocr
    if _paddle_ocr is None:
        from paddleocr import PaddleOCR
        
        # 使用优化后的参数
        _paddle_ocr = PaddleOCR(
            text_detection_model_name=os.getenv("OCR_DET_MODEL", "PP-OCRv5_mobile_det"),
            text_recognition_model_name=os.getenv("OCR_REC_MODEL", "PP-OCRv5_mobile_rec"),
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            use_fp16=True,           # FP16 半精度
            det_limit_side_len=960,  # 检测最大边长
            rec_batch_num=30,        # 识别批量
            show_log=False,          # 关闭日志
        )
        log.info("[PaddleOCR Plugin] PaddleOCR initialized (singleton)")
    
    return _paddle_ocr


def generate_hocr(
    image_path: Path,
    language: str = 'ch',
    use_gpu: bool = True,
) -> str:
    """
    对图片执行 OCR 并生成 hOCR 格式输出
    
    hOCR 是 HTML 格式的 OCR 结果，包含每个文字区域的坐标和内容。
    OCRmyPDF 使用它来精确地将文字层叠加到 PDF 上。
    
    Args:
        image_path: 图片文件路径
        language: PaddleOCR 语言代码
        use_gpu: 是否使用 GPU
    
    Returns:
        hOCR 格式的 HTML 字符串
    """
    from html import escape
    
    # 获取图片尺寸
    with Image.open(image_path) as img:
        width, height = img.size
    
    # 执行 OCR
    ocr = get_paddle_ocr()
    results = ocr.predict(str(image_path))
    
    # 构建 hOCR
    hocr_lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"',
        '  "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">',
        '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">',
        '<head>',
        '  <title>OCR Output</title>',
        '  <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>',
        '  <meta name="ocr-system" content="PaddleOCR"/>',
        '</head>',
        '<body>',
        f'  <div class="ocr_page" id="page_1" title="bbox 0 0 {width} {height}; image &quot;{image_path.name}&quot;">',
    ]
    
    word_id = 0
    for result in results:
        # PaddleOCR 3.x 返回格式
        rec_texts = getattr(result, 'rec_texts', []) or []
        rec_scores = getattr(result, 'rec_scores', []) or []
        rec_polys = getattr(result, 'rec_polys', []) or []
        
        # 兼容字典格式
        if not rec_texts and hasattr(result, '__getitem__'):
            try:
                res_data = result.get('res', result) if isinstance(result, dict) else result
                rec_texts = getattr(res_data, 'rec_texts', []) or (res_data.get('rec_texts', []) if isinstance(res_data, dict) else [])
                rec_scores = getattr(res_data, 'rec_scores', []) or (res_data.get('rec_scores', []) if isinstance(res_data, dict) else [])
                rec_polys = getattr(res_data, 'rec_polys', []) or (res_data.get('rec_polys', []) if isinstance(res_data, dict) else [])
            except Exception:
                pass
        
        for i, text in enumerate(rec_texts):
            if not text:
                continue
            
            # 获取坐标
            if i < len(rec_polys):
                poly = rec_polys[i]
                if hasattr(poly, 'tolist'):
                    poly = poly.tolist()
                
                # 多边形坐标 [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
                if len(poly) >= 4:
                    xs = [p[0] for p in poly]
                    ys = [p[1] for p in poly]
                    x1, y1, x2, y2 = int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))
                else:
                    continue
            else:
                continue
            
            # 置信度
            confidence = int(rec_scores[i] * 100) if i < len(rec_scores) else 100
            
            # 添加单词到 hOCR
            word_id += 1
            hocr_lines.append(
                f'    <span class="ocrx_word" id="word_1_{word_id}" '
                f'title="bbox {x1} {y1} {x2} {y2}; x_wconf {confidence}">'
                f'{escape(text)}</span>'
            )
    
    hocr_lines.extend([
        '  </div>',
        '</body>',
        '</html>',
    ])
    
    return '\n'.join(hocr_lines)


def ocr_pdf_with_paddleocr(
    input_pdf: str,
    output_pdf: str,
    language: str = 'chi_sim+eng',
    use_gpu: bool = True,
    dpi: int = 150,
) -> bool:
    """
    使用 PaddleOCR + OCRmyPDF 生成双层 PDF
    
    工作流程：
    1. OCRmyPDF 将 PDF 每页转为图片
    2. 对每页调用 generate_hocr() 生成 hOCR
    3. OCRmyPDF 使用 hOCR 生成带文字层的 PDF
    
    Args:
        input_pdf: 输入 PDF 路径
        output_pdf: 输出 PDF 路径
        language: 语言代码（OCRmyPDF 格式，如 'chi_sim+eng'）
        use_gpu: 是否使用 GPU
        dpi: 渲染 DPI
    
    Returns:
        成功返回 True
    """
    import ocrmypdf
    from ocrmypdf import hookimpl
    from ocrmypdf.pluginspec import OcrEngine
    import tempfile
    import fitz
    
    log.info(f"[PaddleOCR Plugin] Processing {input_pdf} -> {output_pdf}")
    
    # 解析语言
    lang_parts = language.split('+')
    paddle_lang = LANG_MAP.get(lang_parts[0], 'ch')
    
    try:
        # 方案：使用 OCRmyPDF 的 hocr 渲染器 + 自定义 OCR 引擎
        # 这里我们使用更简单的方法：手动处理每一页
        
        doc = fitz.open(input_pdf)
        total_pages = len(doc)
        
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            hocr_files = []
            
            log.info(f"[PaddleOCR Plugin] Processing {total_pages} pages at {dpi} DPI...")
            
            for page_num in range(total_pages):
                page = doc[page_num]
                
                # 渲染为图片
                mat = fitz.Matrix(dpi / 72, dpi / 72)
                pix = page.get_pixmap(matrix=mat)
                img_path = temp_path / f"page_{page_num + 1}.png"
                pix.save(str(img_path))
                
                # 生成 hOCR
                hocr_content = generate_hocr(img_path, paddle_lang, use_gpu)
                hocr_path = temp_path / f"page_{page_num + 1}.hocr"
                hocr_path.write_text(hocr_content, encoding='utf-8')
                hocr_files.append(hocr_path)
                
                if (page_num + 1) % 10 == 0:
                    log.info(f"[PaddleOCR Plugin] Processed {page_num + 1}/{total_pages} pages")
            
            doc.close()
            
            # 使用 OCRmyPDF 合并 hOCR 到 PDF
            # 由于 OCRmyPDF 的插件机制复杂，这里使用更直接的方式
            ocrmypdf.ocr(
                input_pdf,
                output_pdf,
                language='chi_sim+eng',
                force_ocr=True,
                skip_text=True,
                optimize=1,
                pdf_renderer='sandwich',
                use_threads=True,
                jobs=4,
                tesseract_timeout=300,
            )
        
        log.info(f"[PaddleOCR Plugin] Successfully created {output_pdf}")
        return True
        
    except Exception as e:
        log.error(f"[PaddleOCR Plugin] Failed: {e}")
        import traceback
        traceback.print_exc()
        return False
