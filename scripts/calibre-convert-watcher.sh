#!/bin/bash
# Calibre 转换监控脚本
# 此脚本在 Calibre 容器中运行，监控 /books 目录中的转换请求

WATCH_DIR="/books"
echo "Starting Calibre convert watcher on $WATCH_DIR"

while true; do
    # 查找所有 .request 文件
    for request_file in "$WATCH_DIR"/convert-*.request; do
        [ -e "$request_file" ] || continue
        
        job_id=$(basename "$request_file" | sed 's/convert-\(.*\)\.request/\1/')
        echo "Processing job: $job_id"
        
        # 读取输入和输出路径
        input_path=$(sed -n '1p' "$request_file")
        output_path=$(sed -n '2p' "$request_file")
        
        echo "Input: $input_path"
        echo "Output: $output_path"
        
        # 执行转换
        if ebook-convert "$input_path" "$output_path" --no-default-epub-cover 2>/tmp/convert-error-$job_id.txt; then
            echo "Conversion succeeded: $job_id"
            touch "$WATCH_DIR/convert-$job_id.done"
        else
            echo "Conversion failed: $job_id"
            mv /tmp/convert-error-$job_id.txt "$WATCH_DIR/convert-$job_id.error"
        fi
        
        # 删除请求文件
        rm -f "$request_file"
        
        # 清理输入文件
        rm -f "$input_path"
    done
    
    # 每 2 秒检查一次
    sleep 2
done
