import os

# ================= 配置区域 (针对雅典娜项目优化) =================

OUTPUT_FILE = 'project_context_optimized.txt'

# 核心源码目录 (白名单)
# 脚本会把路径统一转换为 "/" 进行比对，所以这里用 "/" 即可
CORE_DIRS = [
    'web/src',          
    'api/app',          
    'contracts',        
    'scripts',          
    'docker', 
    'alembic' # 经常会有数据库迁移脚本在这里
]

# 必须包含的关键配置文件
CRITICAL_CONFIG_FILES = {
    'package.json', 'tsconfig.json', 'vite.config.ts', 'next.config.js',
    'pyproject.toml', 'requirements.txt', 'Dockerfile', 'docker-compose.yml',
    '.env.example', 'alembic.ini'
}

# 绝对排除的目录 (黑名单)
IGNORE_DIRS = {
    'node_modules', 'venv', '.venv', 'env', '__pycache__', 
    '.git', '.idea', '.vscode', '.next', 'dist', 'build', 
    'coverage', 'htmlcov', 
    'web/public', 'docs'
}

# 允许的文件后缀
ALLOWED_EXTENSIONS = {
    '.ts', '.tsx', '.js', '.jsx', '.css', '.scss', # 前端
    '.py', # 后端
    '.yml', '.yaml', '.json', '.toml', '.sh', '.ps1', '.sql', '.ini' # 配置
}

# 忽略的文件后缀
IGNORE_EXTENSIONS = {
    '.lock', '-lock.json', '.map', '.min.js', 
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', 
    '.pdf', '.pyc', '.exe', '.dll', '.so'
}

# 熔断限制
MAX_FILE_SIZE_KB = 200       
MAX_TOTAL_OUTPUT_MB = 5.0    

# =================================================================

def normalize_path(path):
    """
    将路径统一转换为 POSIX 风格 (forward slashes)，并去除开头的 ./
    例如: .\\web\\src\\App.tsx -> web/src/App.tsx
    """
    # 1. 替换反斜杠
    p = path.replace('\\', '/')
    # 2. 去除开头的 ./
    if p.startswith('./'):
        p = p[2:]
    return p

def is_relevant(clean_path):
    """判断标准化后的路径是否需要"""
    parts = clean_path.split('/')
    filename = parts[-1]
    ext = os.path.splitext(filename)[1].lower()

    # 1. 检查是否在忽略目录中 (检查路径中的每一层)
    for part in parts:
        if part in IGNORE_DIRS:
            return False

    # 2. 检查关键配置文件 (优先级最高)
    if filename in CRITICAL_CONFIG_FILES:
        return True
    
    # 3. 排除锁文件
    if filename.endswith('.lock') or 'lock' in filename:
        return False
    if ext in IGNORE_EXTENSIONS:
        return False

    # 4. 检查是否在核心目录中
    # 只要 clean_path 以任何一个 CORE_DIRS 开头即可
    in_core_dir = False
    for core in CORE_DIRS:
        if clean_path.startswith(core):
            in_core_dir = True
            break
    
    if not in_core_dir:
        # 如果不在核心目录，也不在关键配置文件里，跳过
        return False

    # 5. 最后检查后缀
    return ext in ALLOWED_EXTENSIONS

def pack_project():
    current_size = 0
    file_count = 0
    
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as outfile:
        # --- 步骤 1: 生成精简的目录树 ---
        outfile.write("Directory Structure:\n")
        for root, dirs, files in os.walk('.'):
            # 过滤掉忽略的目录，防止 os.walk 进入
            dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
            
            level = root.replace('.', '').count(os.sep)
            indent = ' ' * 4 * level
            outfile.write(f"{indent}{os.path.basename(root)}/\n")
        
        outfile.write("\n" + "="*50 + "\n\n")

        # --- 步骤 2: 提取核心代码 ---
        for root, dirs, files in os.walk('.'):
            dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
            
            for file in files:
                file_path = os.path.join(root, file)
                
                # *** 关键修复：标准化路径 ***
                clean_path = normalize_path(file_path)
                
                # 过滤逻辑
                if not is_relevant(clean_path):
                    continue
                
                # 熔断检查
                if current_size > MAX_TOTAL_OUTPUT_MB * 1024 * 1024:
                    outfile.write(f"\n\n[STOPPED] Global size limit ({MAX_TOTAL_OUTPUT_MB}MB) reached.\n")
                    print(f"⚠️ 达到总大小限制 ({MAX_TOTAL_OUTPUT_MB}MB)，停止导出。")
                    return

                try:
                    fsize = os.path.getsize(file_path)
                    if fsize > MAX_FILE_SIZE_KB * 1024:
                        print(f"Skipping large file: {clean_path} ({fsize/1024:.1f} KB)")
                        continue

                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                        
                        # 针对 JSON 做截断
                        if file_path.endswith('.json'):
                            lines = content.splitlines()
                            if len(lines) > 50:
                                content = "\n".join(lines[:50]) + "\n... (JSON truncated) ..."

                        header = f"\n\n{'='*50}\nFILE_PATH: {clean_path}\n{'='*50}\n\n"
                        outfile.write(header + content)
                        
                        current_size += len(header) + len(content)
                        file_count += 1
                        # 打印进度 (每10个文件显示一次，避免刷屏)
                        if file_count % 10 == 0:
                            print(f"Packed {file_count} files...", end='\r')

                except Exception as e:
                    print(f"Error reading {clean_path}: {e}")

    print(f"\n✅ 完成！核心代码已导出至: {OUTPUT_FILE}")
    print(f"📊 文件数量: {file_count}")
    print(f"📦 文件大小: {os.path.getsize(OUTPUT_FILE)/1024/1024:.2f} MB")

if __name__ == '__main__':
    pack_project()