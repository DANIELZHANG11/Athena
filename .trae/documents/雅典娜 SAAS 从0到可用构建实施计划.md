## 总体目标
- 以技术文档为唯一事实来源，构建可运行的 MVP（Web+API+容器编排+监控），逐步完善到文档 v7.1/v8.0 所述的工业级门禁与可靠性。
- 严格契约驱动（OpenAPI/SSOT）、零信任（JWT+RLS）、幂等与乐观并发、一切容器化。

## 环境与准备
- Docker Compose: 清理后重拉镜像与依赖。
- 私有镜像域名: 使用 `zukubq0aouv2k2.xuanyuan.run` 作为所有镜像拉取源。
- 密钥管理: 接入 Infisical（开发态用本地 Workspace），所有密钥仅服务端注入。
- 网关与代理: Traefik 作为 API 网关；海外代理通过 `system_settings.ai_proxy_url` 配置。

## 缓存清理与镜像拉取（执行前）
- 停止与清理: `docker compose down --volumes --remove-orphans`
- 全面清理: `docker system prune -a --volumes`（开发机，确认后执行）
- 登录私仓: `docker login zukubq0aouv2k2.xuanyuan.run`
- 拉取镜像: `docker compose pull`（所有服务镜像引用指向私仓域名）

## 里程碑与子任务
### 0. 仓库体检与对齐
- 任务: 全仓扫描现有代码/配置与技术文档差异，列出修正清单（路径、契约、RLS、索引、CI门禁）。
- 交付: 差异报告与修正计划（含高优先级阻断项）。
- 验证: 本地 `pnpm lint/typecheck`、后端 `pytest -k contract`、OpenAPI Lint 全通过。

### 1. 基础设施与编排
- 任务: Compose 服务定义与网络、卷、依赖顺序对齐；Traefik 路由/限流、中间件；Infisical 注入；Prom/Grafana/Loki/Jaeger。
- 交付: `docker compose up` 全栈可启动，健康探针通过。
- 验证: Prometheus `/metrics` 可抓取、Grafana 可视化、Traefik 路由与限流命中、Loki 日志入库。

### 2. 数据库与迁移
- 任务: 按《数据库白皮书 v6.0》执行扩展与 DDL（uuid-ossp/pg_trgm/vector/pg_partman 等），应用 RLS 全覆盖与索引。
- 交付: Alembic 迁移集（包含 RLS/索引/触发器），测试库升级成功。
- 验证: `sqlfluff lint` 通过、迁移回滚成功、关键查询 Explain 正常、RLS 用例通过。

### 3. 认证与会话（MVP闭环）
- 任务: 邮箱验证码登录、OAuth 入口、JWT（RS256）+ Refresh+Redis，`user_sessions` 与设备指纹。
- 交付: `contracts/api/v1/auth.yaml` 实现与前端登录表单。
- 验证: 合同测试（Pact/Jest）、令牌刷新、RLS 隔离、失败路径与限流命中。

### 4. Books & Shelves（上传/处理/下载）
- 任务: 预签名上传→创建记录→轻量分析→重处理（OCR/Embedding/共享向量池）；书架树增删改与关联。
- 交付: `books.yaml/shelves.yaml` 路由与 Celery 任务；MinIO 对象存储联通。
- 验证: E2E 上传至 ACTIVE、任务进度可见；唯一指纹与幂等；下载预签名有效。

### 5. Reader & 云同步（心跳）
- 任务: 心跳会话三端点、离线缓存（PWA/IndexedDB）、打开到上次位置；OCR叠加层（PDF双层渲染）。
- 交付: 组件 `Reader`、`BookCard`、Service Worker 与心跳后端。
- 验证: 位置/进度同步正确、跨午夜拆分统计、离线可读、PWA 安装提示。

### 6. Notes & Highlights（CRUD+并发+幂等）
- 任务: 触发器与索引、`version` 乐观并发、Idempotency-Key 幂等、游标分页、标签绑定。
- 交付: `notes.yaml/highlights.yaml` 路由与前端编辑器。
- 验证: 409 并发冲突处理、软删幂等、全文检索命中。

### 7. Tags & Search（ES+pg 回退）
- 任务: ES 索引与同步、全局检索聚合、回退到 Postgres tsvector；`X-Search-Engine` 响应头。
- 交付: `tags.yaml/search.yaml` 与 Celery 同步任务。
- 验证: 高亮命中片段、过滤/分页、ES中断回退提示。

### 8. AI 会话与知识内化（RAG）
- 任务: 仅知识库模式、向量+ES并行检索、重排序与 Prompt 构建；会话保存与乐观并发；海外代理路由。
- 交付: `ai.yaml` 路由、SSE 流式、缓存层（`ai_query_cache`）。
- 验证: 流式回复、缓存命中≤500ms、上下文修订一致性（409 CONTEXT_STALE）。

### 9. 计费与支付（Credits）
- 任务: `credit_products/payments/credit_transactions/user_credits_mv` 闭环；PingPong/Stripe 适配器与 Webhook 幂等。
- 交付: `billing.yaml` 路由与个人中心充值/账单页。
- 验证: 成功入账事务原子性、账单明细透明、余额视图刷新。

### 10. Admin Panel（运营）
- 任务: 用户与角色、特性开关、Prompt 模板、AI 模型、系统设置、DLQ 重试与审计。
- 交付: 管理端页面与路由（admin-only RLS）。
- 验证: 操作均记 `audit_logs`，ETag/If-Match 并发正确，DLQ 重试链路通。

### 11. WebSocket & Yjs（协同）
- 任务: 文档频道、冲突检测与版本快照、草稿自动恢复；事件总线与阅读器联动。
- 交付: `realtime` 路由、前端协同集成。
- 验证: 冲突→草稿保存→自动合并；快照阈值触发。

### 12. TTS & 词典/翻译
- 任务: 原生 TTS 控件与朗读心跳；离线词典/在线代理/AI 翻译（计费）。
- 交付: 词典包管理与查词浮窗；翻译路由与账本打点。
- 验证: 朗读控制条可用、查词历史入库、AI 翻译扣费与展示。

### 13. Landing & Marketing（Astro+i18n）
- 任务: 主页/定价/登录，Design Tokens 复用，国际化与 hreflang；动态 OG 图片。
- 交付: 站点构建与部署（Vercel/Netlify）。
- 验证: Lighthouse>90、hreflang/robots/sitemap 正确、SSO 入口跳转顺畅。

### 14. CI/CD 与质量门禁
- 任务: 合同校验、类型检查、Lint/Prettier、覆盖率阈值、E2E 冒烟、axe 无障碍、Semgrep 安全、Secret Scanning、Bundlesize。
- 交付: GitHub Actions `quality-gate` 工作流。
- 验证: PR 受保护分支必须全部通过后方可合并。

## 验证与测试策略（各子任务通用）
- 合同测试: `@redocly/cli`、Pact（消费者/提供者）。
- 单元/集成: 后端 `pytest`、前端 Jest+RTL；覆盖率总体≥85%，变更≥80%。
- E2E: Playwright/Cypress 关键旅程（登录→打开书→高亮→AI）。
- 可观测性: Prometheus 指标、Loki 日志、Sentry 错误、Jaeger 链路。

## 风险与回滚
- 数据迁移: 先临时库演练，提供回滚脚本；索引并发构建使用 `CONCURRENTLY`。
- 任务幂等: Celery 重试与重复消费的业务幂等保障（幂等键/唯一约束）。
- 缓存一致性: 编辑触发精确失效与 TTL 缩短策略，避免陈旧读。

## 后续运维
- 备份与 DR: Barman（或等效）每日全量+每小时增量；月度恢复演练。
- 密钥轮换: ≤90天轮换与泄露处置流程；RBAC 最小权限与审计告警。

—— 上述计划将按里程碑逐一落地，每完成一个子任务即交付可运行组件/路由/迁移与验证证据，再推进下一任务。