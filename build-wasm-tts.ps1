# Sherpa-ONNX WASM TTS 一键构建脚本 (Windows PowerShell)
# 用法: .\build-wasm-tts.ps1
#
# 构建 Kokoro TTS (中英文, 103个说话人, INT8量化)
# 使用 k2-fsa 官方预构建的 ONNX 模型

param(
    [switch]$NoBuild,      # 跳过 Docker 镜像构建
    [switch]$NoRun,        # 跳过运行构建
    [switch]$Deploy        # 自动部署到 web/public
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DockerDir = Join-Path $ScriptDir "docker\sherpa-onnx-wasm-kokoro"
$OutputDir = Join-Path $DockerDir "output"
$WebPublicDir = Join-Path $ScriptDir "web\public\tts-wasm"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Kokoro WASM TTS 构建工具" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "模型: kokoro-int8-multi-lang-v1_1" -ForegroundColor White
Write-Host "  - 语言: 中文 + 英文" -ForegroundColor Gray
Write-Host "  - 说话人: 103 个" -ForegroundColor Gray
Write-Host "  - 量化: INT8 (~140MB)" -ForegroundColor Gray
Write-Host ""

# 检查 Docker 是否可用
Write-Host "[1/5] 检查 Docker 环境..." -ForegroundColor Yellow
try {
    $dockerVersion = docker --version
    Write-Host "  ✓ Docker 已安装: $dockerVersion" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Docker 未安装或未运行!" -ForegroundColor Red
    Write-Host "  请确保 Docker Desktop 已安装并运行。" -ForegroundColor Red
    exit 1
}

# 检查 Docker 是否运行
try {
    docker info | Out-Null
    Write-Host "  ✓ Docker 服务运行中" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Docker 服务未运行!" -ForegroundColor Red
    Write-Host "  请启动 Docker Desktop。" -ForegroundColor Red
    exit 1
}

# 创建输出目录
Write-Host ""
Write-Host "[2/5] 准备输出目录..." -ForegroundColor Yellow
if (Test-Path $OutputDir) {
    Remove-Item -Recurse -Force $OutputDir
}
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
Write-Host "  ✓ 输出目录: $OutputDir" -ForegroundColor Green

# 构建 Docker 镜像
if (-not $NoBuild) {
    Write-Host ""
    Write-Host "[3/5] 构建 Docker 镜像 (首次约需 15-30 分钟)..." -ForegroundColor Yellow
    Write-Host "  - 下载 Emscripten SDK (~1.5GB)" -ForegroundColor Gray
    Write-Host "  - 下载 Sherpa-ONNX 源码 (~100MB)" -ForegroundColor Gray
    Write-Host "  - 下载 Kokoro INT8 模型 (~140MB)" -ForegroundColor Gray
    Write-Host ""
    
    Push-Location $DockerDir
    try {
        docker build -t sherpa-onnx-wasm-kokoro .
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  ✗ Docker 镜像构建失败!" -ForegroundColor Red
            exit 1
        }
        Write-Host "  ✓ Docker 镜像构建成功" -ForegroundColor Green
    } finally {
        Pop-Location
    }
} else {
    Write-Host ""
    Write-Host "[3/5] 跳过 Docker 镜像构建 (-NoBuild)" -ForegroundColor Gray
}

# 运行构建
if (-not $NoRun) {
    Write-Host ""
    Write-Host "[4/5] 运行 WASM 构建 (约需 5-10 分钟)..." -ForegroundColor Yellow
    
    # Windows 路径转换为 Docker 挂载格式
    $OutputDirDocker = $OutputDir -replace '\\', '/' -replace '^([A-Za-z]):', '/$1'
    # 对于 Docker Desktop on Windows, 使用 Windows 路径格式
    $OutputDirMount = $OutputDir
    
    docker run --rm -v "${OutputDirMount}:/output" sherpa-onnx-wasm-kokoro
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ✗ WASM 构建失败!" -ForegroundColor Red
        exit 1
    }
    Write-Host "  ✓ WASM 构建成功" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[4/5] 跳过 WASM 构建 (-NoRun)" -ForegroundColor Gray
}

# 检查构建产物
Write-Host ""
Write-Host "[5/5] 检查构建产物..." -ForegroundColor Yellow

$RequiredFiles = @(
    "sherpa-onnx-wasm-main-tts.js",
    "sherpa-onnx-wasm-main-tts.wasm",
    "sherpa-onnx-wasm-main-tts.data",
    "sherpa-onnx-tts.js"
)

$AllFilesExist = $true
foreach ($file in $RequiredFiles) {
    $filePath = Join-Path $OutputDir $file
    if (Test-Path $filePath) {
        $size = (Get-Item $filePath).Length / 1MB
        Write-Host "  ✓ $file ($([math]::Round($size, 2)) MB)" -ForegroundColor Green
    } else {
        Write-Host "  ✗ $file 未找到" -ForegroundColor Red
        $AllFilesExist = $false
    }
}

if (-not $AllFilesExist) {
    Write-Host ""
    Write-Host "构建产物不完整，请检查构建日志。" -ForegroundColor Red
    exit 1
}

# 部署到 web/public
if ($Deploy) {
    Write-Host ""
    Write-Host "[额外] 部署到前端项目..." -ForegroundColor Yellow
    
    if (Test-Path $WebPublicDir) {
        Remove-Item -Recurse -Force $WebPublicDir
    }
    New-Item -ItemType Directory -Path $WebPublicDir -Force | Out-Null
    
    Copy-Item -Path "$OutputDir\*" -Destination $WebPublicDir -Recurse
    Write-Host "  ✓ 已部署到: $WebPublicDir" -ForegroundColor Green
}

# 完成
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "构建完成!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "构建产物位置: $OutputDir" -ForegroundColor White
Write-Host ""
Write-Host "下一步操作:" -ForegroundColor Yellow
Write-Host "  1. 本地测试:"
Write-Host "     cd $OutputDir"
Write-Host "     python -m http.server 8080"
Write-Host "     # 浏览器访问 http://localhost:8080"
Write-Host ""
Write-Host "  2. 部署到前端项目:"
Write-Host "     .\build-wasm-tts.ps1 -NoBuild -NoRun -Deploy"
Write-Host "     # 或手动复制:"
Write-Host "     Copy-Item -Recurse $OutputDir\* $WebPublicDir"
Write-Host ""
