# 🌍 Tolgee 多语言配置指南

## 问题诊断
如果您在 Tolgee 平台添加语言后，前端无法加载翻译，请按以下步骤检查。

## ✅ 关键配置检查清单

### 1. Tolgee 项目配置（http://localhost:8085）

#### 1.1 确认语言标签格式
Tolgee 中的语言标签必须与前端代码一致：
- ✅ 正确：`en-US`、`zh-CN`
- ❌ 错误：`en`、`zh`、`en_US`、`zh_CN`

**操作步骤**：
1. 登录 Tolgee → 进入 "Athena Web" 项目
2. 点击 "Languages"
3. 检查语言标签（Tag）是否为 `en-US` 和 `zh-CN`
4. 如果不是，删除旧语言，重新添加正确的标签

#### 1.2 确认命名空间（Namespace）
Tolgee 项目必须包含以下命名空间：
- `landing` - 首页翻译
- `common` - 通用翻译
- `auth` - 登录/注册翻译

**操作步骤**：
1. 在 Tolgee 项目中，点击 "Keys"
2. 查看 Key 的命名格式，例如：
   - `landing:hero.title`
   - `common:homepage.title`
   - `auth:login`
3. **重要**：冒号前的部分是命名空间，必须匹配上述三个值

#### 1.3 导入现有翻译
如果您还没有在 Tolgee 中导入翻译内容：

1. 进入 Tolgee 项目 → "Import"
2. 上传 `web/src/locales/en-US/landing.json`
   - 选择语言：`en-US`
   - 选择命名空间：`landing`
3. 重复上述步骤，导入：
   - `en-US/common.json` → 语言：`en-US`，命名空间：`common`
   - `en-US/auth.json` → 语言：`en-US`，命名空间：`auth`

### 2. 前端配置检查

#### 2.1 环境变量（`.env.local`）
确认文件中包含：
```env
VITE_APP_TOLGEE_API_URL=http://localhost:8085
VITE_APP_TOLGEE_API_KEY=tgpak_... (您的 API Key)
```

#### 2.2 验证 API Key 权限
1. 进入 Tolgee 项目 → "Integrations" → "API Keys"
2. 确认您的 API Key 拥有 **Read** 权限

### 3. 重启服务

配置修改后，必须重启：
```bash
# 停止 Docker Compose
docker-compose down

# 重启（包括 Tolgee）
docker-compose up -d

# 重启前端
cd web
pnpm dev
```

## 🔍 调试步骤

### 步骤 1：检查浏览器控制台
打开 `http://localhost:5173/`，按 F12 打开控制台：

**期望看到**：
```
✅ Tolgee initialized successfully
📚 Current language: en-US
```

**如果看到错误**：
- ❌ `401 Unauthorized` → API Key 无效或无权限
- ❌ `404 Not Found` → 项目不存在或 API URL 错误
- ❌ `CORS error` → Tolgee 服务未启动

### 步骤 2：测试 Tolgee API
在浏览器中访问（替换 YOUR_API_KEY）：
```
http://localhost:8085/v2/projects/current/languages
```
添加 Header：`X-API-Key: YOUR_API_KEY`

**期望返回**：
```json
[
  { "tag": "en-US", "name": "English" },
  { "tag": "zh-CN", "name": "Chinese (Simplified)" }
]
```

### 步骤 3：手动切换语言测试
1. 打开浏览器控制台（F12）
2. 执行：
   ```javascript
   i18n.changeLanguage('zh-CN')
   ```
3. 观察页面文字是否变化

## ⚠️ 常见问题

### Q1: 切换语言后，部分文字仍是英文
**原因**：Tolgee 中缺少对应的翻译 Key

**解决**：
1. 按 `Alt` + 点击未翻译的文字（Tolgee In-Context 编辑）
2. 或者在 Tolgee 后台手动添加翻译

### Q2: 语言切换器中没有显示中文选项
**原因**：Tolgee API 未返回 `zh-CN` 语言

**解决**：
1. 检查 Tolgee 项目中是否添加了 `zh-CN` 语言
2. 确认 API Key 有读取权限
3. 查看浏览器控制台 Network 面板，确认 `/v2/projects/current/languages` 请求成功

### Q3: 刷新页面后语言重置
**原因**：localStorage 未正确保存语言偏好

**解决**：
检查浏览器 localStorage：
```javascript
localStorage.getItem('i18nextLng')
```
应该返回 `'en-US'` 或 `'zh-CN'`

## 🚀 最佳实践

1. **在 Tolgee 中统一管理翻译**：不要手动编辑 `locales/*.json` 文件
2. **使用 In-Context 编辑**：按住 `Alt` 键点击文字，直接在页面上修改翻译
3. **定期导出备份**：从 Tolgee 导出翻译文件作为备份

## 📞 仍然无法解决？

请提供以下信息：
1. 浏览器控制台截图
2. Tolgee Languages 页面截图
3. `.env.local` 文件内容（隐藏 API Key）
