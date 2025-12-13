# Athena 固定配置说明

本文档记录 Athena 项目中**不允许修改**的固定配置。

## 🌐 Docker 网络配置（固定）

### 网络名称
- **名称**: `athena-network`
- **说明**: Athena 项目专用 Docker 网络

### 网络参数（不可修改）
```yaml
networks:
  athena-network:
    driver: bridge
    ipam:
      driver: default
      config:
        - subnet: 172.20.0.0/16
          gateway: 172.20.0.1
```

### 配置说明
| 参数 | 值 | 说明 |
|------|-----|------|
| **网络驱动** | `bridge` | 桥接模式，容器间可通信 |
| **子网** | `172.20.0.0/16` | 固定网段，提供 65,534 个 IP 地址 |
| **网关** | `172.20.0.1` | 网关地址 |
| **IP 范围** | `172.20.0.2` - `172.20.255.254` | 可用 IP 地址范围 |

### 为什么固定网络配置？
1. **避免冲突**: 与 WxLibrary 的网络完全隔离
2. **配置稳定**: 容器重启后 IP 地址保持在同一网段
3. **防火墙规则**: 如需配置防火墙，网段固定便于管理
4. **故障排查**: 网络问题更容易定位

### 与其他项目网络隔离
| 项目 | 网络名称 | 网段 | 状态 |
|------|---------|------|------|
| **Athena** | `athena-network` | 172.20.0.0/16 | ✅ 固定 |
| **WxLibrary** | `wx_library_net` | 默认分配 | - |
| **系统默认** | `bridge` | 172.17.0.0/16 | Docker 默认 |

**冲突检测**: ✅ 无冲突，Athena 使用 172.20.x.x 网段

---

## 💾 数据卷路径（固定）

### SSD 高性能存储
**基础路径**: `/home/vitiana/Athena/data_ssd/`

| 卷名 | 路径 | 用途 | 预计大小 |
|------|------|------|---------|
| `pg_data` | `/home/vitiana/Athena/data_ssd/postgres` | PostgreSQL 数据库 | 10-50 GB |
| `valkey_data` | `/home/vitiana/Athena/data_ssd/valkey` | Redis 持久化 | 1-5 GB |
| `opensearch_data` | `/home/vitiana/Athena/data_ssd/opensearch` | 搜索索引 | 20-100 GB |
| `hf_cache` | `/home/vitiana/Athena/data_ssd/hf_cache` | HuggingFace 模型 | 5-10 GB |

### HDD 大容量存储（bcache 加速）
**基础路径**: `/data/athena/`

| 卷名 | 路径 | 用途 | 预计大小 |
|------|------|------|---------|
| `seaweed_data` | `/data/athena/seaweed` | 对象存储 | 100-500 GB |
| `calibre_books` | `/data/athena/calibre_books` | 电子书库 | 50-200 GB |
| `calibre_config` | `/data/athena/calibre_config` | Calibre 配置 | < 1 GB |
| `tolgee_postgres_data` | `/data/athena/tolgee` | 翻译数据库 | 1-5 GB |
| `nginx_logs` | `/data/athena/nginx_logs` | Nginx 日志（生产） | 1-10 GB |

### 为什么固定数据卷路径？
1. **性能优化**: SSD 和 HDD 分离，根据数据特性优化存储
2. **备份策略**: 固定路径便于自动备份脚本
3. **容量管理**: 便于监控磁盘使用情况
4. **故障恢复**: 数据位置固定，恢复更简单

---

## 🔒 修改限制说明

### ❌ 禁止修改的配置
以下配置**禁止修改**，修改可能导致系统故障：

1. **Docker 网络**
   - 网络名称: `athena-network`
   - 子网: `172.20.0.0/16`
   - 网关: `172.20.0.1`

2. **数据卷基础路径**
   - SSD 路径: `/home/vitiana/Athena/data_ssd/`
   - HDD 路径: `/data/athena/`

3. **数据卷绑定配置**
   - 所有数据卷必须使用 `type: none` + `o: bind` 方式绑定
   - 不允许使用 Docker managed volumes

### ✅ 允许修改的配置
以下配置可以根据需要调整：

1. **端口映射**
   - 外部端口可以修改（建议保持 4XXXX 段）
   - 内部端口不建议修改

2. **容器资源限制**
   - CPU 限制
   - 内存限制
   - GPU 资源分配

3. **环境变量**
   - 密码和密钥
   - 服务配置参数

---

## 🔧 初始化脚本

数据卷路径在首次部署时通过 `scripts/init-data-dirs.sh` 脚本创建：

```bash
# 执行初始化（只需首次运行）
cd /home/vitiana/Athena
./scripts/init-data-dirs.sh
```

该脚本会：
1. 创建 SSD 数据目录 (`/home/vitiana/Athena/data_ssd/`)
2. 创建 HDD 数据目录 (`/data/athena/`)
3. 设置正确的目录权限（当前用户所有）
4. 验证磁盘空间

---

## 📋 验证配置

### 验证网络配置
```bash
# 查看 Athena 网络
docker network inspect athena-network

# 应该看到：
# "Subnet": "172.20.0.0/16"
# "Gateway": "172.20.0.1"
```

### 验证数据卷路径
```bash
# 检查 SSD 目录
ls -la /home/vitiana/Athena/data_ssd/

# 检查 HDD 目录
sudo ls -la /data/athena/

# 检查磁盘空间
df -h /home/vitiana/Athena/data_ssd
df -h /data/athena
```

### 验证容器网络
```bash
# 启动服务后检查容器 IP
docker compose ps -q | xargs docker inspect -f '{{.Name}} - {{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'

# 所有 IP 应该在 172.20.0.0/16 网段内
```

---

## ⚠️ 故障处理

### 如果不小心修改了网络配置
```bash
# 1. 停止所有服务
docker compose down

# 2. 删除旧网络
docker network rm athena-network

# 3. 重新启动（会自动创建正确的网络）
docker compose up -d

# 4. 验证网络配置
docker network inspect athena-network
```

### 如果数据卷路径丢失
```bash
# 1. 重新运行初始化脚本
./scripts/init-data-dirs.sh

# 2. 如果有备份，恢复数据
# SSD 数据
cp -r /path/to/backup/data_ssd/* /home/vitiana/Athena/data_ssd/

# HDD 数据
sudo cp -r /path/to/backup/athena/* /data/athena/

# 3. 设置权限
chown -R vitiana:vitiana /home/vitiana/Athena/data_ssd/
sudo chown -R vitiana:vitiana /data/athena/

# 4. 重启服务
docker compose up -d
```

---

## 📚 相关文档

- **部署文档**: `雅典娜开发技术文档汇总/07 - 部署与 SRE 手册DevOps_and_SRE_Manual.md`
- **快速参考**: `DEPLOYMENT_QUICKREF.md`
- **Docker Compose**: `docker-compose.yml`, `docker-compose.prod.yml`

---

**最后更新**: 2025-12-14  
**版本**: v1.0  
**维护者**: Athena 开发团队
