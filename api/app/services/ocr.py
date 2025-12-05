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


def get_ocr():
    """
    获取 OCR 引擎实例
    生产环境返回 PaddleOCREngine，CI/测试环境返回 MockOCR
    """
    try:
        return PaddleOCREngine()
    except Exception as e:
        import logging
        logging.warning(f"[OCR] Failed to load PaddleOCR, using MockOCR: {e}")
        return MockOCR()
