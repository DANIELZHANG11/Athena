## 问题确认

* POST /api/v1/tags 的 Idempotency-Key 未标注 required:true（现有：存在但缺required）

* PATCH /api/v1/tags/{id} 未设计乐观并发（If-Match/ETag）；仅有 Idempotency-Key

* DELETE /notes/{noteId}/tags/{tagId} 已为 required:true，无需变更；DELETE /tags/{id} 已是 required:true

* 搜索接口 /api/v1/search 未提供排序参数（现仅说明全局有sort\_by，但具体endpoint未声明）

* RAG的“结构化元数据注入”未给出具体Prompt示例

## 拟修正内容

### 1) 数据库DDL

* 在 Tags DDL 段落为 `tags` 增加版本字段：`version INTEGER NOT NULL DEFAULT 1`

* 说明：响应携带 `ETag: <version>`；更新需 `If-Match`，冲突返回409

### 2) OpenAPI 契约更新（位于《Tags & Search》3. REST API 契约）

* POST `/api/v1/tags`：将 `Idempotency-Key` 参数改为 `required: true`

* PATCH `/api/v1/tags/{id}`：

  * 增加 `If-Match`（required:true）

  * 响应添加 `ETag` 头

* DELETE `/api/v1/tags/{id}`：保持 `Idempotency-Key` required:true（确认一致）

* DELETE `/api/v1/notes/{noteId}/tags/{tagId}`：保持 `Idempotency-Key` required:true（确认一致）

* GET `/api/v1/search`：新增可选参数 `sort_by`，枚举 `relevance`(默认) 与 `recency`（按 `created_at DESC`）；文档明确排序规则

### 3) RAG集成示例

* 在《Tags & Search》“结构化元数据注入”小节或《AI 垂直切片》的RAG流程处，插入具体Prompt片段：

```
--- 资料 ---
[source_id_1: 来自书籍《原则》第3章]
(书籍片段文本...)
**关联标签**: #决策模型, #生活哲学

[source_id_2: 来自我的笔记“关于英雄主义”]
(笔记内容...)
**关联标签**: #历史, #人物传记

任务：基于以上资料与标签，回答用户问题，并在需要时解释标签如何帮助定位相关论据。
```

* 标注：标签作为结构化元数据被注入到RAG Prompt上下文，提升检索聚焦与回答语义对齐

### 4) 合同测试与E2E调整

* 补充：

  * `POST /tags` 幂等键强制校验

  * `PATCH /tags/{id}` 并发冲突用例（If-Match不匹配返回409，匹配返回新ETag）

  * `GET /search` 排序参数覆盖（relevance/recency）

## 变更范围与位置

* 文件：`f:/reader/Athena/雅典娜技术文档.md`

* 章节：

  * Tags DDL 段（“1. 数据库 DDL / RLS / 索引”附近 485 之后）

  * OpenAPI 契约片段（起始于 566）

  * RAG提示示例（可放在 529 后或 AI RAG章节 2799 附近说明）

  * 合同测试段（761）补充用例

## 风险与回滚

* 文档修订，不涉及代码；如需回滚，保留原文快照即可

## 执行后的一致性检查

* 第六章《API标准与契约》“幂等性强制”保持一致

* 并发更新逻辑与 Notes/Highlights 章节一致（ETag/If-Match）

* 搜索排序与全局排序规范（6.3）一致

