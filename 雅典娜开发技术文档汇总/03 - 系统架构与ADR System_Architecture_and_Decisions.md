# 03_System_Architecture_and_Decisions.md

> 版本：v1.0  
> 定位：系统的物理蓝图与决策档案。任何基础设施变更必须先更新本文档。

## 1. 系统概览 (System Overview)
- Monorepo：`api`（后端）+ `web`（前端）+ `contracts`（OpenAPI 契约）。
- 部署：基于 `docker-compose.yml` 的容器化，Traefik 作为网关，PostgreSQL/pgvector、Valkey、OpenSearch、SeaweedFS、Celery Worker、监控栈与辅助服务（Tolgee/Calibre）。

## 2. 技术栈选型 (Tech Stack Matrix)

### 2.1 后端 (Backend)
- Language：Python 3.11（`api/Dockerfile`）
- Framework：FastAPI `0.115.4`（`api/requirements.txt:1`）
- ORM：SQLAlchemy `2.0.36`（异步驱动 `asyncpg 0.30.0`）
- Migration：Alembic `1.13.2`
- Task Queue：Celery `5.4.0`
- Broker/Cache：Valkey（Redis 兼容，容器 `valkey`；客户端库 `redis 5.0.8`）
- Observability：Prometheus、Jaeger（`prometheus-fastapi-instrumentator 6.1.0`、`jaeger-client 4.8.0`）
- S3 客户端：`boto3 1.35.59`（对接 SeaweedFS S3 网关）

### 2.2 前端 (Frontend)
- Framework：React `18.3.1`，React DOM `18.3.1`
- Build Tool：Vite `5.4.10`
- Language：TypeScript `^5.6.3`
- Styling：Tailwind CSS `4.1.17`（`@tailwindcss/postcss 4.1.17`）
- State & Data：Zustand `^4.5.4`、@tanstack/react-query `^5.56.2`
- Icons：lucide-react `^0.460.0`
- 其他：Radix UI 组件族、Framer Motion、React Reader（基于 EPUB.js）、React PDF + react-virtuoso、Cypress/Vitest（CI 覆盖）

### 2.5 阅读器组件栈 (Reader Components)
- **EPUB**：React Reader 2.x + EPUB.js 0.3.93。所有受控资源统一通过 Blob URL 注入，避免额外的未授权请求；进度通过 rendition `relocated` 事件实时写入 `reading_progress`。
- **PDF**：react-pdf 10.x + react-virtuoso。虚拟滚动仅渲染可视页，默认启用文本层，为 OCR 高亮与全文检索打基础。
- **坐标系与标注**：阅读器内维护 PDF 页面的原始尺寸与渲染尺寸，提供坐标映射函数 (Client → PDF) 供后续批注、绘制与命中测试使用。
- **心跳同步**：统一由 `useReaderHeartbeat` Hook 管理，EPUB 使用 CFI，PDF 使用页码；进度变更立即写入 IndexedDB 并定时上报。

### 2.3 基础设施与存储 (Infrastructure)
| 组件 | 选型 | 容器名 | 关键用途 |
| :--- | :--- | :--- | :--- |
| API Gateway | Traefik v3 | `traefik` | 路由与限流；`api.youdomin.com` 入口 |
| API Service | FastAPI | `api` | 业务服务与 REST/SSE/WebSocket |
| Database | PostgreSQL + pgvector | `postgres` | 关系数据与向量存储 |
| Pooler | PgBouncer | `pgbouncer` | 会话池；`DATABASE_URL` 走 6432 |
| Cache/Broker | Valkey (Redis 兼容) | `valkey` | Celery Broker/Backend、并发/幂等缓存 |
| Object Store | SeaweedFS (S3) | `seaweed` | S3 兼容网关 8333；直传/预签名 |
| Search | OpenSearch | `opensearch` | 全文/向量检索（单节点开发配置） |
| Monitoring | Prometheus/Grafana/Loki | `prometheus`/`grafana`/`loki` | 指标/仪表盘/日志聚合 |
| Tracing | Jaeger | `jaeger` | OTLP/Trace 可视化 |
| Translation | Tolgee + Postgres | `tolgee`/`tolgee_db` | i18n 平台（可选） |
| OCR 工具 | Calibre | `calibre` | 格式转换与预处理（EPUB/PDF） |
| Worker | Celery | `worker` | 后台任务与队列消费 |
| Backup | Postgres CLI | `backup` | 手动触发备份（profiles: manual） |

### 2.4 服务依赖拓扑与启动/健康策略 (Dependency Graph)
| Service | Depends On | Criticality | Healthcheck | Notes |
| :--- | :--- | :--- | :--- | :--- |
| Traefik | API | Critical | - | 唯一入口；路由与限流（`docker-compose.yml:2-20`） |
| API | PgBouncer, Valkey, SeaweedFS | Critical | - | OpenSearch 为可选；降级策略见 ADR-002（`docker-compose.yml:28-41,60-66`） |
| PgBouncer | Postgres | Critical | Postgres ok | 会话池；避免直连数据库（`docker-compose.yml:199-217`） |
| Postgres | - | Critical | Enabled | 核心数据层，强一致（`docker-compose.yml:140-152`） |
| Valkey | - | Critical | - | Celery Broker/Backend；并发/幂等锁（`docker-compose.yml:158-167`） |
| SeaweedFS | - | Critical | - | S3 网关；上传/下载通道（`docker-compose.yml:168-180`） |
| OpenSearch | - | Optional | Enabled | 失败时回退 Postgres `tsvector`（`docker-compose.yml:181-198`） |
| Worker | Valkey, PgBouncer, SeaweedFS | Critical | - | 任务消费；断点续执行（`docker-compose.yml:268-284`） |
| Prometheus | API | Optional | - | 指标采集（`docker-compose.yml:73-87`） |
| Grafana | Prometheus, Loki | Optional | - | 可视化（`docker-compose.yml:88-102`） |
| Loki | - | Optional | - | 日志聚合（`docker-compose.yml:103-112`） |
| Jaeger | API | Optional | - | Trace 可视化（`docker-compose.yml:113-126`） |
| Tolgee | tolgee_db | Optional | - | i18n 平台（`docker-compose.yml:222-248`） |
| Calibre | - | Optional | - | 工具型服务（`docker-compose.yml:249-267`） |

- 启动顺序：Postgres → PgBouncer → Valkey/SeaweedFS → API → Worker → Traefik → 观测栈。
- 健康检查：Postgres/OpenSearch 已启用；其余通过指标与探针监控，生产需加 `restart: always` 与 readiness gating。
- 一致性与降级：Postgres/SeaweedFS/Valkey 为强一致依赖；OpenSearch 可软降级；Worker 支持重试与断点续。


## 3. 架构决策记录 (Architecture Decision Records - ADR)

### ADR-001: 对象存储选用 SeaweedFS
- 背景：更适合小文件与高并发场景，部署轻量；MinIO 在小文件碎片、目录层面存在额外开销。
- 决策：采用 SeaweedFS S3 网关；统一通过标准 S3 协议访问。
- 约束：代码层面必须使用 `boto3`；保留 `MINIO_*` 环境变量键（`MINIO_ENDPOINT/MINIO_BUCKET` 等）以兼容客户端配置与迁移路径。

### ADR-002: 搜索技术回退策略
- 决策：生产强制 OpenSearch；CI/低配环境允许降级为 Postgres `tsvector` 查询以保障可用性与资源节约。
- 实现：在响应中添加 `X-Search-Engine` 头标识当前引擎；索引同步入口抽象为 `search_sync`，保持双实现可切换。

### ADR-003: 单卡 GPU 风控与调度
- 背景：服务器仅有单卡 RTX 3060 (12G)。
- 决策：
  1. 全局单并发：通过 Valkey 分布式锁控制，同一时间仅允许一本书进入 GPU 流水线（OCR/Embedding）。
  2. 页级并行：单任务内以批次方式占用显存（如 10 页批处理），避免 OOM。
  3. 优先级队列：Celery Priority，付费会员/加油包任务优先于免费任务。

### ADR-004: 动静分离与 CDN
- 决策：静态资源域 `cdn.youdomin.com` 与动态 API 域 `api.youdomin.com` 分离；前端引用走绝对 CDN 域，API 走相对路径或网关域。

### ADR-005: PgBouncer 模式选型（RLS 安全）
- 背景：系统使用 PostgreSQL RLS，并在每次请求设置会话变量 `app.user_id`（如 `api/app/translate.py:48-52`）。PgBouncer 的 transaction pooling 会导致会话变量与 `SET LOCAL` 丢失，RLS 失效。
- 决策：PgBouncer 必须启用 `POOL_MODE=session`；禁止使用 `transaction` 模式（`docker-compose.yml:207`）。
- 约束：所有数据库连接均通过 PgBouncer；禁止直连 Postgres；中间件必须提前设置 `current_setting('app.user_id')` 相关变量。

## 4. 全局域名与网络策略 (Network Strategy)
- 域名规划：`youdomin.com`（Landing）、`app.youdomin.com`（Web App）、`api.youdomin.com`（Backend）。
- Cookie：`Domain=.youdomin.com`，`Secure`，`HttpOnly`，`SameSite=Lax`。
- CORS：仅允许来自 `app.youdomin.com` 与开发环境 `http://localhost:*` 的 Origin；严格校验 `Authorization` 与自定义头（`Idempotency-Key/If-Match`）。
- 路由前缀：统一 `/api/v1/*`；支付回调域需 HMAC 验签与速率限制。

### 网络隔离矩阵（Network Isolation Matrix）
| Service | External Access | Internal | Notes |
| :--- | :--- | :--- | :--- |
| Traefik | Yes | - | 唯一入口；生产强制 HTTPS 与 WAF |
| API | No | Yes | 仅内网；开发端口 `8000` 暴露仅限本机（`docker-compose.yml:62-66`） |
| Postgres | No | Yes | 禁止外网访问；仅 PgBouncer 访问 |
| PgBouncer | No | Yes | 6432 仅内网；面向应用层 |
| OpenSearch | No | Yes | 生产禁止外网；开发 `9200` 暴露仅限本机（`docker-compose.yml:187-193`） |
| Valkey | No | Yes | 内部访问；禁止外网暴露 |
| SeaweedFS (S3) | No | Yes | 生产仅内网；通过预签名 URL 间接外发 |
| Prometheus | No | Yes | 生产内网或 VPN；禁止公网 |
| Grafana | No | Yes | 生产内网或 VPN；禁止公网 |
| Jaeger | No | Yes | 生产内网或 VPN；禁止公网 |
| Tolgee | No | Yes | 仅内网；可停机恢复 |


## 5. 目录与文件结构映射 (Directory Mapping)
- `api/alembic/` → `[04_DB]` 数据库迁移与日志
- `contracts/api/v1/` → `[05_API]` OpenAPI 契约源
- `web/src/styles/figma.css` → `[06_UI]` 设计系统 Tokens（SSOT）
- `雅典娜开发技术文档汇总/02 - 功能规格与垂直切片Functional_Specifications_PRD.md` → `[02_PRD]` 功能规格与垂直切片
- `docker-compose.yml` → `[03_ADR]` 物理拓扑与容器定义
- `monitoring/*` → `[07_SRE]` 监控与运维手册

## 6. S3 对象存储与上传策略（SeaweedFS）
- Bucket：`MINIO_BUCKET`（默认 `athena`，`api/app/services/book_service.py:8`）。
- Key 命名：`users/{user_id}/{uuid}/{filename}`（`api/app/storage.py:34-36`）。派生产物示例：数字化分析报告 `digitalize-report-{book_id}.json`（`api/app/tasks.py:118-144`）。
- 直传流程：
  - `upload_init` → 返回 `key` 与 `upload_url`（预签名 PUT，`api/app/services/book_service.py:11-14`）。
  - 客户端 `PUT upload_url` 完成上传。
  - `upload_complete` → 幂等写入书籍记录，基于 `ETag` 去重；返回 `download_url`（预签名 GET）（`api/app/books.py:101-186`）。
- 幂等与一致性：
  - 使用 `Idempotency-Key` 与 Valkey 记录幂等键（`api/app/books.py:116-121,185-187`）。
  - SeaweedFS S3 写入为最终一致；服务端以 `ETag` 与对象 `HEAD` 校验后再返回读 URL，避免读写竞争（`api/app/storage.py:82-90`）。
- 分片上传：当前采用单对象直传；如需多分片，遵循 S3 `Multipart Upload` 协议并在服务端集中合并；本版本未启用。

## 7. 日志规范（Logging Strategy）
- 输出要求：所有服务输出 JSON 结构化日志；字段：`timestamp`（ISO8601）、`level`、`service`、`trace_id`、`user_id`（可选）、`message`、`extra`。
- 关联追踪：API 注入 Jaeger Trace（`api/app/tracing.py:11-26,28-42`）；日志中携带 `trace_id` 以实现跨服务关联。
- 级别与分类：统一 `ERROR/WARN/INFO/DEBUG`；错误日志上报 Sentry（`api/app/main.py:1-7,38`），事件日志落库（如 `audit_logs`）。
- 聚合与查询：开发环境使用 Loki/Grafana；生产至少保留本地 JSON 文件并接入集中式日志平台。

## 8. 书籍上传与处理流程 (Book Upload & Processing Pipeline)

### 8.1 完整处理流水线

```
用户上传书籍文件
        ↓
  前端计算 SHA256 指纹
        ↓
  POST /books/upload_init → 获取预签名 URL
        ↓
  PUT 直传至 S3
        ↓
  POST /books/upload_complete → 创建书籍记录
        ↓
  后台任务触发 (Celery)
        ├─ tasks.convert_to_epub (如果非 EPUB/PDF)
        ├─ tasks.extract_book_cover
        └─ tasks.extract_book_metadata
        ↓
  书籍可阅读
```

### 8.2 格式转换 (Calibre)

**适用格式**: MOBI, AZW3, FB2 等非 EPUB/PDF 格式

**工作流程**:
1. Worker 从 S3 下载源文件到共享卷 (`/calibre_books`)
2. 创建转换请求文件 (`convert-{job_id}.request`)
3. Calibre 容器中的监控脚本检测请求并执行 `ebook-convert`
4. Worker 轮询等待 `.done` 或 `.error` 文件
5. 转换成功后:
   - 上传 EPUB 到 S3
   - **删除原始非 EPUB/PDF 文件** (节省存储)
   - 更新 `minio_key` 指向新 EPUB
   - 设置 `converted_epub_key` 标记

**共享卷配置** (`docker-compose.yml`):
```yaml
volumes:
  calibre_books:
    driver: local

services:
  calibre:
    volumes:
      - calibre_books:/books
  worker:
    volumes:
      - calibre_books:/calibre_books
```

### 8.3 元数据提取 (Metadata Extraction)

**提取字段**: `title`, `author`, `page_count`

**支持格式**:
- **EPUB**: 从 OPF 文件提取 `<dc:title>` 和 `<dc:creator>`
- **PDF**: 使用 PyMuPDF 提取 PDF 元数据

**标题更新逻辑**:
只有当满足以下条件之一时，才会用元数据中的标题覆盖当前标题：
1. 当前标题为空
2. 当前标题包含下划线 (`_`)
3. 当前标题以扩展名结尾 (`.epub`, `.pdf`, `.mobi`, `.azw3`)
4. 当前标题符合 `书名-作者名` 格式，而提取的标题更短且不含连字符

### 8.4 封面提取 (Cover Extraction)

**来源优先级**:
1. EPUB: OPF 中定义的 `cover-image` 或 `meta[name=cover]`
2. PDF: 首页渲染为图片

**优化处理**:
- 转换为 WebP 格式
- 固定尺寸 400×600 (2:3 比例)
- 质量 80%
- 存储到 `covers/{book_id}.webp`

### 8.5 存储策略

**最终状态**: S3 中只保留 EPUB 和 PDF 格式的电子书
- 非 EPUB/PDF 格式在 Calibre 转换成功后自动删除
- `minio_key` 始终指向可阅读的 EPUB/PDF 文件
- `converted_epub_key` 标记该书籍经过格式转换

---

## 9. 备份与恢复策略（Backup & Restore）
- PostgreSQL：
  - 频率：每日全量 `pg_dump`（通过宿主机定时触发 `backup` 容器，`docker-compose.yml:127-139`）。
  - WAL：生产启用归档以支持点时间恢复（PITR）；保留 7 天。
  - 保留：全量备份保留 7–14 天；加密存储。
- SeaweedFS：
  - 卷备份：每日快照 `seaweed_data`；保留 7–14 天；尽量在低峰进行。
  - 恢复：挂载备份卷恢复；与数据库记录比对校验缺失对象。
- OpenSearch：
  - 策略：优先重建索引（由数据库数据重建）；可选使用快照仓库做冷备。降级策略见 ADR-002。

## 9. 任务队列结构（Celery Queues）
- 队列规划：
  - `ocr.high`：付费/高优任务（OCR）
  - `ocr.low`：免费/低优任务（OCR）
  - `embedding`：向量嵌入生成
  - `index.sync`：全文检索增量同步
  - `bookkeeping`：账务与审计
- 绑定约定：任务定义使用 `shared_task(queue="...")`；Worker 可按需分池 `-Q ocr.high,embedding` 与通用池 `-Q ocr.low,index.sync,bookkeeping`。
- 当前实现：任务已命名（如 `tasks.deep_analyze_book`、`search.index_note`，`api/app/tasks.py:88-151`，`api/app/search_sync.py:29-56`）；队列拆分为设计规范，代码按需演进。

## 10. 网关限流策略（Rate Limit）
- 模型：Token Bucket（Traefik 内置 RateLimit 中间件）。
- 规则：
  - 每 IP：`average=100 req/s`，`burst=50`；源依据 `RemoteIP`（`docker-compose.yml:53-55`）。
  - API Key：依据头 `X-API-Key` 进行独立桶限流（需在 Traefik 中配置 `sourceCriterion.requestHeaderName`）。
  - 用户 Token：依据 `Authorization` 或用户 ID 做细粒度限流（可选）。
- 说明：生产需区分读/写接口限流阈值；风控入口对上传、支付回调加更严限制。

## 11. OpenSearch 索引结构与中文插件（可选）
- 索引与映射：
  - `notes`：`content`（`text`，中文分词+同音+繁简转换），`user_id`（`keyword`），`book_id`（`keyword`），`updated_at`（`date`），`tag_ids`（`keyword[]`），`vector`（`dense_vector`，dim=1024，可选）。
  - `highlights`：同上，`text_content` 字段。
  - `books`：`title`（`text`，加权），`author`（`text`），`user_id`（`keyword`），`updated_at`（`date`）。
- 插件镜像（生产建议）：在自定义 OpenSearch 镜像集成
  - `analysis-ik`（中文分词）
  - `analysis-pinyin`（拼音/首字母）
  - `analysis-stconvert`（简繁转换）
- 分析器策略：
  - Index Analyzer：`ik_max_word + pinyin_filter + stconvert`
  - Search Analyzer：`ik_smart + stconvert`
- 现状：`docker-compose.yml` 当前为官方镜像（单节点、`DISABLE_SECURITY_PLUGIN=true`，`docker-compose.yml:181-188`）；中文插件与映射为可选增强，代码侧查询已兼容（`api/app/search.py:49-111`）。



