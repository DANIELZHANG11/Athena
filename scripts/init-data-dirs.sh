#!/bin/bash
# =========================================================================
# Athena 数据目录初始化脚本
# =========================================================================
# 功能：
# 1. 创建 SSD 上的高性能数据目录
# 2. 创建 HDD (bcache) 上的大容量数据目录
# 3. 设置正确的权限
# =========================================================================

set -e

echo "=========================================="
echo "Athena 数据目录初始化"
echo "=========================================="

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 检查是否在 Athena 项目根目录
if [ ! -f "docker-compose.yml" ]; then
    echo -e "${RED}错误: 请在 Athena 项目根目录运行此脚本${NC}"
    exit 1
fi

# 获取当前用户
CURRENT_USER=$(whoami)
CURRENT_UID=$(id -u)
CURRENT_GID=$(id -g)

echo -e "${YELLOW}当前用户: $CURRENT_USER (UID: $CURRENT_UID, GID: $CURRENT_GID)${NC}"
echo ""

# =========================================================================
# 1. 创建 SSD 上的高性能数据目录
# =========================================================================
echo -e "${GREEN}[1/3] 创建 SSD 数据目录...${NC}"

SSD_BASE="/home/vitiana/Athena/data_ssd"
SSD_DIRS=(
    "$SSD_BASE/postgres"
    "$SSD_BASE/valkey"
    "$SSD_BASE/opensearch"
    "$SSD_BASE/hf_cache"
)

for dir in "${SSD_DIRS[@]}"; do
    if [ ! -d "$dir" ]; then
        mkdir -p "$dir"
        echo "  ✓ 创建: $dir"
    else
        echo "  - 已存在: $dir"
    fi
done

# 设置 SSD 目录权限
chown -R $CURRENT_USER:$CURRENT_USER "$SSD_BASE"
chmod -R 755 "$SSD_BASE"
echo -e "${GREEN}  ✓ SSD 目录权限设置完成${NC}"
echo ""

# =========================================================================
# 2. 创建 HDD (bcache) 上的大容量数据目录
# =========================================================================
echo -e "${GREEN}[2/3] 创建 HDD (bcache) 数据目录...${NC}"

HDD_BASE="/data/athena"
HDD_DIRS=(
    "$HDD_BASE/seaweed"
    "$HDD_BASE/calibre_books"
    "$HDD_BASE/calibre_config"
    "$HDD_BASE/tolgee"
    "$HDD_BASE/nginx_logs"
)

for dir in "${HDD_DIRS[@]}"; do
    if [ ! -d "$dir" ]; then
        sudo mkdir -p "$dir"
        echo "  ✓ 创建: $dir"
    else
        echo "  - 已存在: $dir"
    fi
done

# 设置 HDD 目录权限
sudo chown -R $CURRENT_USER:$CURRENT_USER "$HDD_BASE"
sudo chmod -R 755 "$HDD_BASE"
echo -e "${GREEN}  ✓ HDD 目录权限设置完成${NC}"
echo ""

# =========================================================================
# 3. 显示磁盘空间信息
# =========================================================================
echo -e "${GREEN}[3/3] 磁盘空间信息${NC}"
echo ""
echo "SSD (系统盘):"
df -h / | tail -1
echo ""
echo "HDD (bcache):"
df -h /data | tail -1
echo ""

# =========================================================================
# 4. 显示目录结构
# =========================================================================
echo -e "${GREEN}数据目录结构:${NC}"
echo ""
echo "高性能存储 (SSD):"
tree -L 2 "$SSD_BASE" 2>/dev/null || ls -lh "$SSD_BASE"
echo ""
echo "大容量存储 (HDD bcache):"
tree -L 2 "$HDD_BASE" 2>/dev/null || ls -lh "$HDD_BASE"
echo ""

# =========================================================================
# 完成
# =========================================================================
echo -e "${GREEN}=========================================="
echo "✓ 数据目录初始化完成！"
echo "==========================================${NC}"
echo ""
echo -e "${YELLOW}存储策略说明:${NC}"
echo "  • SSD (932 MB/s, 11.2K IOPS):"
echo "    - PostgreSQL: 数据库事务日志"
echo "    - OpenSearch: 全文索引"
echo "    - Valkey: Redis 持久化"
echo "    - HF Cache: 模型缓存"
echo ""
echo "  • HDD bcache (575 MB/s, SSD 缓存加速):"
echo "    - SeaweedFS: 对象存储"
echo "    - Calibre: 电子书库"
echo "    - Tolgee: 翻译数据库"
echo "    - Nginx Logs: 日志文件"
echo ""
echo -e "${YELLOW}下一步:${NC}"
echo "  1. 检查配置: cat .env"
echo "  2. 启动服务: docker-compose up -d"
echo "  3. 查看日志: docker-compose logs -f"
echo ""
