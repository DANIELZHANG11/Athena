"""
OCR 引擎封装

职责：
- 在生产环境使用 PaddleOCR 3.x（PP-OCRv5 系列）进行文本检测与识别
- 在 CI/测试环境使用 `MockOCR` 返回空结果以保证稳定性

实现要点：
- 通过预签名 URL 下载原文件到带正确后缀的临时路径，避免 `predict()` 因查询参数无法识别类型
- 统一返回结构：`{"regions": [{text, confidence, bbox?, polygon?}], "text": "..."}`
- 兼容不同版本返回的结果结构（属性或字典）
"""
import io
import os
from typing import Any
from ..storage import presigned_get


class MockOCR:
    """Mock OCR for CI/testing environments"""
    def recognize(self, bucket: str, key: str) -> dict:
        return {"pages": [], "text": ""}


class PaddleOCREngine:
    """
    PP-OCRv5 Engine (PaddleOCR 3.x API)
    - 支持：简体中文、繁体中文、英文、日文、手写体
    - GPU 自动检测：PaddlePaddle 3.0 根据安装版本自动选择设备
    - 推荐并发：2 Workers (8GB GPU) / 3 Workers (12GB GPU)
    
    PaddleOCR 3.x 主要变化：
    - 使用 predict() 而非 ocr()
    - 通过 text_detection_model_name / text_recognition_model_name 指定模型
    - 设备选择由 PaddlePaddle 框架自动处理
    """
    
    def __init__(self):
        from paddleocr import PaddleOCR
        
        # PaddleOCR 3.x 初始化参数
        # 模型选择：PP-OCRv5_server (高精度) 或 PP-OCRv5_mobile (平衡)
        use_mobile = os.getenv("OCR_USE_MOBILE", "true").lower() == "true"
        
        model_suffix = "mobile" if use_mobile else "server"
        det_model = os.getenv("OCR_DET_MODEL", f"PP-OCRv5_{model_suffix}_det")
        rec_model = os.getenv("OCR_REC_MODEL", f"PP-OCRv5_{model_suffix}_rec")
        
        self.ocr = PaddleOCR(
            text_detection_model_name=det_model,
            text_recognition_model_name=rec_model,
            use_doc_orientation_classify=False,  # 关闭文档方向分类（加速）
            use_doc_unwarping=False,             # 关闭文档矫正（加速）
            use_textline_orientation=False,      # 关闭文本行方向分类（加速）
            # 性能优化参数（用户确认 2026-01-09）
            use_fp16=True,                       # FP16半精度，显存减半
            det_limit_side_len=960,              # 检测时图片最大边长
            rec_batch_num=30,                    # 识别批量大小，提升吞吐
            show_log=False,                      # 关闭日志输出减少IO
        )
        
        import logging
        logging.info(f"[OCR] PaddleOCR 3.x initialized with det={det_model}, rec={rec_model}")

    def _download_to_temp(self, bucket: str, key: str) -> str:
        """
        下载文件到临时目录并返回本地路径
        PaddleOCR 3.x 的 predict() 方法需要文件后缀来识别文件类型
        presigned URL 中的查询参数会导致后缀识别失败
        """
        import tempfile
        import requests
        from urllib.parse import urlparse
        
        url = presigned_get(bucket, key) if not key.startswith("http") else key
        
        # 从 key 中提取原始文件扩展名
        path = urlparse(key if not key.startswith("http") else url).path
        # 获取不含查询参数的路径的扩展名
        ext = os.path.splitext(path.split('?')[0])[1] or '.png'
        
        # 创建临时文件
        fd, temp_path = tempfile.mkstemp(suffix=ext)
        try:
            response = requests.get(url, timeout=60)
            response.raise_for_status()
            os.write(fd, response.content)
        finally:
            os.close(fd)
        
        return temp_path

    def recognize(self, bucket: str, key: str) -> dict:
        """
        识别单张图片
        Args:
            bucket: S3 bucket 名称，如果为空则 key 视为本地文件路径
            key: S3 object key 或本地文件路径
        返回: {"pages": [{"text": "行文本", "confidence": 0.99}], "text": "完整文本"}
        """
        temp_path = None
        is_local = not bucket  # bucket 为空表示 key 是本地路径
        
        try:
            if is_local:
                # 直接使用本地路径
                file_path = key
            else:
                # 从 S3 下载到临时文件（带正确后缀）
                temp_path = self._download_to_temp(bucket, key)
                file_path = temp_path
            
            # PaddleOCR 3.x 使用 predict() 方法
            results = self.ocr.predict(file_path)
            
            regions = []
            text = ""
            
            for res in results:
                # 获取识别结果 - 包含坐标信息
                rec_texts = getattr(res, 'rec_texts', []) or []
                rec_scores = getattr(res, 'rec_scores', []) or []
                rec_polys = getattr(res, 'rec_polys', []) or []  # 4点多边形坐标
                rec_boxes = getattr(res, 'rec_boxes', []) or []  # 边界框 [x1,y1,x2,y2]
                
                # 兼容 res['res'] 格式
                if not rec_texts and hasattr(res, '__getitem__'):
                    try:
                        res_data = res.get('res', res) if isinstance(res, dict) else res
                        rec_texts = getattr(res_data, 'rec_texts', []) or res_data.get('rec_texts', []) if isinstance(res_data, dict) else []
                        rec_scores = getattr(res_data, 'rec_scores', []) or res_data.get('rec_scores', []) if isinstance(res_data, dict) else []
                        rec_polys = getattr(res_data, 'rec_polys', []) or res_data.get('rec_polys', []) if isinstance(res_data, dict) else []
                        rec_boxes = getattr(res_data, 'rec_boxes', []) or res_data.get('rec_boxes', []) if isinstance(res_data, dict) else []
                    except Exception:
                        pass
                
                for i, txt in enumerate(rec_texts):
                    if txt:
                        score = rec_scores[i] if i < len(rec_scores) else 0.0
                        text += txt + "\n"
                        
                        region = {
                            "text": txt,
                            "confidence": float(score),
                        }
                        
                        # 添加边界框坐标 [x1, y1, x2, y2]
                        if i < len(rec_boxes):
                            bbox = rec_boxes[i]
                            if hasattr(bbox, 'tolist'):
                                bbox = bbox.tolist()
                            region["bbox"] = [float(v) for v in bbox]
                        
                        # 添加多边形坐标 [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
                        if i < len(rec_polys):
                            poly = rec_polys[i]
                            if hasattr(poly, 'tolist'):
                                poly = poly.tolist()
                            region["polygon"] = [[float(p[0]), float(p[1])] for p in poly]
                        
                        regions.append(region)
            
            return {"regions": regions, "text": text.strip()}
        except Exception as e:
            import logging
            logging.warning(f"[OCR] Recognition failed: {e}")
            return {"pages": [], "text": ""}
        finally:
            # 清理临时文件
            if temp_path and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except Exception:
                    pass


class OCRmyPDFEngine:
    """
    OCRmyPDF 引擎 - 使用 PaddleOCR 作为识别引擎生成高质量双层PDF
    
    优势：
    - 自动处理坐标映射，文字对齐精确
    - 支持图像预处理（去噪、矫正、优化）
    - 生成的PDF完全兼容标准
    - 透明文字层与原图完美对齐
    
    工作流程：
    1. 使用 PaddleOCR 识别文字和坐标
    2. 生成 hOCR 格式中间文件
    3. OCRmyPDF 使用 hOCR 数据生成双层PDF
    """
    
    def __init__(self):
        self.paddle_engine = PaddleOCREngine()
        import logging
        logging.info("[OCR] OCRmyPDF engine initialized with PaddleOCR backend")
    
    def recognize(self, bucket: str, key: str) -> dict:
        """
        识别图片（兼容接口）
        对于双层PDF生成，使用 create_searchable_pdf() 方法
        """
        return self.paddle_engine.recognize(bucket, key)
    
    def create_searchable_pdf(self, input_pdf_path: str, output_pdf_path: str, ocr_results: list = None) -> bool:
        """
        创建可搜索的双层PDF
        
        Args:
            input_pdf_path: 原始PDF路径（图片型PDF）
            output_pdf_path: 输出PDF路径
            ocr_results: 可选的OCR结果（PaddleOCR格式），如果提供则使用，否则重新识别
        
        Returns:
            bool: 成功返回True，失败返回False
        """
        import ocrmypdf
        import tempfile
        import os
        import logging
        
        try:
            if ocr_results:
                # 使用已有的 PaddleOCR 结果生成 hOCR
                hocr_path = self._paddle_to_hocr(input_pdf_path, ocr_results)
                
                # 使用 hOCR 生成双层PDF
                ocrmypdf.ocr(
                    input_pdf_path,
                    output_pdf_path,
                    language='chi_sim+eng',
                    sidecar=None,
                    deskew=False,  # 已经由PaddleOCR处理
                    clean=False,   # 不修改原图
                    force_ocr=True,
                    skip_text=True,  # 跳过已有文字层
                    optimize=1,
                    pdf_renderer='hocr',
                    use_threads=True,
                    jobs=4,
                    # 使用自定义的 hOCR 文件
                    tesseract_config='--user-words ' + hocr_path if os.path.exists(hocr_path) else '',
                )
                
                # 清理临时文件
                if os.path.exists(hocr_path):
                    os.remove(hocr_path)
            else:
                # 直接使用 OCRmyPDF 的默认引擎（Tesseract）
                ocrmypdf.ocr(
                    input_pdf_path,
                    output_pdf_path,
                    language='chi_sim+eng',
                    deskew=True,
                    clean=True,
                    force_ocr=True,
                    skip_text=True,
                    optimize=1,
                    use_threads=True,
                    jobs=4,
                    png_quality=85,
                    jpeg_quality=85,
                )
            
            logging.info(f"[OCRmyPDF] Successfully created searchable PDF: {output_pdf_path}")
            return True
            
        except Exception as e:
            logging.error(f"[OCRmyPDF] Failed to create searchable PDF: {e}")
            return False
    
    def _paddle_to_hocr(self, pdf_path: str, ocr_results: list) -> str:
        """
        将 PaddleOCR 结果转换为 hOCR 格式
        
        hOCR 格式示例:
        <div class='ocr_page' title='bbox 0 0 1240 1754'>
          <div class='ocr_carea' title='bbox 100 100 500 150'>
            <span class='ocrx_word' title='bbox 100 100 200 150'>中国</span>
          </div>
        </div>
        """
        import tempfile
        import fitz
        from html import escape
        
        # 打开PDF获取页面尺寸
        doc = fitz.open(pdf_path)
        
        fd, hocr_path = tempfile.mkstemp(suffix='.hocr')
        
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
                f.write('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" ')
                f.write('"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">\n')
                f.write('<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">\n')
                f.write('<head><meta http-equiv="content-type" content="text/html; charset=utf-8" />\n')
                f.write('<title>OCR Output</title></head><body>\n')
                
                for page_info in ocr_results:
                    page_num = page_info.get('page_num', 1)
                    page_idx = page_num - 1
                    
                    if page_idx >= len(doc):
                        continue
                    
                    page = doc[page_idx]
                    page_rect = page.rect
                    width = int(page_rect.width)
                    height = int(page_rect.height)
                    
                    # OCR 图片尺寸
                    ocr_width = page_info.get('width', width)
                    ocr_height = page_info.get('height', height)
                    
                    # 计算缩放比例
                    scale_x = width / ocr_width if ocr_width > 0 else 1
                    scale_y = height / ocr_height if ocr_height > 0 else 1
                    
                    f.write(f'<div class="ocr_page" id="page_{page_num}" title="bbox 0 0 {width} {height}">\n')
                    
                    regions = page_info.get('regions', [])
                    for i, region in enumerate(regions):
                        text = region.get('text', '').strip()
                        if not text:
                            continue
                        
                        # 获取坐标
                        bbox = region.get('bbox') or region.get('box')
                        if not bbox:
                            polygon = region.get('polygon')
                            if polygon and len(polygon) >= 4:
                                # 从多边形提取边界框
                                xs = [p[0] for p in polygon]
                                ys = [p[1] for p in polygon]
                                bbox = [min(xs), min(ys), max(xs), max(ys)]
                        
                        if not bbox:
                            continue
                        
                        # 处理不同格式
                        if isinstance(bbox[0], list):
                            x1, y1 = bbox[0]
                            x2, y2 = bbox[2]
                        else:
                            x1, y1, x2, y2 = bbox[:4]
                        
                        # 映射到PDF坐标
                        x1 = int(x1 * scale_x)
                        y1 = int(y1 * scale_y)
                        x2 = int(x2 * scale_x)
                        y2 = int(y2 * scale_y)
                        
                        # 确保坐标正确
                        if x1 > x2:
                            x1, x2 = x2, x1
                        if y1 > y2:
                            y1, y2 = y2, y1
                        
                        confidence = region.get('confidence', 1.0)
                        
                        # 写入 hOCR
                        f.write(f'  <div class="ocr_carea" id="carea_{page_num}_{i}">\n')
                        f.write(f'    <span class="ocrx_word" title="bbox {x1} {y1} {x2} {y2}; x_wconf {int(confidence * 100)}">')
                        f.write(escape(text))
                        f.write('</span>\n')
                        f.write('  </div>\n')
                    
                    f.write('</div>\n')
                
                f.write('</body></html>\n')
            
            doc.close()
            return hocr_path
            
        except Exception as e:
            if os.path.exists(hocr_path):
                os.remove(hocr_path)
            raise e


def get_ocr(use_ocrmypdf: bool = True):
    """
    获取 OCR 引擎实例
    
    Args:
        use_ocrmypdf: 是否使用 OCRmyPDF 引擎（推荐）
    
    Returns:
        OCR引擎实例
    """
    try:
        if use_ocrmypdf:
            try:
                return OCRmyPDFEngine()
            except Exception as e:
                import logging
                logging.warning(f"[OCR] Failed to load OCRmyPDF, falling back to PaddleOCR: {e}")
                return PaddleOCREngine()
        else:
            return PaddleOCREngine()
    except Exception as e:
        import logging
        logging.warning(f"[OCR] Failed to load PaddleOCR, using MockOCR: {e}")
        return MockOCR()
