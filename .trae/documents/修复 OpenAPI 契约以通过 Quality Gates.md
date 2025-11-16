## 修复目标

* 清零契约 Lint Errors（summary、路径参数、结构错误）

* 补足 4XX 响应与 Info.license，移除未用组件

* 再次跑 CI 与 Quality Gates，确保全部绿灯

## 修改文件

* `contracts/api/v1/tags.yaml`：为 `GET/POST /tags`、`PATCH/DELETE /tags/{tag_id}` 补 `summary` 与 `4xx`（400/401/404/409）；完善 `{tag_id}` 路径参数定义

* `contracts/api/v1/shelves.yaml`：为所有操作补 `summary` 与 `4xx`；完善 `{shelf_id}`、`{book_id}` 路径参数

* `contracts/api/v1/reading_sessions.yaml`：为 `POST /start`、`POST /{sessionId}/heartbeat`、`POST /{sessionId}/end` 补 `4xx`；完善 `{sessionId}` 参数

* `contracts/api/v1/srs.yaml`：为 `GET/POST /srs/decks`、`GET /srs/cards`、`PATCH /srs/cards/{cardId}`、`POST /srs/cards/{cardId}/review`、`GET /srs/performance`、`GET/PUT /srs/settings` 补 `4xx`；完善 `{cardId}` 参数

* `contracts/api/v1/tts.yaml`：将 `/api/v1/tts/heartbeat` 从 `components` 移入 `paths`

* 契约全局：在顶层 `info` 增加 `license`；移除未使用 `components.schemas.TaskQueued`（位于 `contracts/api/v1/admin.yaml`）

## 修改规范

* `summary`：每个 Operation 一句简短中文描述

* `path parameters`：在 `parameters` 节点声明 `name`、`in: path`、`required: true`、`schema`

* `4xx responses`：至少包含 `400`（invalid\_request）、`401`（unauthorized）、`404`（not\_found）或 `409`（version\_conflict），`content` 使用统一错误结构 `{ status, error: { code, message } }`

* `license`：例如 `MIT`（`name: MIT`, `url: https://opensource.org/licenses/MIT`）

## 校验与提交

1. 本地契约 Lint：`npx @redocly/cli lint contracts/api/v1/*.yaml`
2. 一致性测试：`fastapi-openapi-tester --app api.app.main:app --spec contracts/api/v1/<file>.yaml`
3. 提交并触发 CI，查看 Quality Gates，若仍有提示，按报告微调

## 预计影响

* 无业务逻辑变更，仅契约与文档规范补全

* 提升 API 文档质量与客户端生成准确性

## 请求确认

* 请确认按以上清单与规范进行修复；确认后我将开始批量更新上述文件并重新触发 CI/Quality Gates。

