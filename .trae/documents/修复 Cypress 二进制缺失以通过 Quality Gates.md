## 问题
- Windows Runner 上 `cypress-io/github-action@v6` 执行时二进制缺失，`npx cypress verify`失败。
- 日志显示二进制期望路径为 `C:\Users\runneradmin\.cache\Cypress\13.17.0\Cypress\Cypress.exe`，未安装或未持久化缓存。

## 修复方案
1. 在前端 CI 的 Quality Gate 工作流中，显式安装并验证 Cypress 二进制（在执行 Action 前）
2. 统一 Cypress 缓存路径，避免默认路径差异

## 工作流修改（ci.yml）
- 在“Build”之后、Action 之前新增步骤（仅 Windows）：
  - 设置 `CYPRESS_CACHE_FOLDER` 指向 `C:\Users\runneradmin\.cache\Cypress`
  - 执行安装与验证：
    - `npx cypress install --force`
    - `npx cypress verify`
- 保留现有的预览 + `pnpm cypress run` 或 Action 执行测试步骤（二选一均可）

## 示例步骤（插入到 ci.yml）
```yaml
- name: Ensure Cypress Binary (Windows)
  if: runner.os == 'Windows'
  working-directory: web
  shell: pwsh
  env:
    CYPRESS_CACHE_FOLDER: ${{ env.USERPROFILE }}\.cache\Cypress
  run: |
    Write-Host "Cache folder: $env:CYPRESS_CACHE_FOLDER"
    npx cypress install --force
    npx cypress verify
```

## 预期结果
- Action 内的 `cypress cache list` 与 `verify`均通过，质量门禁最后一项绿灯
- 无需变更测试代码或依赖，步骤执行时间可控（~10–20s 下载安装）

## 备选（若仍失败）
- 将 `CYPRESS_CACHE_FOLDER` 改为 `C:\Users\runneradmin\AppData\Local\Cypress\Cache`
- 直接移除 Action，使用 `start-server-and-test` 与 `pnpm cypress run`

## 下一步
- 我将更新工作流，提交并触发 CI/Quality Gates 重新验证。