## 后端修复
- 统一 S3 客户端初始化（SeaweedFS）：在 `api/app/storage.py`
  - 新增环境兼容：优先读取 `S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY`，回退 `MINIO_*`
  - `boto3.client('s3', endpoint_url=S3_ENDPOINT, aws_access_key_id, aws_secret_access_key, config=Config(s3={'addressing_style': 'path'}, signature_version='s3v4'), region_name='us-east-1')`
  - 增加 `ensure_bucket('athena')`，不存在时创建；存在则忽略冲突
  - `presigned_put(bucket,key,content_type)` 统一生成带 `ContentType`
- 服务层与路由：
  - 在 `api/app/services/book_service.py` 中调用 `ensure_bucket`，异常用 `HTTPException(status_code=500, detail=str(err))`
  - `api/app/books.py` 的 `upload_init` 包裹异常并返回明确 JSON 错误字段（避免 500 无反馈）

## 前端修复
- 令牌统一：所有请求使用 `useAuthStore().jwt`（无则回退 `localStorage.access_token`）
- 直传钩子：`web/src/hooks/useBookUpload.ts`
  - 计算 SHA-256，`POST /api/v1/books/upload_init` 校验 `res.ok`；失败抛出 `upload_init_failed`
  - 将预签名主机 `seaweed:8333` 重写为 `/s3...`（已配置 Vite 代理），`PUT` 校验 `res.ok`
  - `POST /api/v1/books/upload_complete` 返回 `data`，失败抛错
- 书库上传对话框：`web/src/pages/LibraryPage.tsx`
  - 不再使用 `upload_proxy`；改为调用 `useBookUpload().start(file)`；失败显示提示，不崩溃
  - 优化 UI：圆角卡片、毛玻璃遮罩、状态文案；`input` 增加 `id/name` 与 `label htmlFor`（修复无 label 警告）
- 首页上传：`web/src/components/upload/UploadManager.tsx`
  - 使用同一钩子；失败打印具体错误；成功派发 `book_uploaded` 并跳转书库
- 代理：`vite.config.ts` 保持 `/s3 -> http://localhost:8333`；若 SeaweedFS 非 localhost，提供 `.env` 配置覆盖
- 基础文档与可访问性：`index.html` 增加 `<!DOCTYPE html>` 与 `<html lang="zh-CN">`

## 验证
- 重启 API 容器，打开 `/login` 登录后在首页与书库分别上传 PDF/EPUB
- 检查 `upload_init` 返回 200，PUT 200，`upload_complete` 200
- 书库列表立即出现新书；首页继续阅读列表通过事件刷新

## 额外（可选）
- 启用 React Router v7 future flags：`v7_startTransition` 和 `v7_relativeSplatPath`（不影响上传，但消除警告）