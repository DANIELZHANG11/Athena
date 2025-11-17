## 修复与增强内容

* 修复Windows Runner上Cypress二进制缺失：将缓存路径改回`%USERPROFILE%\.cache\Cypress`并显式`install/verify`

* 数据库迁移增强：新增Alembic迁移`payment_sessions.external_id`，移除运行时DDL

* Webhook一致性：移除`DEV+fake`签名容忍与DEV异常200返回，保持严格校验

* 契约一致性：统一`servers.url`为正式域（补`profile.yaml`），已补齐主要文件的`operationId`与`license`

## 实施步骤

1. 更新`.github/workflows/ci.yml`的Windows安装步骤为`%USERPROFILE%\.cache\Cypress`并执行`install/verify`
2. 在`api/alembic/versions`新增迁移文件，增加`external_id`列
3. 修改`api/app/billing.py`：删除DEV容忍逻辑，异常按标准返回
4. 契约：统一`contracts/api/v1/profile.yaml`的`servers.url`为`https://api.athena.app`
5. 提交并触发CI/Quality Gates验证

## 预期结果

* Cypress安装通过，E2E步骤不再报二进制缺失

* 后端迁移确保Webhook入账路径稳定

* 契约Lint无阻塞警告（其余轻微警告继续迭代）

## 说明

* 不改动业务功能，仅修复CI与契约一致性；如仍有Windows路径问题，再退回到手动`pnpm cypress run`策略

