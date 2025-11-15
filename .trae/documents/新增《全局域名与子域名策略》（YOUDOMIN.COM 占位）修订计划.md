## 目标
- 基于现有文档统一并标准化“全局域名与子域名策略”，占位域名使用 YOUDOMIN.COM（URL 示例采用小写 youdomin.com）。

## 插入位置与关联更新
- 在“第一章：核心架构与技术栈”之后新增小节：**全局域名与子域名策略（新增）**。
- 与既有章节对齐：
  - SSO（登录页/SSO章节）：统一顶级域 Cookie（`.youdomin.com`）。
  - API/CORS：明确允许来源、跨域规则。
  - Landing 站点 i18n：示例 URL 采用 `https://youdomin.com/{lang}/...` 与 hreflang。
  - 动静分离/CDN：将静态资源与对象存储子域映射到该策略。

## 策略内容草案
- **主域与canonical**：
  - 站点主域：`youdomin.com`（营销站）
  - 301 重定向：`www.youdomin.com` → `youdomin.com`（或反之，保持单一 canonical）
  - 强制 HTTPS，HSTS（包含子域，预载可选）
- **核心子域**：
  - `app.youdomin.com`：Web 应用（前端）
  - `api.youdomin.com`：后端 API（REST/WebSocket）
  - `cdn.youdomin.com`：前端静态资源/CDN（营销站与应用构建产物）
  - `assets.youdomin.com`：对象存储（MinIO 签名下载/上传）
  - `admin.youdomin.com`：管理员后台
  - `docs.youdomin.com`：文档/帮助中心（可选）
  - `og.youdomin.com`：动态 OG 图片生成（可选，与营销站结合）
- **环境分域**：
  - 生产：上述域名
  - 预发：`staging.youdomin.com`、`app.staging.youdomin.com`、`api.staging.youdomin.com` 等
  - 开发：`dev.youdomin.com`、`api.dev.youdomin.com` 等（或内网）
- **SSO 与 Cookie**：
  - 顶级域 Cookie：`Domain=.youdomin.com`、`Secure`、`HttpOnly`、`SameSite=Lax`
  - 站点状态共享：`youdomin.com`（营销）与 `app.youdomin.com`（应用）共享登录态，登录按钮动态为“进入应用”
- **CORS 与安全头**：
  - CORS 允许来源：`https://app.youdomin.com`、`https://youdomin.com` 对 `https://api.youdomin.com`
  - 仅允许必要方法/头（含 `Authorization`、`Idempotency-Key`、`If-Match`）；预检缓存
  - 安全头：`Content-Security-Policy`、`X-Frame-Options`、`Referrer-Policy`
- **TLS 与证书**：
  - Traefik/LE 自动签发：`youdomin.com` 与 `*.youdomin.com`（SAN）
  - 证书续期与监控，失败回退策略
- **DNS 记录建议**：
  - A/AAAA：`youdomin.com`、`api.youdomin.com`、`app.youdomin.com`
  - CNAME：`cdn.youdomin.com` 指向 CDN 提供商；`assets.youdomin.com` 指向对象存储入口
  - 邮件：`MX`、`SPF`、`DKIM`、`DMARC`（配合 Resend）
- **SEO 与 i18n**：
  - hreflang：`https://youdomin.com/en/...`、`https://youdomin.com/zh-CN/...`、`x-default`
  - 统一 canonical 链接，避免子域重复内容
- **OG 动态图片**：
  - `og.youdomin.com` 提供动态渲染端点，页面 `og:image` 指向该域生成的图片 URL

## 文档改动清单
- 新增“全局域名与子域名策略（新增）”小节，内含上述规范与示例 URL。
- 更新 SSO 章节中的 Cookie 域示例为 `.youdomin.com`。
- 更新 Landing 文档示例 URL 与 hreflang。
- 在 API 标准补充 CORS 示例允许来源列表与跨域头。
- 在动静分离/CDN章节中映射 `cdn.youdomin.com`、`assets.youdomin.com` 并说明签名下载。

## 验证
- 全文 URL 与域名示例统一为 `youdomin.com`（小写），占位说明为 YOUDOMIN.COM。
- SSO/CORS/CDN/OG/i18n 示例与既有章节互相印证，无冲突。

如确认，我将按以上方案插入与对齐相关章节。