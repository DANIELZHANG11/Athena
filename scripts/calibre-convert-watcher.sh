#!/bin/bash
# Calibre 转换监控器
# 监听 .request 文件并执行 ebook-convert 转换
# 支持将 MOBI, AZW3, FB2 等格式转换为 EPUB

WATCH_DIR="/books"
LOG_FILE="/books/convert.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S'): $1" >> "$LOG_FILE"
    echo "$(date '+%Y-%m-%d %H:%M:%S'): $1"
}

log "Calibre Convert Watcher started"

# 处理单个转换请求
process_request() {
    local request_file="$1"
    local job_id=$(basename "$request_file" .request)
    job_id="${job_id#convert-}"  # 移除 convert- 前缀
    
    log "Processing conversion request: $job_id"
    
    # 读取请求文件内容
    # 格式: 第一行是输入文件路径，第二行是输出文件路径
    local input_path=$(sed -n '1p' "$request_file")
    local output_path=$(sed -n '2p' "$request_file")
    local done_file="/books/convert-${job_id}.done"
    local error_file="/books/convert-${job_id}.error"
    
    log "Input: $input_path -> Output: $output_path"
    
    if [[ ! -f "$input_path" ]]; then
        log "ERROR: Input file not found: $input_path"
        echo "Input file not found: $input_path" > "$error_file"
        rm -f "$request_file"
        return
    fi
    
    # 执行 ebook-convert
    log "Starting conversion..."
    if ebook-convert "$input_path" "$output_path" >> "$LOG_FILE" 2>&1; then
        if [[ -f "$output_path" ]] && [[ -s "$output_path" ]]; then
            log "Conversion successful: $(stat -c%s "$output_path") bytes"
            touch "$done_file"
        else
            log "ERROR: Output file empty or not created"
            echo "Output file empty or not created" > "$error_file"
        fi
    else
        log "ERROR: ebook-convert failed"
        echo "ebook-convert command failed" > "$error_file"
    fi
    
    # 删除请求文件
    rm -f "$request_file"
    
    # 清理输入文件（转换完成后不再需要）
    rm -f "$input_path"
}

# 主循环：轮询监听请求
log "Watching for .request files in $WATCH_DIR"
while true; do
    for request_file in "$WATCH_DIR"/convert-*.request; do
        if [[ -f "$request_file" ]]; then
            process_request "$request_file"
        fi
    done
    sleep 2
done
