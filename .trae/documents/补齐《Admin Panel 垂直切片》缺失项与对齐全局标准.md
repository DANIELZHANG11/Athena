## 检查结论

* 缺少 AI 模型管理 API/UI（ai\_models.is\_active 动态配置）

* 缺少商业参数配置 API/UI（system\_settings、currencies CRUD）

* 缺少支付网关管理 API/UI（payment\_gateways CRUD 与加密配置编辑、总/单开关、权重）

* 缺少书籍处理任务 DLQ 运维接口/UI（查看与重试）

* 需要统一强制 Idempotency-Key 与 If-Match/ETag 的并发/幂等标准

## 拟更新内容

### 1) OpenAPI（contracts/api/v1/admin.yaml）新增/调整

* /api/v1/admin/ai-models

  * GET：列出 ai\_models（支持筛选 is\_active、provider）

  * POST：创建模型（Idempotency-Key: required true）

  * /{id} PATCH：更新（含 is\_active、pricing），请求头 If-Match: required true；响应携带 ETag

  * /{id} DELETE：软删除（Idempotency-Key: required true）

* /api/v1/admin/system-settings

  * GET：批量获取键值（如 ai\_service\_fee\_percentage、ai\_proxy\_url、usd\_to\_credit\_rate）

  * PATCH：批量更新键值（If-Match: required true；ETag 返回）

* /api/v1/admin/currencies

  * GET：列表；POST：新增（Idempotency-Key: required true）

  * /{code} PATCH：更新 rate\_to\_base（If-Match: required true；ETag）

  * /{code} DELETE：禁用或软删（Idempotency-Key: required true）

* /api/v1/admin/payment-gateways

  * GET：列表（含 is\_globally\_active、is\_active、weight；config 以掩码显示）

  * POST：新增（Idempotency-Key: required true；config 加密入库）

  * /{id} PATCH：更新（If-Match: required true；可改 is\_globally\_active/is\_active/weight/config）

  * /{id} DELETE：软删（Idempotency-Key: required true）

* /api/v1/admin/tasks/dlq

  * GET：查看死信队列（任务ID、类型、错误原因、重试计数、时间）

  * /{taskId}/retry POST：重试（Idempotency-Key: required true）

### 2) 安全与访问控制

* 仅 role=admin 且具备 scopes: \[admin:read, admin:write] 可调用

* 所有写操作强制 Idempotency-Key；更新强制 If-Match；响应返回 ETag

* 审计：所有变更写入 audit\_logs（含 request\_id、operator\_id、resource、action、before/after）

### 3) 前端 Admin UI/UX

* 左侧导航新增：

  * AI模型管理：列表过滤（provider/is\_active）、开关 is\_active、价格编辑、If-Match 并发提示

  * 商业与定价设置：表单编辑 ai\_service\_fee\_percentage、usd\_to\_credit\_rate、ai\_proxy\_url、各币种汇率（内联编辑）

  * 支付网关管理：总开关/单开关、权重设置、config 加密编辑（展示掩码，点击“显示”需二次确认）

  * 任务运维：DLQ 浏览器（按任务类型筛选）；重试按钮；重试成功/失败即时反馈

* 组件契约：

  * AIModelsManager：{ models, onCreate, onToggle, onUpdatePricing }

  * CommercialSettingsForm：{ settings, onSave }

  * CurrenciesTable：{ currencies, onCreate, onUpdate, onDelete }

  * PaymentGatewaysTable：{ gateways, onCreate, onUpdate, onDelete }

  * DLQViewer：{ items, onRetry }

### 4) 合同测试与E2E

* 管理模型：创建/并发更新/软删；幂等键重复提交返回同响应

* 商业参数：If-Match 不匹配返回 409；ETag 更新链路正确

* 汇率：新增/更新/禁用；列表筛选与分页

* 支付网关：加密字段不回传原文；总开关与单开关控制可用性

* DLQ：列表获取与重试；重试后任务入队并生成审计记录

### 5) 一致性对齐

* 与《AI 垂直切片》：ai\_models.is\_active 控制前端可见模型；定时任务更新 pricing 与 currencies

* 与《全球化支付与信用点系统》：payment\_gateways 表结构与管理接口一致；信用点计费透明

* 与《API标准与契约》：6.11 幂等强制、If-Match/ETag 全面贯彻

### 6) 文档更新位置

* 文件：`f:/reader/Athena/雅典娜技术文档.md`

* 章节：`《Admin Panel 垂直切片》` 的 API 契约与 UI 组件，新增上述端点与导航项；在安全与并发说明中强调 Idempotency-Key 与 If-Match；在合同测试页新增用例

### 7) 风险与回滚

* 纯文档与契约更新，不改DDL（已有表如 payment\_gateways/system\_settings/currencies/ai\_models 已定义）；若需回滚保留原文快照即可

