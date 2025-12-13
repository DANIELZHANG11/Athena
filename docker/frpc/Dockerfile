# Athena FRP 客户端 Dockerfile
FROM zukubq0aouv2k2.xuanyuan.run/snowdreamtech/frpc:0.64.0

# 安装 bash 用于脚本
RUN apk add --no-cache bash tzdata

# 设置时区
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# 创建配置目录
RUN mkdir -p /etc/frp

# 健康检查（检查进程是否运行）
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ps aux | grep frpc | grep -v grep || exit 1

# 启动 FRP 客户端
CMD ["frpc", "-c", "/etc/frp/frpc.toml"]
