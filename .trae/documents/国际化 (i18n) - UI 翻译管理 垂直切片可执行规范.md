## 概述

* 目标：以数据库 `translations` 为单一事实来源，打通管理员后台→发布→CDN→前端消费的闭环。

* 范围：数据库与数据流、Admin API 契约、后台 UI/UX、前端集成与自动化、审计与安全、测试与交付物。

## 数据库与核心架构（复核与增补）

* 已有表：`languages(code, name)`；`translations(id, lang_code, key, value, UNIQUE(lang_code,key))`。

* 增补（DDL）：

```sql
-- 语言启用/禁用
ALTER TABLE languages ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
-- 索引与RLS
CREATE INDEX IF NOT EXISTS idx_translations_lang ON translations(lang_code);
CREATE INDEX IF NOT EXISTS idx_translations_key ON translations(key);
ALTER TABLE languages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE translations  ENABLE ROW LEVEL SECURITY;
CREATE POLICY languages_admin    ON languages    FOR ALL USING (current_setting('app.role', true) = 'admin') WITH CHECK (current_setting('app.role', true) = 'admin');
CREATE POLICY translations_admin ON translations FOR ALL USING (current_setting('app.role', true) = 'admin') WITH CHECK (current_setting('app.role', true) = 'admin');
```

* 核心数据流：

  * 写入：仅通过 Admin API 修改 `languages`/`translations`；记录审计日志。

  * 导出/分发（发布）：Celery 任务从 `translations` 拉取最新内容→按语言生成 JSON（如 `en/common.json`, `zh-CN/common.json`）→上传 MinIO →（可选）CDN 刷新。

  * 前端消费：应用启动时按当前语言从 CDN 拉取 JSON，注入 i18n 框架（i18next）。

## Admin Panel API 契约（contracts/api/v1/admin.yaml）

* 全局规范：所有写操作必须携带 `Idempotency-Key`；分页采用 cursor；错误码与统一响应格式遵循第六章。

* 语言管理：

```yaml
/api/v1/admin/i18n/languages:
  get: { summary: 列表, parameters: [cursor,page_size], responses: {200:{}} }
  post:
    summary: 新增语言
    parameters:
      - in: header; name: Idempotency-Key; required: true; schema: {type: string}
    requestBody: { application/json: { schema: { type: object, properties: { code:{type:string}, name:{type:string} } } } }
    responses: {201:{}}
/api/v1/admin/i18n/languages/{code}:
  patch:
    summary: 启用/禁用/改名
    parameters:
      - in: header; name: If-Match; required: true; schema: {type: string}
      - in: header; name: Idempotency-Key; required: true; schema: {type: string}
    requestBody: { application/json: { schema: { type: object, properties: { name:{type:string}, is_active:{type:boolean} } } } }
    responses: {200:{ headers: { ETag: { schema: { type: string } } } }, 409:{ description: VERSION_CONFLICT }}
  delete:
    summary: 删除语言
    parameters:
      - in: header; name: Idempotency-Key; required: true; schema: {type: string}
    responses: {204:{}}
```

* 翻译管理：

```yaml
/api/v1/admin/i18n/translations:
  get:
    summary: 查询翻译键值对
    parameters:
      - in: query; name: cursor; schema: {type:string}
      - in: query; name: page_size; schema: {type: integer, default: 50}
      - in: query; name: lang_code; schema: {type:string}
      - in: query; name: key; schema: {type:string, description: 模糊匹配}
      - in: query; name: view; schema: {type:string, enum:[key_based, language_based], default: key_based}
    responses: {200:{}}
  put:
    summary: 批量UPSERT翻译
    parameters:
      - in: header; name: Idempotency-Key; required: true; schema: {type: string}
    requestBody:
      content:
        application/json:
          schema:
            type: array
            items: { type: object, required: [key,lang_code,value], properties: { key:{type:string}, lang_code:{type:string}, value:{type:string} } }
    responses: {200:{ description: { updated: <int>, inserted: <int> }}}
```

* 发布与导入：

```yaml
/api/v1/admin/i18n/publish:
  post:
    summary: 触发发布到 MinIO/CDN
    parameters:
      - in: header; name: Idempotency-Key; required: true; schema: {type: string}
    responses: {202:{ description: Accepted, content: { application/json: { schema: { type: object, properties: { job_id:{type:string} } } } } }}

/api/v1/admin/i18n/import:
  post:
    summary: 批量导入翻译（CSV/JSON）
    parameters:
      - in: header; name: Idempotency-Key; required: true; schema: {type: string}
    requestBody:
      content:
        multipart/form-data:
          schema: { type: object, properties: { file: { type: string, format: binary }, format: { type: string, enum: [csv, json] } } }
    responses: {202:{ description: Accepted, content: { application/json: { schema: { type: object, properties: { job_id:{type:string} } } } } }}
```

## 管理员后台 UI/UX（国际化管理模块）

* 左侧导航：新增“国际化管理”。

* 翻译工作台：

  * 视图切换：`按键视图` 与 `按语言视图`。

  * 按键视图：每行一个 `key`，列为各语言（English/简体中文/日本語…），可内联编辑，批量保存→调用 `PUT /translations`。

  * 按语言视图：选择 `lang_code`，列为 `Key/Value`，支持实时搜索与筛选。

  * 发布：右上角“发布变更”按钮→调用 `POST /publish`，显示上次发布时间。

* 语言管理页面：`code/name/is_active` 的 CRUD；禁用语言后，前端切换器不再展示该项。

## 前端集成与自动化

* CI/CD（构建前步骤）：`Sync Locales` 脚本从 MinIO/CDN 拉取最新 JSON 到 `src/locales/`。

* 运行时加载：前端根据当前语言 URL 或用户偏好，异步加载对应 JSON，初始化 i18next。

* 开发规范：

  * 严禁硬编码用户可见文本；统一使用 `t('key')`。

  * ESLint 规则检测硬编码中英文字符串（警告/阻断可配置）。

## 审计、安全与并发

* 审计：Admin 写操作统一写入 `audit_logs`（操作人、时间、对象、差异摘要）。

* 并发：`PATCH /languages/{code}` 使用 `If-Match/ETag`；批量 `PUT /translations` 依赖 `Idempotency-Key` 保证幂等。

* 访问控制：对 `languages`/`translations` 启用 RLS，Admin 角色可写；业务读取通过服务层。

* 发布安全：发布任务读取只来自数据库；上传使用服务账号；CDN 刷新记录事件。

## 发布任务（Celery）

* 任务名：`i18n_publish`。

* 步骤：查询 `translations`→按语言聚合→生成 JSON→上传 MinIO（如 `i18n/{lang}/common.json`）→可选调用 CDN 刷新。

* 结果：返回 `job_id`、各语言文件统计与耗时；失败写入任务DLQ，支持 Admin 重试。

## 测试与验证

* 单元：UPSERT 逻辑、CSV/JSON 解析、ETag 生成、RLS 访问控制。

* 集成：`publish` 生成的 JSON 与数据库一致性；CDN 缓存刷新后前端拉取正确。

* E2E：后台编辑→发布→前端 `Sync Locales` →界面文案更新；禁用语言后切换器不显示。

*  检查在《国际化 (i1e) - UI 翻译管理》中是否还有遗漏的部分并进行补全，修改或调整。

## 交付物

* DDL 更新（`is_active`/索引/RLS）。

* `contracts/api/v1/admin.yaml` 扩展端点。

* Celery 发布任务与导入任务实现。

* Admin 前端页面（国际化管理、语言管理）。

* 前端与官网的 `Sync Locales` 脚本与 ESLint 规则。

