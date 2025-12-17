#!/bin/bash
# Athena Android 开发环境启动脚本
# 用法: ./START_ANDROID_DEV.sh

set -e

export ANDROID_HOME=/home/vitiana/android-sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator

echo "🚀 启动 Athena Android 开发环境..."
echo ""

# 1. 检查 Vite 开发服务器
if pgrep -f "vite" > /dev/null; then
    echo "✅ Vite 开发服务器已运行"
else
    echo "⚠️  Vite 未运行，请在另一个终端执行："
    echo "   cd /home/vitiana/Athena/web && pnpm dev"
    exit 1
fi

# 2. 启动模拟器（后台无界面模式）
echo ""
echo "📱 启动 Android 模拟器..."
if adb devices | grep -q "emulator"; then
    echo "✅ 模拟器已运行"
else
    nohup $ANDROID_HOME/emulator/emulator -avd athena_emulator \
        -no-window -no-audio -gpu swiftshader_indirect \
        > /tmp/emulator.log 2>&1 &
    
    echo "⏳ 等待模拟器启动 (30秒)..."
    sleep 30
fi

# 3. 检查模拟器状态
echo ""
echo "📊 模拟器状态："
adb devices

# 4. 构建并部署应用
echo ""
echo "🔨 构建并部署应用到模拟器..."
npx cap sync android
npx cap run android &

# 5. 启动屏幕镜像
echo ""
echo "🖥️  启动屏幕镜像 (scrcpy)..."
sleep 10
scrcpy --window-title "Athena Reader" --window-x 100 --window-y 100 &

echo ""
echo "✨ 开发环境已就绪！"
echo ""
echo "📱 Android 屏幕已通过 scrcpy 镜像到窗口"
echo "🌐 Web 版本: http://192.168.0.122:48173/"
echo "🔍 Chrome 调试: chrome://inspect (需 SSH 端口转发)"
echo ""
echo "💡 修改代码后会自动热加载到模拟器！"
echo ""
echo "📝 查看日志："
echo "   - 模拟器日志: tail -f /tmp/emulator.log"
echo "   - 应用日志: adb logcat | grep -i capacitor"
