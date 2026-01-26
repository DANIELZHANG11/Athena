"""
OCRmyPDF + PaddleOCR 集成服务

使用官方 OCRmyPDF 框架 + PaddleOCR 插件生成高质量双层 PDF

架构说明：
- OCRmyPDF: 业界标准的 PDF OCR 工具，GitHub 30k+ stars
- PaddleOCR: 百度开源 OCR，对中文识别效果优秀
- ocrmypdf-paddleocr: 社区插件，实现 OCRmyPDF 的 OcrEngine 接口

核心优势：
1. 使用 hOCR 标准格式，文字位置精确
2. 支持 return_word_box=True 获取单词级边界框
3. 使用 OCRmyPDF 的 hocrtransform 生成透明文字层
4. 自动处理页面旋转、DPI 转换等复杂问题

文档参考：
- https://github.com/ocrmypdf/OCRmyPDF
- https://github.com/clefru/ocrmypdf-paddleocr
"""

import os
import sys
import logging
import tempfile
from pathlib import Path
from typing import Optional

# 将插件目录添加到 Python 路径
PLUGIN_PATH = Path(__file__).parent.parent.parent / "external" / "ocrmypdf-paddleocr" / "src"
if PLUGIN_PATH.exists() and str(PLUGIN_PATH) not in sys.path:
    sys.path.insert(0, str(PLUGIN_PATH))

log = logging.getLogger(__name__)


def create_searchable_pdf_with_paddleocr(
    input_pdf_path: str,
    output_pdf_path: str,
    language: str = "chi_sim",
    use_gpu: bool = False,
    force_ocr: bool = True,
    skip_text: bool = False,
    dpi: int = 300,
    optimize: int = 1,
    progress_callback: Optional[callable] = None,
) -> bool:
    """
    使用 OCRmyPDF + PaddleOCR 插件创建可搜索的双层 PDF
    
    Args:
        input_pdf_path: 输入 PDF 文件路径
        output_pdf_path: 输出 PDF 文件路径
        language: OCR 语言代码 (tesseract 风格: chi_sim, eng 等)
        use_gpu: 是否使用 GPU 加速
        force_ocr: 强制对所有页面执行 OCR（忽略已有文字层）
        skip_text: 跳过已有文字的页面
        dpi: OCR 渲染分辨率
        optimize: PDF 优化级别 (0-3)
        progress_callback: 进度回调函数 (current, total)
    
    Returns:
        bool: 是否成功
    
    示例:
        success = create_searchable_pdf_with_paddleocr(
            "input.pdf", 
            "output.pdf", 
            language="chi_sim"
        )
    """
    import ocrmypdf
    from ocrmypdf import Verbosity
    
    try:
        log.info(f"[OCRmyPDF-PaddleOCR] Starting OCR: {input_pdf_path}")
        log.info(f"[OCRmyPDF-PaddleOCR] Language: {language}, GPU: {use_gpu}, DPI: {dpi}")
        
        # OCRmyPDF 的 Tesseract 插件设置了 OMP_THREAD_LIMIT，
        # 这会影响 PaddleOCR 的多线程性能，需要临时移除
        saved_omp_limit = os.environ.get('OMP_THREAD_LIMIT')
        if saved_omp_limit:
            log.warning(f"[OCRmyPDF-PaddleOCR] Removing OMP_THREAD_LIMIT={saved_omp_limit}")
            del os.environ['OMP_THREAD_LIMIT']
        
        # 构建插件参数
        # 插件通过 --plugin 参数加载，路径指向 ocrmypdf_paddleocr 模块
        plugin_module = "ocrmypdf_paddleocr"
        
        # 配置日志
        ocrmypdf.configure_logging(Verbosity.default)
        
        # 调用 OCRmyPDF
        result = ocrmypdf.ocr(
            input_file=input_pdf_path,
            output_file=output_pdf_path,
            language=[language],
            image_dpi=dpi,
            force_ocr=force_ocr,
            skip_text=skip_text,
            optimize=optimize,
            # 关键：加载 PaddleOCR 插件
            plugins=[plugin_module],
            # PaddleOCR 特定选项（通过 kwargs 传递）
            paddle_use_gpu=use_gpu,
            # 使用 sandwich 渲染模式（透明文字层）
            pdf_renderer='sandwich',
            # 保持原始图像质量
            output_type='pdf',
            # 进度条
            progress_bar=progress_callback is not None,
        )
        
        # 恢复 OMP_THREAD_LIMIT
        if saved_omp_limit:
            os.environ['OMP_THREAD_LIMIT'] = saved_omp_limit
        
        if result == ocrmypdf.ExitCode.ok:
            log.info(f"[OCRmyPDF-PaddleOCR] Successfully created: {output_pdf_path}")
            return True
        else:
            log.error(f"[OCRmyPDF-PaddleOCR] OCR failed with exit code: {result}")
            return False
            
    except ocrmypdf.exceptions.PriorOcrFoundError:
        log.warning("[OCRmyPDF-PaddleOCR] PDF already has OCR layer, skipping...")
        # 如果已有 OCR 层，直接复制原文件
        import shutil
        shutil.copy(input_pdf_path, output_pdf_path)
        return True
        
    except Exception as e:
        log.error(f"[OCRmyPDF-PaddleOCR] Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def ocr_pdf_bytes(
    pdf_data: bytes,
    language: str = "chi_sim",
    use_gpu: bool = False,
    force_ocr: bool = True,
) -> Optional[bytes]:
    """
    对 PDF 二进制数据执行 OCR，返回带透明文字层的 PDF
    
    Args:
        pdf_data: 输入 PDF 的二进制数据
        language: OCR 语言代码
        use_gpu: 是否使用 GPU
        force_ocr: 强制 OCR（忽略已有文字）
    
    Returns:
        bytes: OCR 后的 PDF 数据，失败返回 None
    """
    try:
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as temp_in:
            temp_in.write(pdf_data)
            temp_in_path = temp_in.name
        
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as temp_out:
            temp_out_path = temp_out.name
        
        success = create_searchable_pdf_with_paddleocr(
            input_pdf_path=temp_in_path,
            output_pdf_path=temp_out_path,
            language=language,
            use_gpu=use_gpu,
            force_ocr=force_ocr,
        )
        
        if success:
            with open(temp_out_path, 'rb') as f:
                result = f.read()
        else:
            result = None
        
        # 清理临时文件
        try:
            os.remove(temp_in_path)
            os.remove(temp_out_path)
        except Exception:
            pass
        
        return result
        
    except Exception as e:
        log.error(f"[OCRmyPDF-PaddleOCR] ocr_pdf_bytes failed: {e}")
        return None


# 兼容旧接口的别名
create_layered_pdf = create_searchable_pdf_with_paddleocr
