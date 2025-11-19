import os

# --- 1. 针对你项目的“黑名单”配置 ---
IGNORE_DIRS = {
    # 你的罪魁祸首在这里：
    '.mypy_cache', '.pytest_cache', '.git', 
    # 常规忽略：
    'node_modules', '__pycache__', 'dist', 'build', '.next', 
    '.idea', '.vscode', 'venv', 'env', 'target', 'coverage'
}

IGNORE_EXTS = {
    # 图片、二进制、压缩包
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', 
    '.exe', '.pyc', '.dll', '.so', '.o', 
    # 字体、数据文件
    '.map', '.svg', '.eot', '.ttf', '.woff', '.woff2', 
    '.log', '.csv', '.sql', '.db', '.sqlite', '.xlsx',
    # 巨大的缓存数据 (你的扫描结果里看到的那些)
    '.data.json' 
}

IGNORE_FILES = {
    # 锁文件
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock',
    # 脚本本身
    'project_context_for_ai.txt', 'pack_code.py', 'check_size.py', 'pack_code_final.py'
}

OUTPUT_FILE = 'project_context_for_ai.txt'

# --- 2. 安全熔断配置 (即使漏网之鱼也不会撑爆) ---
MAX_FILE_SIZE_KB = 50      # 单个文件超过 50KB 就不读了（你的文档270KB，会被跳过，建议单独发）
MAX_LINES_PER_FILE = 400   # 每个文件最多读前 400 行
MAX_TOTAL_OUTPUT_MB = 2.0  # 输出总文件不超过 2MB

def pack_project():
    current_output_size = 0
    skipped_count = 0
    
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as outfile:
        # 1. 写入精简版目录结构
        outfile.write("Project Directory Structure:\n")
        for root, dirs, files in os.walk('.'):
            dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
            level = root.replace('.', '').count(os.sep)
            indent = ' ' * 4 * level
            outfile.write(f"{indent}{os.path.basename(root)}/\n")
        outfile.write("\n" + "="*50 + "\n\n")

        # 2. 遍历文件内容
        for root, dirs, files in os.walk('.'):
            dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
            
            for file in files:
                # 全局大小熔断
                if current_output_size > MAX_TOTAL_OUTPUT_MB * 1024 * 1024:
                    outfile.write(f"\n\n[STOPPED] Total size limit ({MAX_TOTAL_OUTPUT_MB}MB) reached.\n")
                    break

                if file in IGNORE_FILES: continue
                ext = os.path.splitext(file)[1].lower()
                if ext in IGNORE_EXTS: continue
                
                file_path = os.path.join(root, file)
                
                try:
                    file_size = os.path.getsize(file_path)
                    
                    # 大文件跳过 (比如你的雅典娜文档)
                    if file_size > MAX_FILE_SIZE_KB * 1024:
                        print(f"Skipping large file: {file_path} ({file_size/1024:.1f} KB)")
                        skipped_count += 1
                        continue
                    
                    # 读取内容 (带行数限制)
                    with open(file_path, 'r', encoding='utf-8') as f:
                        lines = []
                        for i, line in enumerate(f):
                            if i >= MAX_LINES_PER_FILE:
                                lines.append(f"\n... (File truncated, {MAX_LINES_PER_FILE}+ lines) ...\n")
                                break
                            lines.append(line)
                        
                        content = "".join(lines)
                        
                        header = f"\n\n{'='*50}\nFILE_PATH: {file_path}\n{'='*50}\n\n"
                        write_data = header + content
                        outfile.write(write_data)
                        current_output_size += len(write_data.encode('utf-8'))
                        
                except Exception:
                    pass # 忽略读取错误

    print(f"\n成功! 代码已打包至: {OUTPUT_FILE}")
    print(f"最终文件大小: {os.path.getsize(OUTPUT_FILE)/1024/1024:.2f} MB")
    if skipped_count > 0:
        print(f"已自动跳过 {skipped_count} 个超过 {MAX_FILE_SIZE_KB}KB 的大文件（这是好事，节省了Token）")

if __name__ == '__main__':
    pack_project()