# 🌍 雅典娜翻译平台 (Tolgee)

我们已升级翻译系统，采用 **Tolgee** 企业级本地化平台。这支持 GitOps 工作流和所见即所得的上下文编辑。

## 🚀 快速开始

### 1. 访问平台
Tolgee 已在本地运行：
👉 **http://localhost:8085**

**默认账号：**
- 用户名: `admin`
- 密码: `admin`

### 2. 设置项目
1. 登录 Tolgee。
2. 点击 **"Add project"** (添加项目)。
3. 命名为 `Athena Web`。
4. 添加语言：
   - `English (en-US)` (基础语言)
   - `Chinese (Simplified) (zh-CN)`
5. 点击 **"Save"** (保存)。

### 3. 获取 API Key
1. 进入新创建的项目仪表盘。
2. 点击侧边栏的 **"Integrations"** (集成)。
3. 选择 **"React"** (或者直接找 API keys)。
4. 创建一个新的 API Key，选择 **"All scopes"** (开发用)。
5. 复制这个 API Key。

### 4. 配置前端
打开 `web/` 目录下的 `.env.local` 文件并添加：

```env
VITE_TOLGEE_API_URL=http://localhost:8085
VITE_TOLGEE_API_KEY=tgpk_... (粘贴你的 Key)
```

### 5. 导入现有翻译
为了保留现有的翻译内容：
1. 进入 Tolgee 项目 > **Import** (导入)。
2. 上传 `web/src/locales/en/landing.json` -> 选择 `en-US` 和 namespace `landing`。
3. 上传 `web/src/locales/zh-CN/landing.json` -> 选择 `zh-CN` 和 namespace `landing`。
4. 对 `common.json` 和 `auth.json` 重复上述步骤。

## ✨ 特性

- **上下文编辑 (In-Context Editing)**: 按住 `Alt` 键并点击网页上的任何文字，即可直接编辑！
- **自动截图**: 自动上传截图到 Tolgee 以提供翻译上下文。
- **翻译记忆**: 复用之前的翻译。

## 🔄 工作流

1. **开发**: 在代码中使用 `t('new.key', 'Default Text')` 添加新 Key。
2. **翻译**: 前往 Tolgee 界面 (或 Alt+Click) 添加翻译。
3. **同步**: (未来) 设置 CI/CD 自动拉取翻译。目前在开发模式下，翻译会从 Tolgee 动态加载。
