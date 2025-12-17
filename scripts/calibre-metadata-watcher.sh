#!/bin/bash
# Calibre 元数据提取监控器
# 监听 metadata_requests 目录，使用 ebook-meta 提取元数据和封面
# 支持 MOBI, AZW3, FB2, LRF 等非 EPUB/PDF 格式

WATCH_DIR="/books"
LOG_FILE="/books/metadata.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S'): $1" >> "$LOG_FILE"
    echo "$(date '+%Y-%m-%d %H:%M:%S'): $1"
}

log "Calibre Metadata Watcher started"

# 确保目录存在
mkdir -p "$WATCH_DIR"

# 处理单个元数据请求
process_request() {
    local request_file="$1"
    local job_id=$(basename "$request_file" .metadata.request)
    
    log "Processing metadata request: $job_id"
    
    # 读取请求文件内容
    # 格式: 第一行是输入文件路径，第二行是封面输出路径
    local input_path=$(sed -n '1p' "$request_file")
    local cover_output=$(sed -n '2p' "$request_file")
    # job_id 已经包含 "metadata-" 前缀，所以直接使用
    local metadata_output="/books/${job_id}.txt"
    local done_file="/books/${job_id}.done"
    local error_file="/books/${job_id}.error"
    
    log "Input: $input_path, Cover: $cover_output"
    
    if [[ ! -f "$input_path" ]]; then
        log "ERROR: Input file not found: $input_path"
        echo "Input file not found" > "$error_file"
        rm -f "$request_file"
        return
    fi
    
    # 执行 ebook-meta 提取元数据
    if ebook-meta "$input_path" > "$metadata_output" 2>&1; then
        log "Metadata extracted successfully"
    else
        log "WARNING: Metadata extraction returned error, but continuing..."
    fi
    
    # 提取封面
    if [[ -n "$cover_output" ]]; then
        if ebook-meta "$input_path" --get-cover="$cover_output" 2>&1; then
            if [[ -f "$cover_output" ]] && [[ -s "$cover_output" ]]; then
                log "Cover extracted: $cover_output ($(stat -c%s "$cover_output") bytes)"
            else
                log "WARNING: Cover file empty or not created"
            fi
        else
            log "WARNING: Cover extraction failed"
        fi
    fi
    
    # 创建完成标志
    touch "$done_file"
    log "Done: $job_id"
    
    # 删除请求文件
    rm -f "$request_file"
}

# 主循环：轮询监听请求
while true; do
    for request_file in "$WATCH_DIR"/*.metadata.request; do
        if [[ -f "$request_file" ]]; then
            process_request "$request_file"
        fi
    done
    sleep 1
done
