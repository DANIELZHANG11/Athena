# AI子任务清单 2.0

## 总则：工作流程与必验项
- 工作流程：Pre-Read 文档校验 → 实施 → 测试与验证 → CI质量门禁 → 可观测性验证 → 文档回写（附行号）→ 验收 → 回滚策略预案。
- 必验项：
  - 幂等：所有写操作强制 `Idempotency-Key`；重放一致。
  - 并发：PATCH 强制 `If-Match/ETag`；冲突 409。
  - 安全：RLS/Scopes/Webhook签名；密钥不暴露；密钥轮换（≤90天）。
  - 数据：索引覆盖高频过滤与排序；错误码统一；游标分页稳定。
  - 全球化：i18n 文案 SSOT（translations）；hreflang；Intl 货币与价格。
  - UI/UX：Lucide 图标系统（尺寸/描边/颜色最高法则）；Design Tokens 资产化。
  - SRE：SLO/SLI 与错误预算；DR（RPO/RTO）与演练；可观测性埋点与告警。
- 所有DOCKER镜像拉取的私人域名地址是：zukubq0aouv2k2.xuanyuan.run

## 优先级与并行策略
- 高：任务 1–5（基建门禁、Secrets、Observability、Users/RLS、Profile API）。
- 中：任务 6–13（Books/Reading/Notes/Tags/AI 对话/支付与信用点/网关管理/i18n 发布）。
- 中-高：任务 14–18（Admin、监控备份、契约测试、CI/CD、封板验收）。
- 并行建议：1.1 与 1.3 可并行；2.1 与 1.2 必须串行；6–9 在 2.1–2.3 后可模块并行。

## 统一任务模板（执行卡片）
- ID/标题/优先级
- 目标/范围
- 依据（doc_refs：file_path:line）与契约文件
- 依赖（前置任务）
- Pre-Read（编码前校验清单：逻辑闭环、一致性、非功能性）
- 实施步骤（接口/DDL/服务/前端组件）
- 测试与验证（契约/单元/集成/E2E/A11Y/性能冒烟）
- CI门禁（必须通过项）
- 可观测性（指标/日志/追踪/告警）
- 文档回写（做了什么、怎么做的、是否正确；附行号）
- 验收标准（量化指标）
- 回滚策略（安全可控）

---

## 任务清单（执行卡片）

### 1.1 设置后端基础项目结构（高）
- 目标/范围：初始化 FastAPI 项目骨架；Docker Compose；Traefik；Infisical；健康检查 `/health`。
- 依据：f:\reader\Athena\雅典娜技术文档.md:12–42, 42–48（PgBouncer），全局域名策略新增段落（12–41 段后）
- 依赖：无
- Pre-Read：12-Factor 与环境变量；PgBouncer与SQLAlchemy兼容；域名与 CORS/SSO 一致性。
- 实施步骤：项目结构、Traefik 路由与 HTTPS、Infisical 注入、Sentry 初始化。
- 测试与验证：`docker-compose up`；`GET /health` 返回 `status: ok`；Sentry 捕获错误。
- CI门禁：contracts:lint, typecheck, lint/format, test:coverage, semgrep。
- 可观测性：Prom/Grafana API延迟仪表与告警。
- 文档回写：补充骨架位置与配置项摘要（12–42）；门禁清单（2062–2073）。
- 验收标准：容器健康；HTTPS与限流工作；Sentry捕获。
- 回滚策略：回退 compose；保留健康检查与错误捕获。

### 1.2 设置数据库与RLS基础（高）
- 目标：PostgreSQL+pgvector 初始化；RLS模板；Alembic迁移；会话变量中间件。
- 依据：f:\reader\Athena\雅典娜技术文档.md:2172–2256（users等），RLS示例 440–456；新增 RLS 覆盖（user_sessions/reading_progress/dict_history/payment_gateways/dictionary_packages）
- 依赖：1.1
- Pre-Read：所有用户私有/Admin表 RLS 已定义；索引策略匹配查询模式。
- 实施步骤：DDL与策略；中间件 `SET LOCAL app.user_id/app.role`。
- 测试：RLS过滤；索引命中；pg_dump校验。
- CI门禁：`sqlfluff`、契约测试过。
- 可观测性：审计日志与拒绝访问计数。
- 文档回写：补充实际策略与索引（相关行号）。
- 验收标准：非所有者无法越权。
- 回滚策略：只读临时策略。

### 1.3 设置前端基础项目结构（高）
- 目标：React+Vite+TS+Zustand+TanStack；PWA；动静分离配置。
- 依据：f:\reader\Athena\雅典娜技术文档.md:12–42, 49–132（CDN）
- 依赖：无（与1.1并行）
- Pre-Read：i18n:no-hardcode；Tokens资产化；Lucide图标规范。
- 实施步骤：项目目录；API客户端生成；Service Worker缓存。
- 测试：`pnpm dev`；离线缓存；lint无硬编码。
- CI门禁：lint/format/typecheck。
- 可观测性：错误边界+Sentry。
- 文档回写：补充骨架与构建脚本（行号）。
- 验收标准：前端可启动；PWA工作。
- 回滚策略：暂时关闭SW缓存。

### 1.4 监控与备份栈（高）
- 目标：Prom/Grafana/Loki/Jaeger/Sentry；Barman备份；Otel exporter。
- 依据：f:\reader\Athena\雅典娜技术文档.md:37–38, 2988, 40（Barman）；SLO/SLI 与 DR 新增（3766–3781、2162后）
- 依赖：1.1
- Pre-Read：SLO 阈值与错误预算；RPO/RTO。
- 实施步骤：监控服务配置；仪表与告警；备份策略与演练脚本。
- 测试：错误捕获；备份恢复；指标采集。
- CI门禁：observability lint。
- 可观测性：仪表与告警规则。
- 文档回写：阈值与演练 SOP（行号）。
- 验收标准：告警触发；恢复演练达标。
- 回滚策略：最小监控保留。

### 2.1 账户与认证（高）
- 目标：OAuth/邮箱验证码；JWT+Refresh；RBAC。
- 依据：f:\reader\Athena\雅典娜技术文档.md:142–152；第六章 JWT/Scopes 440–456
- 依赖：1.1, 1.2
- Pre-Read：RLS 与会话变量；速率限制与滥用防御。
- 实施步骤：Auth 路由与模型；邮件发送；令牌管理。
- 测试：登录/刷新/登出；速率限制。
- CI门禁：契约与安全检查。
- 可观测性：认证日志与告警。
- 文档回写：路由与错误码（行号）。
- 验收标准：认证闭环稳定。
- 回滚策略：临时禁用特定OAuth。

### 2.2 书籍管理与组织（高）
- 目标：/books,/shelves；Calibre转换；按需下载。
- 依据：f:\reader\Athena\雅典娜技术文档.md:147–173
- 依赖：2.1
- Pre-Read：Cloud 图标交互；MinIO预签名；心跳恢复。
- 实施步骤：CRUD；转换任务；签名URL。
- 测试：上传/转换/下载；定位恢复。
- CI门禁：契约/A11Y。
- 可观测性：任务与错误日志。
- 文档回写：流程与字段（行号）。
- 验收标准：跨设备无缝。
- 回滚策略：关闭按需下载。

### 2.3 阅读器与进度（高）
- 目标：心跳上报；累计时长；WebSocket心跳。
- 依据：f:\reader\Athena\雅典娜技术文档.md:152–173, 2435–2554
- 依赖：2.2
- Pre-Read：RLS 与索引；TTS同步。
- 实施步骤：API+前端组件；断网恢复策略。
- 测试：断网→恢复；定位一致。
- CI门禁：性能冒烟。
- 可观测性：读时与心跳指标。
- 文档回写：参数与索引（行号）。
- 验收标准：位置同步稳定。
- 回滚策略：批量同步。

### 2.4 笔记/高亮/标签（高）
- 目标：CRUD；多对多标签；链接书籍位置。
- 依据：f:\reader\Athena\雅典娜技术文档.md:156–159, 2603–2655, 4637–5063
- 依赖：2.3
- Pre-Read：ETag/幂等；RLS与索引；游标分页。
- 实施步骤：接口与前端工具条；并发更新。
- 测试：冲突/重复；软删一致。
- CI门禁：契约/分页。
- 可观测性：更新审计。
- 文档回写：示例与错误码（行号）。
- 验收标准：并发正确；列表稳定。
- 回滚策略：单编辑者模式。

### 3.1 Tags & Search（中）
- 目标：标签管理；全局搜索（ES+PG fallback）。
- 依据：f:\reader\Athena\雅典娜技术文档.md:2694–2991, 344–343, 780
- 依赖：2.4
- Pre-Read：tags.version；If-Match；sort_by。
- 实施步骤：ES配置；同步任务；API。
- 测试：索引与高亮；fallback测试。
- CI门禁：契约与性能。
- 可观测性：搜索耗时仪表。
- 文档回写：版本字段与示例（行号）。
- 验收标准：重命名并发安全；排序可控。
- 回滚策略：暂禁ES，走PG。

### 3.2 Billing（中）
- 目标：信用点系统；多网关支付；Webhook处理。
- 依据：f:\reader\Athena\雅典娜技术文档.md:5794–5916, 3334–3360
- 依赖：2.1
- Pre-Read：Adapter接口；事务原子性；签名验证。
- 实施步骤：创建会话→跳转→Webhook入账。
- 测试：余额更新；事件幂等；异常回滚。
- CI门禁：契约/事务一致性。
- 可观测性：支付事件仪表与告警。
- 文档回写：流程与字段（行号）。
- 验收标准：账实一致；幂等安全。
- 回滚策略：单网关运行。

### 3.3 TTS & 词典（中）
- 目标：原生TTS；混合翻译引擎；历史记录。
- 依据：f:\reader\Athena\雅典娜技术文档.md:5921–6020
- 依赖：2.3
- Pre-Read：离线词典包；API代理；AI计费透明。
- 实施步骤：TTS组件；翻译API；词典包管理。
- 测试：朗读心跳；翻译准确；历史入库。
- CI门禁：契约/安全。
- 可观测性：调用统计与失败告警。
- 文档回写：端到端流程（行号）。
- 验收标准：体验一致；记录完备。
- 回滚策略：仅离线词典。
  - DDL与RLS：api/alembic/versions/0008_tts_dict.py:1
  - 路由：
    - TTS：api/app/tts.py:13、api/app/main.py:31
    - 词典：api/app/dict.py:11、api/app/main.py:33
    - 翻译：api/app/translate.py:10、api/app/main.py:34
  - 存储：api/app/storage.py:24

### 3.4 Admin Panel（中）
- 目标：用户管理、看板、Prompt模板、审计、任务运维、网关管理、i18n管理。
- 依据：f:\reader\Athena\雅典娜技术文档.md:793–1342, 1307–1330
- 依赖：2.1, 3.2
- Pre-Read：Admin-only RLS；If-Match/ETag；Idempotency-Key。
- 实施步骤：CRUD+图表；并发控制；DLQ重试。
- 测试：Admin 权限与审计；并发冲突回滚。
- CI门禁：契约/A11Y。
- 可观测性：管理操作审计。
- 文档回写：模块导航与接口（行号）。
- 验收标准：运营控盘。
- 回滚策略：禁用高风险操作。
  - DDL与RLS：api/alembic/versions/0009_admin_core.py:1（users.version 与 admin RLS；payment_gateways/prompt_templates/audit_logs/translations）
  - 路由：api/app/admin.py:9、api/app/main.py:35（用户/网关/翻译/信用点）
  - 登录补齐：api/app/auth.py:57（登录写入 users）

### 3.5 Landing & Marketing（中）
- 目标：Astro/Tailwind；SEO/i18n；动态OG；SSO体验。
- 依据：Landing 文档（已对齐 youdomin.com）；SSO章节（6198–6200）；hreflang 示例
- 依赖：1.3, 2.1
- Pre-Read：hreflang；i18n路由；Sitemap。
- 实施步骤：多语言页面；切换器；OG生成与meta。
- 测试：Lighthouse>90；hreflang正确；SSO无缝。
- CI门禁：构建与静态检查。
- 可观测性：访问与跳转分析。
- 文档回写：页面结构与meta（行号）。
- 验收标准：SEO与SSO达标。
- 回滚策略：关闭动态OG与SSO联动。
  - 页面与SEO：`web/index.html:3–15`（描述、OG、Twitter、hreflang）
  - 文案与切换：`web/src/locales/{en,zh-CN}/common.json:1–5`、`web/src/App.tsx:1–31`
  - robots/sitemap：`web/public/robots.txt:1–3`、`web/public/sitemap.xml:1–18`

### 4.1 WebSocket/Yjs（中-高）
- 目标：实时通道；Yjs 冲突解决与版本快照。
- 依据：f:\reader\Athena\雅典娜技术文档.md:464–479（新增）
- 依赖：2.4, 2.5
- Pre-Read：快照阈值（100次或5分钟）；冲突消息格式。
- 实施步骤：服务端冲突判断；客户端草稿保存与自动恢复。
- 测试：多客户端冲突；性能冒烟；Toast非阻塞。
- CI门禁：实时契约与负载冒烟。
- 可观测性：冲突计数与恢复耗时。
- 文档回写：消息与阈值（行号）。
- 验收标准：无模态中断；数据不丢失。
- 回滚策略：单编辑者锁。
  - 路由：`api/app/realtime.py:1–93`（`/ws/notes/{note_id}`，JSON消息：ready/update/apply/conflict）
  - 快照DDL与RLS：`api/alembic/versions/0010_yjs_snapshots.py:1–41`（`note_versions`，阈值100次或5分钟）
  - 引用示例：`f:\reader\Athena\雅典娜技术文档.md:6411–6421`

### 4.2 国际化与支付全球化（中-高）
- 目标：多语言UI；区域定价；translations 同步脚本。
- 依据：f:\reader\Athena\雅典娜技术文档.md:3433–3458, 434–439；currencies/regional_prices
- 依赖：3.2, 3.5
- Pre-Read：Sync Locales；no-hardcode；hreflang。
- 实施步骤：i18next；API 响应本地化；Intl 价格。
- 测试：语言与货币切换；多币种测试。
- CI门禁：i18n:sync；no-hardcode。
- 可观测性：语言与地区分布。
- 文档回写：脚本与路由（行号）。
- 验收标准：多语言与价格准确。
- 回滚策略：固定语言与美元价格。
  - 区域定价DDL与RLS：`api/alembic/versions/0011_pricing.py:1–43`
  - 定价API：`api/app/pricing.py:1–47`、`api/app/main.py:37`
  - Admin 管理区域价：`api/app/admin.py:164–188`
  - 同步脚本：`web/scripts/i18n-sync.cjs:1–53`、`web/package.json:7–13`
  - 前端价格渲染：`web/src/Price.tsx:1–21`、`web/src/App.tsx:1–33`

### 4.3 全项目 CI/CD（中-高）
- 目标：GitHub Actions 流水线；契约测试；部署门禁。
- 依据：f:\reader\Athena\雅典娜技术文档.md:421–439, 2062–2073
- 依赖：所有核心
- Pre-Read：门禁项齐全；部署策略。
- 实施步骤：main.yml 与 contracts.yml；构建发布。
- 测试：PR模拟；staging 部署。
- CI门禁：质量门禁全通过。
- 可观测性：发布事件审计。
- 文档回写：工作流与门禁（行号）。
- 验收标准：自动化发布达标。
- 回滚策略：手动触发回滚。
  - 工作流：`.github/workflows/main.yml:1–57`、`.github/workflows/contracts.yml:1–30`

### 4.4 E2E 与 SRE 指标（中-高）
- 目标：Cypress/Jest E2E；Grafana 仪表；错误预算计算。
- 依据：f:\reader\Athena\雅典娜技术文档.md:3766–3781
- 依赖：4.3
- Pre-Read：SLO 阈值；关键旅程定义。
- 实施步骤：E2E用例；仪表 JSON；Error Budget 脚本。
- 测试：运行全套；模拟负载。
- CI门禁：覆盖率与性能冒烟。
- 可观测性：SLO合规图表。
- 文档回写：旅程与阈值（行号）。
- 验收标准：SLO合规。
- 回滚策略：优化热点路径。
  - E2E：`web/cypress.config.ts:1–7`、`web/cypress/e2e/home.cy.ts:1–8`、CI 集成 `.github/workflows/main.yml:34–40`
  - 仪表：`monitoring/dashboards/api.json:1–26`（请求率/错误率/延迟P95）
  - 错误预算：`monitoring/error_budget.py:1–10`

### 4.5 P1 扩展（OCR/SRS）（中）
- 目标：OCR 服务与 SRS 复习模块扩展。
- 依据：f:\reader\Athena\雅典娜技术文档.md:176–194, 3545–3560
- 依赖：以上全部
- Pre-Read：额度计费与回滚策略；srs_reviews 设计一致。
- 实施步骤：API 与任务；计费与日志。
- 测试：功能与性能基准。
- CI门禁：契约与安全。
- 可观测性：额度与任务仪表。
- 文档回写：扩展说明（行号）。
- 验收标准：功能稳定；计费透明。
- 回滚策略：逐步下线不稳定模块。
  - DDL与RLS：`api/alembic/versions/0012_ocr_srs.py:1–67`
  - OCR API：`api/app/ocr.py:1–42`、`api/app/main.py:41–43`
  - SRS API：`api/app/srs.py:1–74`、`api/app/main.py:41–43`

---

## 验收清单（Checklist）
- 幂等（Idempotency-Key）；并发（If-Match/ETag）；RLS 与权限（Scopes）。
- 索引与性能（过滤/排序）；错误码与统一响应；游标分页与排序。
- i18n（SSOT 与 Sync）；图标（Lucide）与 Tokens；日志与审计；SRE 指标与告警。
  - 错误码契约：`contracts/errors.yaml:1–17`；统一错误响应见 `api/app/main.py:30–39`
  - 告警规则：`monitoring/alerts.yml:1–17`；Prometheus 引用 `monitoring/prometheus.yml:1–10`，Compose 挂载 `docker-compose.yml:39–41`
