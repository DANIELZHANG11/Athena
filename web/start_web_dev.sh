#!/bin/bash
# Athena Web 开发服务器启动脚本
# 用法: ./start_web_dev.sh

set -e

WEB_DIR="/home/vitiana/Athena/web"
PID_FILE="/tmp/athena-vite.pid"
LOG_FILE="/tmp/vite.log"

cd "$WEB_DIR"

# 检查是否已经在运行
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if ps -p "$OLD_PID" > /dev/null 2>&1; then
        echo "✅ Vite 开发服务器已在运行 (PID: $OLD_PID)"
        echo "🌐 访问地址: http://192.168.0.122:48173/"
        exit 0
    else
        rm -f "$PID_FILE"
    fi
fi

# 启动 Vite 开发服务器
echo "🚀 启动 Vite 开发服务器..."
nohup pnpm dev > "$LOG_FILE" 2>&1 &
VITE_PID=$!

# 保存 PID
echo "$VITE_PID" > "$PID_FILE"

# 等待服务器启动
echo "⏳ 等待服务器就绪..."
for i in {1..15}; do
    sleep 1
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:48173/ | grep -q "200"; then
        echo "✅ Vite 开发服务器启动成功！"
        echo ""
        echo "📱 访问地址："
        echo "   本地: http://localhost:48173/"
        echo "   局域网: http://192.168.0.122:48173/"
        echo ""
        echo "💡 提示："
        echo "   - 按 F12 打开开发者工具"
        echo "   - Ctrl+Shift+M 切换移动设备模式"
        echo "   - 修改代码会自动热加载"
        echo ""
        echo "📝 查看日志: tail -f $LOG_FILE"
        echo "🛑 停止服务: kill $(cat $PID_FILE)"
        exit 0
    fi
    echo -n "."
done

echo ""
echo "❌ 服务器启动失败，查看日志："
tail -20 "$LOG_FILE"
rm -f "$PID_FILE"
exit 1
