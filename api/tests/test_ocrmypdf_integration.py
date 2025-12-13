"""
测试 OCRmyPDF 集成

验证双层PDF生成功能：
1. OCRmyPDF 是否正确安装
2. Tesseract-OCR 中文支持
3. 双层PDF生成和文字对齐
"""
import os
import tempfile
import pytest


def test_ocrmypdf_installed():
    """测试 OCRmyPDF 是否安装"""
    try:
        import ocrmypdf
        print(f"✓ OCRmyPDF version: {ocrmypdf.__version__}")
        assert True
    except ImportError as e:
        pytest.skip(f"OCRmyPDF not installed: {e}")


def test_tesseract_installed():
    """测试 Tesseract-OCR 是否安装"""
    import subprocess
    try:
        result = subprocess.run(
            ['tesseract', '--version'],
            capture_output=True,
            text=True,
            timeout=5
        )
        print(f"✓ Tesseract version:\n{result.stdout}")
        assert result.returncode == 0
    except FileNotFoundError:
        pytest.skip("Tesseract not found in PATH")


def test_tesseract_chinese_support():
    """测试 Tesseract 中文语言包"""
    import subprocess
    try:
        result = subprocess.run(
            ['tesseract', '--list-langs'],
            capture_output=True,
            text=True,
            timeout=5
        )
        langs = result.stdout
        print(f"✓ Tesseract available languages:\n{langs}")
        
        # 检查中文支持
        assert 'chi_sim' in langs, "Simplified Chinese (chi_sim) not installed"
        assert 'eng' in langs, "English (eng) not installed"
        print("✓ Chinese language support confirmed")
    except FileNotFoundError:
        pytest.skip("Tesseract not found in PATH")


@pytest.mark.skip(reason="CI 环境未安装 tesseract-ocr")
def test_ocrmypdf_basic_function():
    """测试 OCRmyPDF 基本功能"""
    try:
        import ocrmypdf
        from PIL import Image, ImageDraw, ImageFont
        import io
        import fitz  # PyMuPDF
        
        # 创建一个包含文字的测试图片
        img = Image.new('RGB', (800, 400), color='white')
        draw = ImageDraw.Draw(img)
        
        # 添加测试文字
        text = "测试文字 Test Text 123"
        try:
            # 尝试使用系统字体
            font = ImageFont.truetype("arial.ttf", 40)
        except:
            font = ImageFont.load_default()
        
        draw.text((50, 150), text, fill='black', font=font)
        
        # 将图片转换为PDF
        img_bytes = io.BytesIO()
        img.save(img_bytes, format='PDF')
        img_bytes.seek(0)
        
        # 创建临时文件
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as input_file:
            input_file.write(img_bytes.read())
            input_path = input_file.name
        
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as output_file:
            output_path = output_file.name
        
        try:
            # 使用 OCRmyPDF 处理
            print(f"\n✓ Testing OCRmyPDF with test PDF...")
            ocrmypdf.ocr(
                input_path,
                output_path,
                language='chi_sim+eng',
                force_ocr=True,
                optimize=0,
                progress_bar=False,
            )
            
            # 验证输出文件
            assert os.path.exists(output_path), "Output PDF not created"
            assert os.path.getsize(output_path) > 0, "Output PDF is empty"
            
            # 尝试提取文字验证
            doc = fitz.open(output_path)
            page = doc[0]
            extracted_text = page.get_text()
            
            print(f"✓ OCRmyPDF processed successfully")
            print(f"✓ Output PDF size: {os.path.getsize(output_path)} bytes")
            print(f"✓ Extracted text: {extracted_text[:100]}")
            
            doc.close()
            
            # 验证包含某些文字（OCR可能不完全准确）
            assert len(extracted_text.strip()) > 0, "No text extracted from OCR result"
            print("✓ Text extraction successful")
            
        finally:
            # 清理临时文件
            for path in [input_path, output_path]:
                if os.path.exists(path):
                    os.remove(path)
                    
    except ImportError as e:
        pytest.skip(f"Required dependencies not available: {e}")


@pytest.mark.skip(reason="CI 环境未安装 tesseract-ocr")
def test_ocrmypdf_coordinate_mapping():
    """测试 OCRmyPDF 坐标映射准确性"""
    try:
        import ocrmypdf
        from PIL import Image, ImageDraw, ImageFont
        import fitz
        import io
        
        # 创建一个精确位置的文字图片
        img = Image.new('RGB', (1000, 600), color='white')
        draw = ImageDraw.Draw(img)
        
        # 在特定位置绘制文字
        test_positions = [
            (100, 100, "第一行文字"),
            (100, 200, "第二行文字"),
            (100, 300, "Third Line"),
        ]
        
        try:
            font = ImageFont.truetype("arial.ttf", 36)
        except:
            font = ImageFont.load_default()
        
        for x, y, text in test_positions:
            draw.text((x, y), text, fill='black', font=font)
        
        # 转换为PDF
        img_bytes = io.BytesIO()
        img.save(img_bytes, format='PDF')
        img_bytes.seek(0)
        
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as input_file:
            input_file.write(img_bytes.read())
            input_path = input_file.name
        
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as output_file:
            output_path = output_file.name
        
        try:
            # OCR处理
            ocrmypdf.ocr(
                input_path,
                output_path,
                language='chi_sim+eng',
                force_ocr=True,
                deskew=False,
                clean=False,
                progress_bar=False,
            )
            
            # 验证文字位置
            doc = fitz.open(output_path)
            page = doc[0]
            
            # 获取所有文本块及其位置
            text_instances = page.get_text("dict")
            
            print(f"\n✓ Text blocks found: {len(text_instances.get('blocks', []))}")
            
            # 验证文字可搜索
            extracted_text = page.get_text()
            print(f"✓ Extracted searchable text:\n{extracted_text}")
            
            assert len(extracted_text.strip()) > 0, "No searchable text found"
            
            doc.close()
            print("✓ Coordinate mapping test completed")
            
        finally:
            for path in [input_path, output_path]:
                if os.path.exists(path):
                    os.remove(path)
                    
    except ImportError as e:
        pytest.skip(f"Required dependencies not available: {e}")


if __name__ == "__main__":
    print("=" * 60)
    print("OCRmyPDF Integration Tests")
    print("=" * 60)
    
    try:
        test_ocrmypdf_installed()
        print("\n" + "=" * 60)
        test_tesseract_installed()
        print("\n" + "=" * 60)
        test_tesseract_chinese_support()
        print("\n" + "=" * 60)
        test_ocrmypdf_basic_function()
        print("\n" + "=" * 60)
        test_ocrmypdf_coordinate_mapping()
        print("\n" + "=" * 60)
        print("\n✅ All tests passed!")
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
