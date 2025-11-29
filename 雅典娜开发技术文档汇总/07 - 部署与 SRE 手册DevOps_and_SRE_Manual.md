# 07_DevOps_and_SRE_Manual.md

> **版本**：v1.0
> **定位**：部署、监控、CI/CD 与灾难恢复手册。

## 1. 本地开发环境 (Local Development)

### 1.1 快速启动
基于 `docker-compose.yml` 的一键启动方案，适用于开发与测试。

*   **前置依赖**：
    *   Docker Desktop (Windows/Mac) 或 OrbStack
    *   Git
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
*   **服务访问地址**：
    *   **Web App**: [http://localhost:5173](http://localhost:5173) (需单独启动前端 `pnpm dev`)
    *   **API Server**: [http://localhost:8000](http://localhost:8000)
    *   **API Docs (Swagger)**: [http://localhost:8000/docs](http://localhost:8000/docs)
    *   **MinIO Console (SeaweedFS S3)**: [http://localhost:8333](http://localhost:8333) (注意: SeaweedFS S3 端口)
    *   **Prometheus**: [http://localhost:9090](http://localhost:9090)
    *   **Grafana**: [http://localhost:3000](http://localhost:3000) (User/Pass: admin/admin)
    *   **Jaeger UI**: [http://localhost:16686](http://localhost:16686)
    *   **Traefik Dashboard**: [http://localhost:8080](http://localhost:8080) (需开启 insecure api)
    *   **Tolgee**: [http://localhost:8085](http://localhost:8085)

### 1.2 常用运维命令
```bash
# 重启特定服务
docker compose restart api worker

# 进入数据库容器
docker compose exec postgres psql -U athena -d athena

# 手动触发备份
docker compose run --rm backup
```

## 2. 生产环境部署 (Production Deployment)

### 2.1 容器编排拓扑
基于 `docker-compose.yml` 定义的服务架构：

*   **接入层**: `traefik` (反向代理, 端口 80/443)
*   **应用层**:
    *   `api`: FastAPI 后端服务 (多副本, 端口 8000)
    *   `worker`: Celery 异步任务处理 (OCR, 导入)
*   **数据层**:
    *   `postgres`: 主数据库 (端口 5432, 仅内部访问)
    *   `pgbouncer`: 连接池 (端口 6432)
    *   `valkey`: Redis 缓存与消息队列 (端口 6379)
    *   `seaweed`: S3 对象存储 (端口 8333)
    *   `opensearch`: 全文搜索引擎 (端口 9200)
*   **监控层**: `prometheus`, `grafana`, `loki`, `jaeger`
*   **网络**: `athena-network` (Bridge 模式, 内部隔离)
*   **持久化卷 (Volumes)**:
    *   `pg_data`: PostgreSQL 数据
    *   `seaweed_data`: 对象存储数据
    *   `valkey_data`: Redis 持久化数据
    *   `calibre_books`: Calibre 书库数据

### 2.2 密钥管理 (Secrets Management)
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
        1.  构建 Docker 镜像 (`api`, `worker`)。
        2.  推送到私有镜像仓库 (Registry)。
        3.  SSH 连接生产服务器。
        4.  执行 `docker compose pull && docker compose up -d` 滚动更新。

## 4. 可观测性 (Observability)

### 4.1 监控栈配置 (`monitoring/`)
*   **Metrics (指标)**:
    *   **Prometheus**: 抓取 `api` (/metrics), `postgres` (exporter), `node` (exporter)。
    *   **配置**: `monitoring/prometheus.yml`。
*   **Logs (日志)**:
    *   **Loki**: 聚合所有容器的 JSON 格式日志。
    *   **采集**: Docker Driver 直接发送至 Loki。
*   **Tracing (链路)**:
    *   **Jaeger**: 追踪 API 请求 -> DB 查询 -> Celery 任务的全链路耗时。
    *   **SDK**: OpenTelemetry Python SDK。
*   **Visualization (看板)**:
    *   **Grafana**: 预置 Dashboards。
        *   *API Performance*: RPS, Latency (P95/P99), Error Rate。
        *   *DB Health*: 连接数, 慢查询, 缓存命中率。
        *   *System*: CPU, Memory, Disk I/O。

## 5. 备份与灾难恢复 (Backup & DR)

### 5.1 备份策略
*   **数据库 (PostgreSQL)**:
    *   **全量备份**: 每日凌晨 02:00 执行 `pg_dump`。
    *   **增量备份**: 开启 WAL 归档 (RPO < 15min)。
    *   **保留策略**: 本地保留 7 天，同步至异地冷存储 (S3 Glacier) 保留 30 天。
    *   **容器**: `backup` 服务 (见 docker-compose.yml)。
*   **对象存储 (S3)**:
    *   **快照**: 每日增量快照。
    *   **同步**: 使用 `rclone` 同步至异地 Bucket。

### 5.2 灾难恢复 (DR)
*   **RTO (恢复时间目标)**: < 60 分钟。
*   **RPO (数据丢失容忍)**: < 15 分钟。
*   **演练**: 每月第一个周五进行一次数据恢复演练，验证备份文件的完整性。
*   **恢复流程**:
    1.  停止应用服务 (`docker compose stop api worker`)。
    2.  恢复数据库: `gunzip < backup.sql.gz | psql ...`。
    3.  恢复 S3 数据。
    4.  启动服务并验证。

## 6. 常见故障排查 (Troubleshooting)

### 6.1 核心服务故障
*   **OCR 任务卡死 / 积压**:
    *   **现象**: 上传书籍后长时间处于 "Processing"。
    *   **排查**:
        1.  检查 Celery Worker 日志: `docker compose logs --tail=100 worker`。
        2.  检查 Redis 队列长度: `docker compose exec valkey redis-cli llen celery`。
        3.  检查 Worker 资源: 是否 OOM (Out of Memory)。
*   **数据库连接耗尽**:
    *   **现象**: API 响应 500，日志报错 `FATAL: remaining connection slots are reserved`。
    *   **排查**:
        1.  检查 PgBouncer 状态: `docker compose logs pgbouncer`。
        2.  增加 `MAX_CLIENT_CONN` 配置。
        3.  检查是否有未关闭连接的代码泄漏。

### 6.2 搜索与存储
*   **搜索不可用**:
    *   **现象**: 搜索接口超时或返回空。
    *   **排查**:
        1.  检查 OpenSearch 健康度: `curl http://localhost:9200/_cluster/health`。
        2.  检查 JVM 堆内存与磁盘空间。
        3.  尝试重建索引 (Reindex Script)。
*   **MinIO/S3 上传失败**:
    *   **现象**: 500 Internal Server Error。
    *   **排查**:
        1.  检查 SeaweedFS 卷空间。
        2.  验证 Access Key / Secret Key 是否过期或配置错误。
