#!/usr/bin/env pwsh
# OCRmyPDF 集成自动化测试脚本

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "OCRmyPDF Integration Test Suite" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$ErrorCount = 0

# 1. 验证 Docker 容器运行状态
Write-Host "`n[1/5] Checking Docker Container Status..." -ForegroundColor Yellow
$containerStatus = docker-compose ps api --format json | ConvertFrom-Json
if ($containerStatus.State -ne "running") {
    Write-Host "✗ API container is not running: $($containerStatus.State)" -ForegroundColor Red
    Write-Host "  Starting API container..." -ForegroundColor Yellow
    docker-compose up -d api
    Start-Sleep -Seconds 10
} else {
    Write-Host "✓ API container is running" -ForegroundColor Green
}

# 2. 验证 OCRmyPDF 安装
Write-Host "`n[2/5] Verifying OCRmyPDF Installation..." -ForegroundColor Yellow
$ocrmypdfCheck = docker-compose exec -T api python -c "import ocrmypdf; print(ocrmypdf.__version__)" 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ OCRmyPDF installed: $ocrmypdfCheck" -ForegroundColor Green
} else {
    Write-Host "✗ OCRmyPDF not installed" -ForegroundColor Red
    $ErrorCount++
}

# 3. 验证 Tesseract 安装和语言包
Write-Host "`n[3/5] Verifying Tesseract OCR..." -ForegroundColor Yellow
$tesseractVersion = docker-compose exec -T api tesseract --version 2>&1 | Select-Object -First 1
Write-Host "  Version: $tesseractVersion" -ForegroundColor Gray

$tesseractLangs = docker-compose exec -T api tesseract --list-langs 2>&1
if ($tesseractLangs -match "chi_sim" -and $tesseractLangs -match "eng") {
    Write-Host "✓ Tesseract installed with Chinese support" -ForegroundColor Green
} else {
    Write-Host "✗ Chinese language packs missing" -ForegroundColor Red
    $ErrorCount++
}

# 4. 运行 Python 集成测试
Write-Host "`n[4/5] Running Integration Tests..." -ForegroundColor Yellow
$testResult = docker-compose exec -T api pytest /app/tests/test_ocrmypdf_integration.py -v --tb=short 2>&1
Write-Host $testResult

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ All integration tests passed" -ForegroundColor Green
} else {
    Write-Host "✗ Some tests failed" -ForegroundColor Red
    $ErrorCount++
}

# 5. 验证 API 健康状态
Write-Host "`n[5/5] Checking API Health..." -ForegroundColor Yellow
try {
    $healthCheck = Invoke-WebRequest -Uri "http://localhost:8000/health" -TimeoutSec 5 -ErrorAction Stop
    if ($healthCheck.StatusCode -eq 200) {
        Write-Host "✓ API is healthy" -ForegroundColor Green
    } else {
        Write-Host "✗ API returned status $($healthCheck.StatusCode)" -ForegroundColor Red
        $ErrorCount++
    }
} catch {
    Write-Host "✗ API is not responding: $($_.Exception.Message)" -ForegroundColor Red
    $ErrorCount++
}

# 总结
Write-Host "`n========================================" -ForegroundColor Cyan
if ($ErrorCount -eq 0) {
    Write-Host "✅ All Tests Passed!" -ForegroundColor Green
    Write-Host "`nOCRmyPDF integration is ready for use." -ForegroundColor Green
    Write-Host "You can now upload PDFs and test the layered PDF generation." -ForegroundColor Gray
} else {
    Write-Host "❌ $ErrorCount Test(s) Failed" -ForegroundColor Red
    Write-Host "`nPlease check the error messages above." -ForegroundColor Yellow
}
Write-Host "========================================" -ForegroundColor Cyan

exit $ErrorCount
