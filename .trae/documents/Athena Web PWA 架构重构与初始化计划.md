## 现状核查摘要

* 目录：`src/figma/ui` 存在，承载 Shadcn 通用组件；落地页位于 `src/pages/HomePage.tsx` 与 `src/landing/*`

* 配置：`vite.config.ts` 已启用 React 与 PWA，`server.proxy` 代理 `/api` 到 `VITE_API_BASE_URL`

* 样式：`src/styles/figma.css` 已全局引入；未检测到 `tailwind.config.*`（Tailwind v4 无需传统配置文件）

* 依赖：`react-router-dom` 与 `i18next`、`zustand` 已在；`axios` 未在；`vite-plugin-pwa` 与 `tailwindcss@v4` 已在

* 入口：`index.html`、`src/main.tsx`、`src/App.tsx` 完整；`App.tsx` 当前挂载 `/` 到 `<HomePage />`

## 目录重构

* 移动：将 `src/figma/ui` 重命名为 `src/components/ui`

* 引用更新：批量替换所有 `from '@/figma/ui/*'` 为 `from '@/components/ui/*'`（将同时添加 `@` 到 Vite 别名）

* 验证：编译通过，无路径报错；落地页与通用组件仍正常渲染

## Vite 配置

* 别名：在 `vite.config.ts` 增加 `resolve.alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }`

* 局域网：启用 `server.host: true`，保持端口 `5173`

* PWA：保留现有 PWA 配置；确保 `registerSW` 仍在 `main.tsx` 使用

* 代理：保持 `/api` 代理；新增 `.env`（web）变量 `VITE_API_BASE_URL=http://localhost:8000`

## Tailwind v4 设计系统

* 变量注入：在 `src/styles/figma.css` 注入 Apple 系统设计 Token：

  * 颜色：`--color-system-blue`、`--system-background`、`--secondary-background`、`--label`、`--secondary-label`、`--tertiary-label`

  * 质感：`--liquid-glass-blur`、`--overlay`、`--separator`

* 暗色模式：使用 `@media (prefers-color-scheme: dark)` 或 `[data-theme=dark]` 覆盖 Token 值

* 工具类：以 Tailwind v4 `@utility` 定义类名映射（示例：`bg-system-background`、`text-label`、`bg-system-blue` 等），禁止硬编码颜色

* 兼容：保留现有 Shadcn 变量，不破坏已用组件

## 国际化（i18n）

* 依赖：确认已安装 `i18next` 与 React 绑定（如缺失 `react-i18next` 则补充）

* 初始化：新增 `src/i18n/config.ts`，资源含 `en` 与 `zh-CN`，命名空间 `common`、`landing`、`auth`

* 挂载：在 `main.tsx` 初始化 i18n 后再渲染；将 `HomePage` 与 `landing/*` 改为使用翻译键

* 对齐文档：参考《雅典娜技术文档.md》中现有 I18N 方案的命名与结构，逐步迁移硬编码文案到语言包

## 路由与布局

* 布局组件：新增 `src/layouts/LandingLayout.tsx`、`src/layouts/AuthLayout.tsx`、`src/layouts/AppLayout.tsx`

* 路由策略：

  * `/` → `LandingLayout`（现有落地页，加入“登录/注册”按钮）

  * `/login`、`/register` → `AuthLayout`（居中极简表单）

  * `/app/*` → `AppLayout`（核心阅读区）

* 保护：新增 `src/components/auth/AuthGuard.tsx`，受控 `/app/*`

## 认证功能

* 状态：新增 `src/stores/auth.ts`（Zustand + 持久化），保存 `jwt`、`user`、`isAuthenticated`

* 守卫：`AuthGuard` 检查 `jwt`，无则重定向 `/login`

* 页面：新增 `src/pages/auth/Login.tsx` 与 `Register.tsx`，Apple ID 风格（大标题、圆角输入、System Blue 按钮）

* 接口：使用 `fetch` 调用 `/api/v1/auth/email/send-code` 与 `/api/v1/auth/email/login`（基于 `VITE_API_BASE_URL`）

* 反馈：发送失败在 Console/Toast 提示“请查看后端控制台日志获取验证码”

## 图标与交互

* 安装或确认 `lucide-react`；统一图标在选中态提升 `strokeWidth` 以模拟 SF Symbols 变体

* 移动优先：所有新页面先完成移动端完美布局，再适配桌面端（Koodo 风格）

## 环境与后端联动

* Web `.env`：`VITE_API_BASE_URL=http://localhost:8000`

* Docker `.env`（后端）：设置 SMTP 为

  * `SMTP_HOST=smtp.exmail.qq.com`

  * `SMTP_PORT=25`

  * `SMTP_USER=webmaster@wxbooks.cn`

  * `SMTP_PASSWORD=3abGLXGxWtWvgJmz`

  * `SMTP_FROM_EMAIL=webmaster@wxbooks.cn`

* 验证：后端容器拉取与运行状态通过 `docker compose ps` 与服务访问自测（确认 8000 正常）

## 验证与自测

* 启动：`pnpm dev` 无报错，`http://localhost:5173` 打开落地页

* 路由：落地页“登录”跳转 `/login`；`/app/*` 需登录

* 交互：输入邮箱可发送请求，有 Loading 反馈；失败提示日志取码

* 局域网：手机通过本机 IP 访问样式正常

## 风险与回滚

* 引用路径替换需全量覆盖；如出现编译错误，立即还原并分批迁移

* Tailwind v4 `@utility` 类名需与 Token 一致；先以核心 Token 落地，逐步扩展

请确认上述计划，我将开始按步骤实施（先做目录重构与依赖校验）。

<br />

你需要注意：\
**优先处理目录重构**：\
第一步必须先将 web/src/figma/ui 移动并重命名为 web/src/components/ui，并**自动修复**项目中所有的引用路径（@/figma/ui -> @/components/ui），确保现有代码不报错。

1. **配置后端 SMTP（用于注册/登录）**：\
   请修改项目根目录的 .env 文件（Docker 用的那个），填入以下真实的邮件服务器配置（直接覆盖原有值）：

   **codeEnv**

   ```
   SMTP_HOST=smtp.exmail.qq.com
   SMTP_PORT=25
   SMTP_USER=webmaster@wxbooks.cn
   SMTP_PASSWORD=3abGLXGxWtWvgJmz
   SMTP_FROM_EMAIL=webmaster@wxbooks.cn
   SMTP_USE_SSL=true
   ```

   *修改后提醒我重启 Docker 容器。*
2. **国际化 (i18n) 要求**：

   * 请严格按照《雅典娜技术文档》执行。

   * 在 src/i18n 初始化时，务必建立 en 和 zh-CN 两个目录。

   * 现有官网的硬编码文案，请在此次执行中**暂不全部替换**（为了节省时间），但**新写的 Login/Register 页面**必须完全使用 i18n 键值。

