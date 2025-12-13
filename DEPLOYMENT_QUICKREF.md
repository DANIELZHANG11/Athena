# Athena 部署快速参考

## 📋 服务端口映射表（4XXXX 段）

| 服务名 | 内部端口 | 外部端口 | 用途 | 访问地址 |
|--------|---------|---------|------|----------|
| **Web & API** | | | | |
| Traefik | 80 | 48080 | 开发环境入口 | http://localhost:48080 |
| Nginx | 80/443 | 48080/48443 | 生产环境入口 | http://localhost:48080 |
| API | 8000 | 48000 | FastAPI 后端 | http://localhost:48000 |
| Web Dev | 5173 | 48173 | Vite 开发服务器 | http://localhost:48173 |
| **存储 & 搜索** | | | | |
| SeaweedFS S3 | 8333 | 48333 | S3 对象存储 API | http://localhost:48333 |
| SeaweedFS Admin | 8888 | 48888 | SeaweedFS 管理界面 | http://localhost:48888 |
| OpenSearch | 9200 | 49200 | 全文搜索引擎 | http://localhost:49200 |
| **同步 & 翻译** | | | | |
| PowerSync | 8090 | 48090 | App-First 同步引擎 | http://localhost:48090 |
| PowerSync Metrics | 9090 | 49091 | PowerSync 监控指标 | http://localhost:49091/metrics |
| Tolgee | 8080 | 48085 | 多语言翻译平台 | http://localhost:48085 |
| **电子书转换** | | | | |
| Calibre UI | 8080 | 48081 | Calibre 界面 | http://localhost:48081 |
| Calibre Web | 8081 | 48082 | Calibre Web 服务 | http://localhost:48082 |

## 💾 数据存储位置

### SSD 高性能存储 (932 MB/s, 11.2K IOPS)
```
/home/vitiana/Athena/data_ssd/
├── postgres/              # PostgreSQL 数据库
├── valkey/                # Redis/Valkey 持久化
├── opensearch/            # 全文搜索索引
└── hf_cache/              # HuggingFace 模型缓存
```

### HDD 大容量存储 (575 MB/s, bcache 加速)
```
/data/athena/
├── seaweed/               # SeaweedFS 对象存储
├── calibre_books/         # Calibre 电子书库
├── calibre_config/        # Calibre 配置文件
├── tolgee/                # Tolgee 翻译数据库
└── nginx_logs/            # Nginx 日志（生产环境）
```

## 🌐 网络配置

**Docker 网络**: `athena-network`
- **网络模式**: Bridge
- **网段**: 172.20.0.0/16 (固定配置，不允许变更)
- **网关**: 172.20.0.1
- **隔离**: 与 WxLibrary 的 `wx_library_net` 完全隔离

## 🔧 常用命令

### 初始化
```bash
# 创建数据目录（首次运行）
./scripts/init-data-dirs.sh

# 启动所有服务
docker compose up -d

# 查看服务状态
docker compose ps
```

### 开发环境
```bash
# 启动前端开发服务器
cd web && pnpm dev

# 查看 API 日志
docker compose logs -f api

# 查看 Worker 日志（OCR 任务）
docker compose logs -f worker

# 重启特定服务
docker compose restart api worker
```

### 生产环境
```bash
# 启动生产环境（包含 Nginx + FRP）
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# 构建前端静态文件
cd web && pnpm build

# 部署更新
docker compose pull
docker compose up -d --no-deps --build api worker nginx
```

### 数据库管理
```bash
# 进入 PostgreSQL
docker compose exec postgres psql -U athena -d athena

# 运行数据库迁移
docker compose exec api alembic upgrade head

# 手动备份
docker compose run --rm backup

# 恢复备份
gunzip < ./backups/athena_20250114_0200.sql.gz | \
  docker compose exec -T postgres psql -U athena -d athena
```

### 监控 & 调试
```bash
# 查看容器资源使用
docker stats

# 检查 GPU 状态
docker compose exec worker nvidia-smi

# 查看所有日志
docker compose logs --tail=100

# 查看特定服务日志
docker compose logs -f api worker

# 健康检查
curl http://localhost:48000/health
curl http://localhost:48090/health
curl http://localhost:49200/_cluster/health

# 数据库连接数
docker compose exec postgres psql -U athena -d athena -c \
  "SELECT count(*) FROM pg_stat_activity;"

# 慢查询分析
docker compose exec postgres psql -U athena -d athena -c \
  "SELECT pid, now() - query_start AS duration, query 
   FROM pg_stat_activity 
   WHERE state = 'active' 
   ORDER BY duration DESC LIMIT 10;"
```

## 🌐 环境变量配置

### .env 关键配置
```bash
# 端口配置（4XXXX 段）
TRAEFIK_PORT=48080
API_PORT=48000
WEB_DEV_PORT=48173
SEAWEED_S3_PORT=48333
OPENSEARCH_PORT=49200
POWERSYNC_PORT=48090

# 数据库
POSTGRES_PASSWORD=strong_password_here
DATABASE_URL=postgresql+asyncpg://athena:${POSTGRES_PASSWORD}@pgbouncer:6432/athena

# S3 存储
MINIO_ROOT_USER=minio
MINIO_ROOT_PASSWORD=minio123
MINIO_ENDPOINT=seaweed:8333

# PowerSync
POWERSYNC_JWT_SECRET=your_jwt_secret_here
POWERSYNC_UPLOAD_ENABLED=true

# SMTP 邮件
SMTP_HOST=smtp.exmail.qq.com
SMTP_PORT=465
SMTP_USER=your_email@example.com
SMTP_PASSWORD=your_smtp_password
```

## 🚀 生产环境检查清单

### 部署前
- [ ] 执行 `./scripts/init-data-dirs.sh` 创建数据目录
- [ ] 配置 `.env` 环境变量（强密码）
- [ ] 检查磁盘空间（SSD > 50GB，HDD > 1TB）
- [ ] 确认 GPU 驱动和 nvidia-docker 可用
- [ ] 备份现有数据

### 部署时
- [ ] 构建 Docker 镜像
- [ ] 逐个启动服务（数据层 → 存储层 → 应用层）
- [ ] 运行数据库迁移
- [ ] 验证健康检查

### 部署后
- [ ] 测试 API 接口
- [ ] 测试文件上传（S3）
- [ ] 测试搜索功能
- [ ] 测试 OCR 任务（GPU）
- [ ] 配置监控告警
- [ ] 设置自动备份

## 🔗 与 WxLibrary 共存

### 端口隔离
- **WxLibrary**: 38088, 38443
- **Athena**: 4XXXX 段
- ✅ 无冲突

### 网络隔离
- **WxLibrary**: `wx_library_net`
- **Athena**: `athena-network`
- ✅ 完全独立

### 存储隔离
- **WxLibrary**: `/data/media/` (855 GB)
- **Athena**: `/home/vitiana/Athena/data_ssd/` + `/data/athena/`
- ✅ 路径独立

### GPU 资源
- **WxLibrary**: 不使用 GPU
- **Athena**: 独占 RTX 3060 (12GB)
- ✅ 无竞争

## 📞 故障排查快速索引

| 问题 | 快速排查命令 |
|------|-------------|
| API 无响应 | `docker compose logs api` → 检查端口 48000 |
| OCR 任务卡死 | `docker compose exec worker nvidia-smi` → 检查 GPU |
| 数据库连接失败 | `docker compose logs pgbouncer postgres` |
| 搜索不可用 | `curl http://localhost:49200/_cluster/health` |
| S3 上传失败 | `curl http://localhost:48888/cluster/status` |
| 磁盘空间不足 | `df -h` → 清理旧备份或日志 |
| 容器无法启动 | `docker compose ps -a` → 检查端口冲突 |
| GPU 不可用 | `nvidia-smi` → 检查驱动 |
| 网络问题 | `docker network ls` → 确认 athena-network (172.20.0.0/16) |

## 📚 相关文档

- **系统架构**: `03 - 系统架构与ADR System_Architecture_and_Decisions.md`
- **数据库设计**: `04 - 数据库全景与迁移Database_Schema_and_Migration_Log.md`
- **API 文档**: `05 - API 契约与协议API_Contracts_and_Protocols.md`
- **App-First 架构**: `09 - APP-FIRST架构改造计划.md`

---

**快速启动**: `./scripts/init-data-dirs.sh && docker compose up -d && cd web && pnpm dev`
