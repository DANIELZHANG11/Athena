#!/bin/bash
# Calibre 容器自定义初始化脚本
# 在后台启动格式转换监控器

echo "[custom-init] Starting Calibre convert watcher..."

# 确保脚本有执行权限
chmod +x /scripts/convert-watcher.sh

# 在后台运行 watcher
nohup /scripts/convert-watcher.sh > /config/logs/convert-watcher.log 2>&1 &

echo "[custom-init] Convert watcher started in background (PID: $!)"
echo "[custom-init] Log file: /config/logs/convert-watcher.log"
