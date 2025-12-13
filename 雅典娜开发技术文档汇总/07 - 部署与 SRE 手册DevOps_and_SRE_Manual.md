# 07_DevOps_and_SRE_Manual.md

> **版本**：v1.1 (App-First Edition)
> **最后更新**：2025-12-13
> **定位**：部署、监控、CI/CD 与灾难恢复手册。

## 1. 本地开发环境 (Local Development)

### 1.1 快速启动
基于 `docker-compose.yml` 的一键启动方案，适用于开发与测试。

*   **前置依赖**：
    *   Docker Desktop (Windows/Mac) 或 OrbStack
    *   Git
    *   nvidia-docker (GPU支持，用于 OCR 和 Embedding 模型)
*   **初始化数据目录**：
    ```bash
    # 首次运行前，执行数据目录初始化脚本
    # 该脚本会创建 SSD 和 HDD 上的数据目录
    ./scripts/init-data-dirs.sh
    ```
*   **启动命令**：
    ```bash
    # 拉取最新代码
    git pull origin main
    
    # 启动所有服务 (后台运行)
    docker compose up -d
    
    # 查看服务状态
    docker compose ps
    
    # 查看实时日志 (例如 api 服务)
    docker compose logs -f api
    ```
*   **服务访问地址** (端口段: 4XXXX，避免冲突)：
    *   **Web App**: [http://localhost:48173](http://localhost:48173) (需单独启动前端 `pnpm dev`)
    *   **Traefik 入口**: [http://localhost:48080](http://localhost:48080)
    *   **API Server**: [http://localhost:48000](http://localhost:48000)
    *   **API Docs (Swagger)**: [http://localhost:48000/docs](http://localhost:48000/docs)
    *   **SeaweedFS S3**: [http://localhost:48333](http://localhost:48333)
    *   **SeaweedFS Admin**: [http://localhost:48888](http://localhost:48888)
    *   **OpenSearch**: [http://localhost:49200](http://localhost:49200)
    *   **PowerSync**: [http://localhost:48090](http://localhost:48090)
    *   **Tolgee**: [http://localhost:48085](http://localhost:48085)
    *   **Calibre UI**: [http://localhost:48081](http://localhost:48081)
    *   **Calibre Web**: [http://localhost:48082](http://localhost:48082)

### 1.2 常用运维命令
```bash
# 重启特定服务
docker compose restart api worker

# 进入数据库容器
docker compose exec postgres psql -U athena -d athena

# 手动触发备份
docker compose run --rm backup

# 查看容器资源使用情况
docker stats

# 查看数据目录磁盘使用
df -h /home/vitiana/Athena/data_ssd  # SSD 高性能数据
df -h /data/athena                    # HDD bcache 大容量数据

# 清理未使用的镜像和容器
docker system prune -a
```

### 1.3 存储架构说明

Athena 采用 **SSD + HDD (bcache) 混合存储方案**，根据数据访问特性优化性能和成本。

#### 存储性能测试结果
| 存储类型 | 顺序写入 | 随机读 4K IOPS | 用途 |
|---------|---------|---------------|------|
| **NVMe SSD** (系统盘) | 932 MB/s | 11,200 IOPS | 高频随机读写 |
| **bcache** (/data) | 575 MB/s | - | 大容量顺序读写 |

#### 数据分布策略

**高性能存储 (SSD)**: `/home/vitiana/Athena/data_ssd/`
- **PostgreSQL** (`pg_data`): 数据库事务日志，IOPS 敏感
- **OpenSearch** (`opensearch_data`): 全文索引，查询性能要求高  
- **Valkey/Redis** (`valkey_data`): AOF 持久化，写入频繁
- **HuggingFace Cache** (`hf_cache`): 模型加载时间敏感

**大容量存储 (bcache HDD)**: `/data/athena/`
- **SeaweedFS** (`seaweed_data`): 对象存储，大文件存储
- **Calibre** (`calibre_books`, `calibre_config`): 电子书库
- **Tolgee** (`tolgee_postgres_data`): 低频访问的翻译数据库
- **Nginx Logs** (`nginx_logs`): 日志文件

#### bcache 加速机制
- **缓存模式**: writearound (写入直达 HDD，读取通过 SSD 缓存)
- **缓存层**: 238.5 GB NVMe SSD
- **存储层**: 5.5 TB HDD (LSI MegaRAID 9271-8i)
- **性能**: 热数据读取接近 SSD 速度，大容量冷数据成本低

### 1.4 PowerSync Service (App-First 同步引擎)

> @see `09 - APP-FIRST架构改造计划.md` - Phase 1

PowerSync 是 App-First 架构的核心同步引擎，负责在客户端 SQLite 和服务端 PostgreSQL 之间进行实时双向同步。

| 项目 | 配置 |
| :--- | :--- |
| **服务名** | `powersync` |
| **镜像** | `journeyapps/powersync-service:latest` |
| **端口** | `48090` (WebSocket/HTTP)，`49091` (Prometheus 指标) |
| **配置文件** | `docker/powersync/powersync.yaml`, `docker/powersync/sync_rules.yaml` |
| **依赖** | PostgreSQL (直连，不经过 PgBouncer) |
| **日志** | JSON 输出，采集至 Loki |

#### 环境变量

| 变量 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `POWERSYNC_PORT` | 服务端口 | `48090` |
| `POWERSYNC_DATABASE_URL` | PostgreSQL 连接串 | - |
| `POWERSYNC_JWT_SECRET` | JWT 验证密钥 | - |
| `POWERSYNC_UPLOAD_ENABLED` | 是否允许客户端写入 | `true` |
| `POWERSYNC_LOG_LEVEL` | 日志级别 | `info` |

#### 本地启动

```bash
# 单独启动 PowerSync
docker compose up -d powersync

# 查看日志
docker compose logs -f powersync
```

#### 配置文件说明

**`docker/powersync/powersync.yaml`** - 服务主配置:
- 数据库连接
- JWT 认证设置
- 日志与指标配置

**`docker/powersync/sync_rules.yaml`** - 同步规则:
- 定义哪些表同步到客户端
- 行级过滤 (RLS)
- 冲突解决策略

#### 健康检查

```bash
# 健康状态
curl http://localhost:48090/health

# Prometheus 指标
curl http://localhost:49091/metrics | grep powersync

# 关键指标
# - powersync_active_connections: 活跃客户端数
# - powersync_sync_lag_ms: 同步延迟
# - powersync_upload_queue_size: 上传队列大小
```

#### 同步规则更新流程

1. 修改 `docker/powersync/sync_rules.yaml`
2. 重启 PowerSync 服务: `docker compose restart powersync`
3. 客户端会自动检测规则版本变化并重新同步

#### 故障排查

| 问题 | 排查步骤 |
| :--- | :--- |
| 客户端无法连接 | 检查 JWT Token 是否有效，检查 `POWERSYNC_JWT_SECRET` 配置 |
| 同步延迟高 | 检查 PostgreSQL 负载，查看 `powersync_sync_lag_ms` 指标 |
| 数据不一致 | 检查 `sync_rules.yaml` 的 `row_filter` 配置 |
| 上传失败 | 确认 `POWERSYNC_UPLOAD_ENABLED=true`，检查客户端网络 |

## 2. 生产环境部署 (Production Deployment)

### 2.1 硬件配置要求

#### 服务器配置 (当前生产环境)
| 组件 | 规格 | 用途 |
|------|------|------|
| **CPU** | Intel Xeon E5-2680 v4 (28核心 @ 2.4-3.3GHz) | 高并发处理 |
| **内存** | 64 GB DDR4 | 应用 + 数据库缓存 |
| **GPU** | NVIDIA RTX 3060 (12GB GDDR6) | OCR + Embedding 模型推理 |
| **系统盘** | 446 GB SSD (RAID) | 系统 + 高性能数据 |
| **数据盘** | 5.5 TB HDD + 238.5 GB NVMe SSD (bcache) | 大容量存储 + 缓存加速 |
| **RAID 卡** | LSI MegaRAID 9271-8i (1GB 缓存) | 硬件 RAID 加速 |
| **网络** | 千兆以太网 | 内网穿透 (FRP) |

#### 资源占用预估
| 阶段 | CPU | 内存 | GPU | 磁盘 |
|------|-----|------|-----|------|
| **开发环境** | 2-4 核 | 8-12 GB | 4-6 GB | 100-300 GB |
| **生产环境** | 4-8 核 | 16-24 GB | 6-8 GB | 300-1000 GB |
| **当前负载** (与 WxLibrary 共存) | < 10% | 35-45 GB | 6-8 GB | 1.2-1.8 TB |

#### 存储性能基准
- **SSD 顺序写入**: 932 MB/s
- **SSD 随机读 4K**: 11,200 IOPS
- **bcache 顺序写入**: 575 MB/s
- **网络带宽**: 实际约 100 Mbps (共享)

### 2.2 容器编排拓扑
### 2.2 容器编排拓扑
基于 `docker-compose.yml` 定义的服务架构：

#### 开发环境 (docker-compose.yml)
*   **接入层**: `traefik` (反向代理, 端口 48080)
*   **应用层**:
    *   `api`: FastAPI 后端服务 (端口 48000)
    *   `worker`: Celery 异步任务处理 (OCR, 导入, GPU 支持)
*   **数据层**:
    *   `postgres`: 主数据库 (端口 5432, 仅内部访问)
    *   `pgbouncer`: 连接池 (端口 6432)
    *   `valkey`: Redis 缓存与消息队列 (端口 6379)
    *   `seaweed`: S3 对象存储 (端口 48333/48888)
    *   `opensearch`: 全文搜索引擎 (端口 49200, 包含中文分词插件)
*   **同步层**: `powersync` (App-First 实时同步, 端口 48090/49091)
*   **翻译层**: `tolgee` (多语言管理, 端口 48085)
*   **转换层**: `calibre`, `calibre-watcher` (电子书格式转换, 端口 48081/48082)
*   **网络**: `athena-network` (Bridge 模式, 172.20.0.0/16 网段，固定配置)

#### 生产环境 (docker-compose.prod.yml)
在开发环境基础上增加：
*   **接入层**: `nginx` (替代 Traefik, 端口 48080/48443)
*   **内网穿透**: `frpc` (FRP 客户端, 独立于 WxLibrary)

#### 持久化卷策略
**高性能存储 (SSD)**: `/home/vitiana/Athena/data_ssd/`
*   `pg_data`: PostgreSQL 数据
*   `valkey_data`: Redis 持久化数据
*   `opensearch_data`: 搜索索引数据
*   `hf_cache`: HuggingFace 模型缓存

**大容量存储 (bcache HDD)**: `/data/athena/`
*   `seaweed_data`: 对象存储数据
*   `calibre_books`: Calibre 书库数据
*   `calibre_config`: Calibre 配置
*   `tolgee_postgres_data`: Tolgee 数据库
*   `nginx_logs`: Nginx 日志 (生产环境)

### 2.3 生产环境部署流程

#### 步骤 1: 初始化数据目录
```bash
cd /home/vitiana/Athena

# 执行初始化脚本（创建 SSD 和 HDD 数据目录）
./scripts/init-data-dirs.sh

# 检查目录权限
ls -la data_ssd/
sudo ls -la /data/athena/
```

#### 步骤 2: 配置环境变量
```bash
# 复制环境变量模板
cp .env.example .env

# 修改生产环境配置
vim .env

# 必须修改的配置：
# - POSTGRES_PASSWORD: 使用强密码
# - MINIO_ROOT_PASSWORD: S3 访问密钥
# - POWERSYNC_JWT_SECRET: 使用 openssl rand -base64 32 生成
# - SMTP_* : 邮件服务配置
```

#### 步骤 3: 构建镜像
```bash
# 构建 API 镜像
docker compose build api

# 构建 Worker 镜像（包含 GPU 支持）
docker compose build worker

# 构建 OpenSearch（包含中文分词插件）
docker compose build opensearch

# 构建生产环境 Nginx 和 FRP
docker compose -f docker-compose.prod.yml build nginx frpc
```

#### 步骤 4: 启动服务
```bash
# 开发环境
docker compose up -d

# 生产环境（包含 Nginx + FRP）
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f api worker
```

#### 步骤 5: 初始化数据库
```bash
# 运行数据库迁移
docker compose exec api alembic upgrade head

# 创建管理员账户（如果需要）
docker compose exec api python -m scripts.create_admin
```

#### 步骤 6: 验证部署
```bash
# 健康检查
curl http://localhost:48000/health
curl http://localhost:48090/health
curl http://localhost:49200/_cluster/health

# 检查 GPU 可用性
docker compose exec worker nvidia-smi

# 测试 OCR 功能
docker compose logs worker | grep -i "paddle\|ocr"
```

### 2.4 Nginx 反向代理配置

生产环境使用独立的 Nginx 替代 Traefik，配置文件位于 `docker/nginx/nginx.conf`。

#### 主要功能
- **静态文件服务**: 前端构建产物 (`web/dist`)
- **API 反向代理**: `/api/*` → `http://api:8000`
- **PowerSync WebSocket**: `/powersync/*` → `http://powersync:8090`
- **S3 存储代理**: `/s3/*` → `http://seaweed:8333`
- **SPA 路由支持**: 所有未匹配路径返回 `index.html`
- **SSL 终止**: 支持 HTTPS (需配置证书)

#### 修改域名配置
```bash
# 编辑 Nginx 配置
vim docker/nginx/nginx.conf

# 修改 server_name
server_name athena.yourdomain.com;  # 改为实际域名

# 重启 Nginx
docker compose restart nginx
```

### 2.5 FRP 内网穿透配置

Athena 使用独立的 FRP 配置，与 WxLibrary 完全隔离。

#### 配置文件: `docker/frpc/frpc.toml`
```toml
serverAddr = "154.40.32.146"
serverPort = 7000
auth.token = "athena_frp_token_2024"  # 独立 token

[[proxies]]
name = "athena-web"
type = "http"
localIP = "nginx"
localPort = 80
customDomains = ["athena.yourdomain.com"]
```

#### 修改步骤
1. 修改 `auth.token` 为独立的密钥
2. 修改 `customDomains` 为实际域名
3. 在 FRP 服务器上配置域名解析
4. 重启 FRP 客户端：`docker compose restart frpc`

#### 验证连接
```bash
# 查看 FRP 日志
docker compose logs -f frpc

# 应该看到：
# [athena-web] start proxy success
# [athena-web-ssl] start proxy success
```

### 2.6 密钥管理 (Secrets Management)
遵循 `03 - 系统架构` 中的 Infisical 策略：

*   **工具**: Infisical (或类似 Secret Manager)
*   **注入方式**: 生产环境禁止使用 `.env` 文件。必须通过 CI/CD 流水线将 Secrets 注入为容器环境变量。
*   **关键密钥**:
    *   `POSTGRES_PASSWORD`: 数据库密码 (高强度, 定期轮换)
    *   `MINIO_SECRET_KEY`: S3 密钥
    *   `PAY_FAKE_WEBHOOK_SECRET`: 支付回调签名密钥
    *   `SENTRY_DSN`: 错误追踪 DSN
*   **轮换周期**: API Key 与数据库密码 ≤ 90天。

## 3. CI/CD 流水线 (Pipeline)

基于 GitHub Actions (`.github/workflows/`) 的自动化流程。

### 3.1 主要 Workflow
*   **`ci.yml` (Continuous Integration)**:
    *   **触发**: Push to main, Pull Request。
    *   **Job 1: Backend**:
        *   安装 Python 依赖。
        *   运行 `ruff` 代码风格检查。
        *   运行 `pytest` 单元测试。
    *   **Job 2: Frontend**:
        *   安装 Node.js 依赖 (`pnpm`).
        *   运行 `eslint` 静态检查。
        *   运行 `vitest` 组件测试。
        *   运行 `build` 验证构建。

*   **`quality-gates.yml` (Quality Assurance)**:
    *   **触发**: Pull Request。
    *   **标准**:
        *   后端代码覆盖率 ≥ 80%。
        *   前端 Axe A11Y 可访问性检查通过。
        *   无 Critical/High 级别安全漏洞 (TruffleHog/Semgrep)。

*   **`main.yml` (Deployment)**:
    *   **触发**: Push to main (通过 CI 后)。
    *   **步骤**:
        1.  构建 Docker 镜像 (`api`, `worker`, `nginx`)。
        2.  推送到私有镜像仓库 (Registry)。
        3.  SSH 连接生产服务器。
        4.  执行滚动更新：
        ```bash
        docker compose pull
        docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps --build api worker nginx
        ```
        5.  运行数据库迁移 (如果需要)。
        6.  验证健康检查。

### 3.2 部署前检查清单
- [ ] 数据库备份已完成
- [ ] 环境变量配置正确（`.env` 文件）
- [ ] SSL 证书有效（生产环境）
- [ ] FRP 隧道连接正常
- [ ] GPU 驱动和 nvidia-docker 可用
- [ ] 磁盘空间充足（SSD > 50GB，HDD > 1TB）
- [ ] 数据库迁移脚本已测试

## 4. 可观测性 (Observability)

### 4.1 日志管理
*   **日志格式**: 所有容器使用 JSON 格式日志。
*   **日志配置**: 
    ```yaml
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "3"
    ```
*   **日志查看**:
    ```bash
    # 查看 API 日志
    docker compose logs -f api
    
    # 查看最近 100 行日志
    docker compose logs --tail=100 api worker
    
    # 查看所有服务日志
    docker compose logs --tail=50
    ```

### 4.2 性能监控

#### 系统级监控
```bash
# CPU 和内存使用
docker stats

# 磁盘 I/O
iostat -x 1 5

# 网络流量
ifconfig | grep -E "RX|TX"
```

#### 数据库监控
```bash
# 连接数
docker compose exec postgres psql -U athena -d athena -c \
  "SELECT count(*) FROM pg_stat_activity;"

# 慢查询
docker compose exec postgres psql -U athena -d athena -c \
  "SELECT pid, now() - query_start AS duration, query 
   FROM pg_stat_activity 
   WHERE state = 'active' 
   ORDER BY duration DESC LIMIT 10;"
```

#### GPU 监控
```bash
# GPU 使用情况
docker compose exec worker nvidia-smi

# 持续监控
watch -n 1 'docker compose exec worker nvidia-smi'
```

### 4.3 健康检查
```bash
# API 健康检查
curl http://localhost:48000/health

# PowerSync 健康检查
curl http://localhost:48090/health

# OpenSearch 集群健康
curl http://localhost:49200/_cluster/health

# SeaweedFS 状态
curl http://localhost:48888/cluster/status
```

## 5. 备份与灾难恢复 (Backup & DR)

### 5.1 备份策略

#### 数据库 (PostgreSQL)
*   **全量备份**: 每日凌晨 02:00 执行 `pg_dump`。
    ```bash
    # 手动执行备份
    docker compose run --rm backup
    
    # 备份文件位置
    ls -lh ./backups/athena_*.sql.gz
    ```
*   **增量备份**: 开启 WAL 归档 (RPO < 15min)。
*   **保留策略**: 
    - 本地保留 7 天 (`./backups/`)
    - 同步至异地冷存储 (建议使用 `/data/athena/backups/`) 保留 30 天
*   **容器**: `backup` 服务 (见 docker-compose.yml, profile: manual)

#### 对象存储 (SeaweedFS)
*   **存储位置**: `/data/athena/seaweed/` (bcache 加速)
*   **快照**: 每日增量快照
*   **同步**: 使用 `rclone` 同步至异地 Bucket
    ```bash
    # 安装 rclone
    sudo apt install rclone
    
    # 配置远程存储
    rclone config
    
    # 同步到远程
    rclone sync /data/athena/seaweed remote:athena-backup/seaweed
    ```

#### 搜索索引 (OpenSearch)
*   **存储位置**: `/home/vitiana/Athena/data_ssd/opensearch/` (SSD)
*   **备份方式**: 快照到 S3 仓库
*   **恢复**: 可重建索引（从数据库）

#### 模型缓存 (HuggingFace)
*   **存储位置**: `/home/vitiana/Athena/data_ssd/hf_cache/` (SSD)
*   **备份**: 可选（可从互联网重新下载）
*   **大小**: 约 5-10 GB

### 5.2 灾难恢复 (DR)
*   **RTO (恢复时间目标)**: < 60 分钟。
*   **RPO (数据丢失容忍)**: < 15 分钟。
*   **演练**: 每月第一个周五进行一次数据恢复演练，验证备份文件的完整性。

#### 恢复流程
```bash
# 1. 停止应用服务
docker compose stop api worker

# 2. 恢复数据库
# 找到最新备份
ls -lht ./backups/ | head -5

# 恢复指定备份
gunzip < ./backups/athena_20250114_0200.sql.gz | \
  docker compose exec -T postgres psql -U athena -d athena

# 3. 恢复 S3 数据 (如果需要)
rclone sync remote:athena-backup/seaweed /data/athena/seaweed

# 4. 重建搜索索引
docker compose exec api python -m scripts.reindex_all

# 5. 启动服务并验证
docker compose up -d
docker compose logs -f api

# 6. 健康检查
curl http://localhost:48000/health
curl http://localhost:49200/_cluster/health
```

### 5.3 备份监控
```bash
# 检查备份文件大小趋势
du -sh ./backups/*

# 验证最新备份
latest_backup=$(ls -t ./backups/*.sql.gz | head -1)
echo "最新备份: $latest_backup"
gunzip -t "$latest_backup" && echo "✓ 备份文件完整" || echo "✗ 备份文件损坏"

# 设置告警（推荐集成到 Prometheus）
# - 备份失败告警
# - 备份文件过期告警（> 24小时）
# - 磁盘空间不足告警
```

## 6. 常见故障排查 (Troubleshooting)

### 6.1 核心服务故障

#### OCR 任务卡死 / 积压
*   **现象**: 上传书籍后长时间处于 "Processing"。
*   **排查**:
    ```bash
    # 1. 检查 Celery Worker 日志
    docker compose logs --tail=100 worker
    
    # 2. 检查 Redis 队列长度
    docker compose exec valkey redis-cli llen celery
    
    # 3. 检查 Worker 资源
    docker stats worker
    
    # 4. 检查 GPU 是否可用
    docker compose exec worker nvidia-smi
    
    # 5. 重启 Worker
    docker compose restart worker
    ```
*   **常见原因**:
    - GPU 显存不足（需要 4-6GB）
    - 模型文件损坏或未下载完成
    - Celery Worker OOM

#### 数据库连接耗尽
*   **现象**: API 响应 500，日志报错 `FATAL: remaining connection slots are reserved`。
*   **排查**:
    ```bash
    # 1. 检查 PgBouncer 状态
    docker compose logs pgbouncer | tail -50
    
    # 2. 查看当前连接数
    docker compose exec postgres psql -U athena -d athena -c \
      "SELECT count(*) FROM pg_stat_activity;"
    
    # 3. 检查慢查询
    docker compose exec postgres psql -U athena -d athena -c \
      "SELECT pid, now() - query_start AS duration, query 
       FROM pg_stat_activity 
       WHERE state = 'active' 
       ORDER BY duration DESC LIMIT 10;"
    
    # 4. 杀死长时间运行的查询
    docker compose exec postgres psql -U athena -d athena -c \
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity 
       WHERE pid <> pg_backend_pid() AND state = 'active' 
       AND now() - query_start > interval '5 minutes';"
    ```
*   **解决方案**:
    - 增加 PgBouncer `MAX_CLIENT_CONN` 配置
    - 检查代码中是否有未关闭的连接
    - 优化慢查询，添加索引

### 6.2 搜索与存储

#### 搜索不可用
*   **现象**: 搜索接口超时或返回空。
*   **排查**:
    ```bash
    # 1. 检查 OpenSearch 健康度
    curl http://localhost:49200/_cluster/health | jq
    
    # 2. 检查索引状态
    curl http://localhost:49200/_cat/indices?v
    
    # 3. 检查 JVM 堆内存
    curl http://localhost:49200/_nodes/stats/jvm | jq '.nodes[].jvm.mem'
    
    # 4. 查看 OpenSearch 日志
    docker compose logs opensearch --tail=100
    
    # 5. 检查磁盘空间（SSD）
    df -h /home/vitiana/Athena/data_ssd/opensearch
    
    # 6. 重启 OpenSearch
    docker compose restart opensearch
    ```
*   **解决方案**:
    - 增加 JVM 堆内存 (`OPENSEARCH_JAVA_OPTS`)
    - 清理旧索引或增加磁盘空间
    - 重建索引: `docker compose exec api python -m scripts.reindex_all`

#### SeaweedFS/S3 上传失败
*   **现象**: 500 Internal Server Error。
*   **排查**:
    ```bash
    # 1. 检查 SeaweedFS 状态
    curl http://localhost:48888/cluster/status | jq
    
    # 2. 检查磁盘空间（HDD bcache）
    df -h /data/athena/seaweed
    
    # 3. 验证 S3 凭证
    docker compose exec api python -c "
    from app.config import MINIO_ACCESS_KEY, MINIO_SECRET_KEY
    print(f'Access Key: {MINIO_ACCESS_KEY}')
    print(f'Secret Key: {MINIO_SECRET_KEY[:4]}***')
    "
    
    # 4. 测试 S3 连接
    docker compose exec api python -m scripts.test_s3
    
    # 5. 查看 SeaweedFS 日志
    docker compose logs seaweed --tail=100
    ```

### 6.3 性能问题

#### API 响应慢
*   **排查**:
    ```bash
    # 1. 查看 API 日志
    docker compose logs api --tail=100
    
    # 2. 分析慢查询
    docker compose exec postgres psql -U athena -d athena -c \
      "SELECT calls, total_time, mean_time, query 
       FROM pg_stat_statements 
       ORDER BY mean_time DESC LIMIT 10;"
    
    # 3. 检查 Redis 缓存命中率
    docker compose exec valkey redis-cli info stats | grep keyspace
    
    # 4. 检查数据库连接池
    docker compose logs pgbouncer --tail=50
    ```

#### 磁盘 I/O 瓶颈
*   **排查**:
    ```bash
    # 1. 查看磁盘 I/O 使用率
    iostat -x 1 5
    
    # 2. 找到高 I/O 进程
    sudo iotop -o
    
    # 3. 检查 bcache 状态
    cat /sys/block/bcache0/bcache/state
    cat /sys/block/bcache0/bcache/cache_mode
    
    # 4. 查看 bcache 统计
    cat /sys/block/bcache0/bcache/stats_total/*
    ```
*   **优化方案**:
    - 将高频读写数据迁移到 SSD
    - 调整 bcache 模式为 `writeback`（需谨慎）
    - 增加数据库 shared_buffers

### 6.4 容器问题

#### 容器无法启动
*   **排查**:
    ```bash
    # 1. 查看容器状态
    docker compose ps -a
    
    # 2. 查看启动日志
    docker compose logs <service_name>
    
    # 3. 检查端口冲突
    sudo ss -tuln | grep -E "48000|48080|49200"
    
    # 4. 检查数据卷权限
    ls -la data_ssd/
    sudo ls -la /data/athena/
    
    # 5. 重新创建容器
    docker compose down
    docker compose up -d
    ```

#### GPU 不可用
*   **排查**:
    ```bash
    # 1. 检查 nvidia-smi
    nvidia-smi
    
    # 2. 检查 nvidia-docker
    docker run --rm --gpus all nvidia/cuda:11.0-base nvidia-smi
    
    # 3. 检查 Worker 容器配置
    docker compose config | grep -A 10 "worker:"
    
    # 4. 查看 Worker GPU 使用
    docker compose exec worker nvidia-smi
    ```

### 6.5 网络问题

#### FRP 连接失败
*   **排查**:
    ```bash
    # 1. 查看 FRP 日志
    docker compose logs frpc --tail=50
    
    # 2. 测试服务器连接
    telnet 154.40.32.146 7000
    
    # 3. 验证 token
    grep "auth.token" docker/frpc/frpc.toml
    
    # 4. 重启 FRP
    docker compose restart frpc
    ```

#### Nginx 502 错误
*   **排查**:
    ```bash
    # 1. 检查后端服务是否运行
    docker compose ps api powersync
    
    # 2. 测试后端直接访问
    curl http://localhost:48000/health
    
    # 3. 查看 Nginx 错误日志
    docker compose logs nginx | grep error
    
    # 4. 验证 upstream 配置
            docker compose exec nginx cat /etc/nginx/nginx.conf | grep upstream
    ```

## 7. 与 WxLibrary 共存部署说明

### 7.1 服务器资源分配

当前服务器同时运行 WxLibrary 和 Athena 两个项目。

#### 资源占用对比
| 项目 | CPU | 内存 | GPU | 磁盘 | 端口段 |
|------|-----|------|-----|------|--------|
| **WxLibrary** | < 3% | ~10 GB | 不使用 | 857 GB | 38088, 38443 |
| **Athena (预计)** | 4-8% | 16-24 GB | 6-8 GB | 300-1000 GB | 4XXXX |
| **总计** | < 15% | 30-40 GB | 6-8 GB | 1.2-1.8 TB | - |
| **服务器总量** | 28 核 | 64 GB | 12 GB | 5.5 TB | - |
| **剩余资源** | > 85% | > 20 GB | 4 GB | 3.7 TB | - |

**结论**: ✅ 服务器资源充裕，完全可以同时运行两个项目

### 7.2 端口隔离

#### WxLibrary 使用的端口
- `38088` - HTTP 入口
- `38443` - HTTPS 入口
- 内部端口（不对外）: 5432 (PostgreSQL), 6379 (Redis), 7700 (Meilisearch)

#### Athena 使用的端口（4XXXX 段）
- `48080` - HTTP 入口
- `48443` - HTTPS 入口（生产环境）
- `48000` - API 服务
- `48173` - 前端开发服务器
- `48333` - SeaweedFS S3
- `49200` - OpenSearch
- `48090` - PowerSync
- 其他监控端口: 49090, 43000, 43100, 46686

**冲突检测**: ✅ 无端口冲突

### 7.3 网络隔离

#### Docker 网络
- **WxLibrary**: `wx_library_net`
- **Athena**: `athena-network`

两个项目使用独立的 Docker 网络，完全隔离。

### 7.4 存储隔离

#### WxLibrary 数据位置
```
/data/media/               # 855 GB - 电子书文件
/data/postgres_data/       # 4 KB - 数据库（主要在内存）
/data/redis_data/          # 40 MB - Redis 持久化
/data/meilisearch_data/    # 612 MB - 搜索索引
/data/nginx_logs/          # 128 MB - 日志
/data/backups/             # 602 MB - 备份
```

#### Athena 数据位置
```
# SSD 高性能存储
/home/vitiana/Athena/data_ssd/
├── postgres/              # PostgreSQL
├── valkey/                # Redis
├── opensearch/            # 搜索索引
└── hf_cache/              # 模型缓存

# HDD 大容量存储
/data/athena/
├── seaweed/               # 对象存储
├── calibre_books/         # 电子书库
├── calibre_config/        # Calibre 配置
├── tolgee/                # 翻译数据库
└── nginx_logs/            # Nginx 日志（生产）
```

**冲突检测**: ✅ 存储路径完全独立

### 7.5 GPU 资源独占

- **WxLibrary**: 不使用 GPU
- **Athena**: 独占 RTX 3060 (12GB)
  - PaddleOCR: ~2-3 GB 显存
  - BGE-M3 Embedding: ~2-3 GB 显存
  - 剩余: ~6-7 GB 可用于其他任务

### 7.6 FRP 内网穿透隔离

#### WxLibrary FRP 配置
```toml
# FRP 服务器: 154.40.32.146:7000
[[proxies]]
name = "web"
localIP = "nginx"
localPort = 38088
customDomains = ["www.wxbooks.com", "wxbooks.com"]
```

#### Athena FRP 配置（生产环境）
```toml
# FRP 服务器: 154.40.32.146:7000
[[proxies]]
name = "athena-web"
localIP = "nginx"
localPort = 80
customDomains = ["athena.yourdomain.com"]
```

**隔离方式**:
- 使用不同的代理名称 (`web` vs `athena-web`)
- 使用不同的域名
- 建议使用不同的 auth token

### 7.7 监控指标

建议在 Prometheus + Grafana 中监控以下指标，确保两个项目不会相互影响：

```yaml
# 系统级监控
- node_cpu_usage_percent          # CPU 使用率
- node_memory_usage_percent       # 内存使用率
- node_disk_usage_percent         # 磁盘使用率
- node_network_transmit_bytes     # 网络流量

# 容器级监控
- container_cpu_usage_percent{project="wxlibrary"}
- container_cpu_usage_percent{project="athena"}
- container_memory_usage_bytes{project="wxlibrary"}
- container_memory_usage_bytes{project="athena"}

# GPU 监控（Athena）
- nvidia_gpu_memory_usage_bytes
- nvidia_gpu_utilization_percent
```

### 7.8 故障隔离

#### 资源限制
建议为 Athena 容器设置资源限制，防止影响 WxLibrary：

```yaml
# docker-compose.yml
services:
  api:
    deploy:
      resources:
        limits:
          cpus: '8'
          memory: 8G
        reservations:
          cpus: '2'
          memory: 4G
  
  worker:
    deploy:
      resources:
        limits:
          cpus: '12'
          memory: 16G
        reservations:
          cpus: '4'
          memory: 8G
```

#### 重启策略
```yaml
restart: unless-stopped  # 避免无限重启消耗资源
```

### 7.9 部署顺序建议

#### 首次部署 Athena
1. 确认 WxLibrary 运行稳定
2. 检查系统资源充足
3. 执行 `./scripts/init-data-dirs.sh` 创建数据目录
4. 逐个启动 Athena 服务：
   ```bash
   docker compose up -d postgres valkey  # 先启动数据层
   docker compose up -d opensearch seaweed  # 启动存储层
   docker compose up -d api  # 启动 API
   docker compose up -d worker  # 最后启动 GPU Worker
   ```
5. 验证各服务正常
6. 监控系统资源变化

#### 更新部署
```bash
# Athena 更新不会影响 WxLibrary
docker compose pull
docker compose up -d --no-deps --build api worker

# 验证
docker compose ps
docker compose logs -f api worker
```

---

**总结**: Athena 和 WxLibrary 通过端口隔离、网络隔离、存储隔离、FRP 隔离实现完全独立部署，互不影响。服务器资源充足，可以安全运行两个项目。