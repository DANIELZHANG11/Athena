## 问题与根因
- Report显示在Windows Runner上执行`cypress-io/github-action@v6`时，`cypress verify`失败，二进制未安装。
- 官方提示应缓存或安装到`%LOCALAPPDATA%\Cypress\Cache`；我们当前在CI中设置的是`%USERPROFILE%\.cache\Cypress`，与期望不一致。

## 修复方案
1. 修改前端CI工作流`ci.yml`的“Ensure Cypress Binary (Windows)”步骤：
   - 将`CYPRESS_CACHE_FOLDER`改为`$env:LOCALAPPDATA\Cypress\Cache`
   - 显式执行：`npx cypress cache list` → `npx cypress install --force` → `npx cypress verify`
2. 保留现有预览+`pnpm cypress run`步骤；无需切换Runner或测试代码。
3. 若仓库中的`main.yml`也调用Cypress（目前使用Linux），保持不变；重点解决Windows路径问题。

## 预期结果
- Windows Runner上二进制安装与验证通过；Quality Gates最后一项绿灯。

## 执行
- 我将更新`ci.yml`对应步骤、提交并触发CI。