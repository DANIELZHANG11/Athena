### 🛡️ 雅典娜计划：CI/CD 修复五大宪章以及最新的错误提示：

项目仓库地址：git@github.com:DANIELZHANG11/Athena.git

#### 1. “架构降级”零容忍原则 (No Architectural Regression)
*   **场景**：如果计费测试挂了，报错说“数据库锁超时”或“事务回滚”。
*   **原则**：**绝对不允许**为了让测试通过，而移除 `FOR UPDATE` 锁或 `atomic update`（原子更新）逻辑。**绝对不允许**把数据库事务拆散。
*   **指令话术**：*“修复这个测试错误，但**严禁**修改计费的原子性逻辑。如果是测试用例写得不对（比如没模拟好并发环境），请修改测试用例，而不是修改业务代码。”*

#### 2. DDL 隔离原则 (Migration Sanctity)
*   **场景**：如果测试报错说 `Table 'users' already exists` 或 `Relation not found`。
*   **原则**：**严禁**在代码里加回 `CREATE TABLE IF NOT EXISTS`。
*   **原因**：这是我们刚刚费劲清理掉的“毒瘤”。
*   **指令话术**：*“检查 Alembic 迁移脚本是否在 CI 环境中正确执行了。如果是表结构缺失，请新增 Alembic 版本文件，**绝不许**在业务代码里写 SQL 建表语句。”*

#### 3. 真实服务 vs 测试 Mock 的边界原则
*   **场景**：现在代码里集成了 `PaddleOCR` 和 `BGE-M3`，这些库很大，CI 环境（GitHub Actions）可能跑不动或者没显卡，导致安装超时或内存溢出报错。
*   **原则**：**CI 环境中允许使用 Mock，但生产环境必须用真家伙。**
*   **指令话术**：*“CI 环境资源有限。请确保 `conftest.py` 或测试配置中，能够检测 `TESTING` 环境变量。在测试运行时，自动注入 `MockOCR` 和 `MockEmbedder` 来替代真实的 `PaddleOCR`，但在 Docker 生产镜像构建时，必须保留真实库的依赖。”*

#### 4. 依赖锁定原则 (Dependency Strictness)
*   **场景**：报错 `ModuleNotFoundError` 或 `VersionConflict`。
*   **原则**：不要随意升级或降级核心库（尤其是 `fastapi`, `sqlalchemy`, `pydantic`）。
*   **指令话术**：*“请分析依赖冲突的原因。如果需要添加新库（如 `paddleocr`），请确保它与现有的 `python 3.11` 环境兼容，并将精确版本号写入 `requirements.txt`。”*

#### 5. 基础设施对齐原则 (Infra Alignment)
*   **场景**：测试报错 `Connection Refused` 连接不上 `s3://...` 或 `opensearch`。
*   **原则**：代码已经改成了 SeaweedFS 和 OpenSearch，但 CI 的配置文件（如 `.github/workflows/main.yml` 或 `tests/docker-compose.test.yml`）可能还没改，还在用 MinIO/ES。
*   **指令话术**：*“不要修改后端连接代码。请检查 CI 的配置文件和服务定义，确保测试环境启动的是 `seaweedfs` 和 `opensearch`，且端口映射与后端代码中的配置一致。”*

---

### 🚑 针对常见报错的“急救包” (Cheat Sheet)

当看到以下错误时，直接复制对应的指令给 AI：

**情况 A：Lint/Format 错误 (Flake8, Black, Isort)**
> **指令**：*“这是代码风格问题。请直接运行格式化工具修复所有 lint 错误，不要修改任何业务逻辑。”*

**情况 B：Mypy 类型检查错误 (Type Mismatch)**
> **指令**：*“请修复类型注解错误。如果是第三方库（如 paddleocr）缺少类型定义，可以使用 `# type: ignore` 临时规避，但不要修改变量的实际类型。”*

**情况 C：Docker 构建失败 (Build Failure)**
> **指令**：*“Docker 构建失败。请检查 `Dockerfile`。如果是 PaddleOCR 或 PyTorch 导致镜像过大或下载超时，请尝试使用国内镜像源或精简版基础镜像，并确保使用多阶段构建（Multi-stage build）减小体积。”*

**情况 D：数据库迁移失败 (Alembic Divergence)**
> **指令**：*“数据库模型与迁移脚本不一致。请不要修改模型。请生成一个新的 `alembic revision --autogenerate` 脚本来对齐数据库状态。”*

---
修复，调整或补全代码后，重新推送至GITHUB仓库进行验证



Run flake8 api --count --select=E9,F63,F7,F82 --show-source --statistics
0
api/__init__.py:1:1: W391 blank line at end of file
api/app/__init__.py:1:1: W391 blank line at end of file
api/app/admin.py:28:128: E501 line too long (141 > 127 characters)
api/app/admin.py:70:128: E501 line too long (136 > 127 characters)
api/app/admin.py:77:128: E501 line too long (254 > 127 characters)
api/app/admin.py:91:128: E501 line too long (153 > 127 characters)
api/app/admin.py:98:128: E501 line too long (217 > 127 characters)
api/app/admin.py:111:128: E501 line too long (145 > 127 characters)
api/app/admin.py:148:128: E501 line too long (159 > 127 characters)
api/app/admin.py:175:128: E501 line too long (243 > 127 characters)
api/app/admin.py:245:128: E501 line too long (288 > 127 characters)
api/app/admin.py:270:128: E501 line too long (198 > 127 characters)
api/app/admin.py:289:128: E501 line too long (155 > 127 characters)
api/app/admin.py:302:128: E501 line too long (135 > 127 characters)
api/app/admin.py:330:128: E501 line too long (134 > 127 characters)
api/app/admin.py:364:128: E501 line too long (162 > 127 characters)
api/app/admin.py:399:128: E501 line too long (287 > 127 characters)
api/app/admin_panel.py:30:128: E501 line too long (141 > 127 characters)
api/app/admin_panel.py:62:128: E501 line too long (190 > 127 characters)
api/app/admin_panel.py:75:128: E501 line too long (135 > 127 characters)
api/app/admin_panel.py:116:128: E501 line too long (438 > 127 characters)
api/app/admin_panel.py:154:128: E501 line too long (293 > 127 characters)
api/app/admin_panel.py:197:128: E501 line too long (188 > 127 characters)
api/app/admin_panel.py:233:128: E501 line too long (180 > 127 characters)
api/app/admin_panel.py:276:128: E501 line too long (294 > 127 characters)
api/app/admin_panel.py:297:128: E501 line too long (138 > 127 characters)
api/app/ai.py:74:128: E501 line too long (170 > 127 characters)
api/app/ai.py:82:36: E203 whitespace before ':'
api/app/ai.py:87:31: E203 whitespace before ':'
api/app/ai.py:97:128: E501 line too long (175 > 127 characters)
api/app/ai.py:109:128: E501 line too long (288 > 127 characters)
api/app/ai.py:138:128: E501 line too long (135 > 127 characters)
api/app/ai.py:169:128: E501 line too long (285 > 127 characters)
api/app/ai.py:182:128: E501 line too long (168 > 127 characters)
api/app/auth.py:142:128: E501 line too long (217 > 127 characters)
api/app/auth.py:212:128: E501 line too long (151 > 127 characters)
api/app/billing.py:32:128: E501 line too long (135 > 127 characters)
api/app/billing.py:37:128: E501 line too long (177 > 127 characters)
api/app/billing.py:65:128: E501 line too long (217 > 127 characters)
api/app/billing.py:96:128: E501 line too long (155 > 127 characters)
api/app/billing.py:140:128: E501 line too long (244 > 127 characters)
api/app/billing.py:187:128: E501 line too long (193 > 127 characters)
api/app/billing.py:213:128: E501 line too long (132 > 127 characters)
api/app/billing.py:226:128: E501 line too long (143 > 127 characters)
api/app/billing.py:231:128: E501 line too long (151 > 127 characters)
api/app/billing.py:238:128: E501 line too long (233 > 127 characters)
api/app/billing.py:268:128: E501 line too long (135 > 127 characters)
api/app/billing.py:273:128: E501 line too long (181 > 127 characters)
api/app/billing.py:283:128: E501 line too long (185 > 127 characters)
api/app/billing.py:291:1: C901 'exchange' is too complex (11)
api/app/billing.py:307:128: E501 line too long (135 > 127 characters)
api/app/billing.py:337:128: E501 line too long (243 > 127 characters)
api/app/billing.py:347:128: E501 line too long (215 > 127 characters)
api/app/billing.py:353:128: E501 line too long (220 > 127 characters)
api/app/billing.py:362:128: E501 line too long (236 > 127 characters)
api/app/billing.py:372:128: E501 line too long (219 > 127 characters)
api/app/billing.py:378:128: E501 line too long (216 > 127 characters)
api/app/billing.py:400:128: E501 line too long (135 > 127 characters)
api/app/billing.py:407:128: E501 line too long (157 > 127 characters)
api/app/billing.py:414:128: E501 line too long (208 > 127 characters)
api/app/billing.py:422:128: E501 line too long (146 > 127 characters)
api/app/billing.py:429:128: E501 line too long (213 > 127 characters)
api/app/books.py:47:1: C901 '_quick_confidence' is too complex (11)
api/app/books.py:96:1: C901 'upload_complete' is too complex (12)
api/app/books.py:151:128: E501 line too long (165 > 127 characters)
api/app/books.py:213:128: E501 line too long (177 > 127 characters)
api/app/books.py:265:128: E501 line too long (172 > 127 characters)
api/app/books.py:290:128: E501 line too long (201 > 127 characters)
api/app/books.py:320:128: E501 line too long (142 > 127 characters)
api/app/books.py:390:128: E501 line too long (158 > 127 characters)
api/app/books.py:406:1: C901 'list_books' is too complex (16)
api/app/books.py:423:128: E501 line too long (140 > 127 characters)
api/app/books.py:429:128: E501 line too long (198 > 127 characters)
api/app/books.py:509:1: C901 'get_book' is too complex (12)
api/app/books.py:520:128: E501 line too long (139 > 127 characters)
api/app/books.py:610:128: E501 line too long (152 > 127 characters)
api/app/books.py:662:128: E501 line too long (177 > 127 characters)
api/app/books.py:810:128: E501 line too long (204 > 127 characters)
api/app/books.py:817:128: E501 line too long (187 > 127 characters)
api/app/books.py:848:128: E501 line too long (205 > 127 characters)
api/app/books.py:865:128: E501 line too long (175 > 127 characters)
api/app/books.py:881:128: E501 line too long (140 > 127 characters)
api/app/books.py:895:128: E501 line too long (188 > 127 characters)
api/app/books.py:931:128: E501 line too long (178 > 127 characters)
api/app/books.py:941:128: E501 line too long (281 > 127 characters)
api/app/books.py:950:128: E501 line too long (143 > 127 characters)
api/app/books.py:962:128: E501 line too long (173 > 127 characters)
api/app/books.py:969:128: E501 line too long (151 > 127 characters)
api/app/books.py:976:128: E501 line too long (233 > 127 characters)
api/app/books.py:982:128: E501 line too long (183 > 127 characters)
api/app/books.py:1012:128: E501 line too long (130 > 127 characters)
api/app/books.py:1038:128: E501 line too long (140 > 127 characters)
api/app/books.py:1141:128: E501 line too long (131 > 127 characters)
api/app/books.py:1257:128: E501 line too long (141 > 127 characters)
api/app/dict.py:38:128: E501 line too long (197 > 127 characters)
api/app/dict.py:65:128: E501 line too long (189 > 127 characters)
api/app/dict.py:87:128: E501 line too long (212 > 127 characters)
api/app/dict.py:133:128: E501 line too long (218 > 127 characters)
api/app/dict.py:162:128: E501 line too long (185 > 127 characters)
api/app/docs.py:33:128: E501 line too long (137 > 127 characters)
api/app/docs.py:57:128: E501 line too long (131 > 127 characters)
api/app/export.py:40:128: E501 line too long (131 > 127 characters)
api/app/export.py:72:128: E501 line too long (181 > 127 characters)
api/app/export.py:111:128: E501 line too long (186 > 127 characters)
api/app/main.py:148:128: E501 line too long (213 > 127 characters)
api/app/notes.py:58:128: E501 line too long (171 > 127 characters)
api/app/notes.py:78:128: E501 line too long (171 > 127 characters)
api/app/notes.py:117:128: E501 line too long (176 > 127 characters)
api/app/notes.py:135:128: E501 line too long (147 > 127 characters)
api/app/notes.py:168:128: E501 line too long (287 > 127 characters)
api/app/notes.py:184:128: E501 line too long (135 > 127 characters)
api/app/notes.py:211:128: E501 line too long (316 > 127 characters)
api/app/notes.py:218:128: E501 line too long (247 > 127 characters)
api/app/notes.py:253:128: E501 line too long (172 > 127 characters)
api/app/notes.py:302:128: E501 line too long (433 > 127 characters)
api/app/notes.py:323:128: E501 line too long (135 > 127 characters)
api/app/notes.py:346:128: E501 line too long (148 > 127 characters)
api/app/notes.py:380:128: E501 line too long (262 > 127 characters)
api/app/notes.py:395:128: E501 line too long (141 > 127 characters)
api/app/notes.py:423:128: E501 line too long (206 > 127 characters)
api/app/notes.py:483:128: E501 line too long (342 > 127 characters)
api/app/notes.py:504:128: E501 line too long (145 > 127 characters)
api/app/notes.py:528:128: E501 line too long (153 > 127 characters)
api/app/ocr.py:27:128: E501 line too long (154 > 127 characters)
api/app/ocr.py:39:1: C901 'complete_job' is too complex (12)
api/app/ocr.py:52:128: E501 line too long (160 > 127 characters)
api/app/ocr.py:58:128: E501 line too long (171 > 127 characters)
api/app/ocr.py:90:128: E501 line too long (172 > 127 characters)
api/app/ocr.py:100:128: E501 line too long (275 > 127 characters)
api/app/ocr.py:108:128: E501 line too long (233 > 127 characters)
api/app/ocr.py:116:128: E501 line too long (143 > 127 characters)
api/app/ocr.py:131:128: E501 line too long (165 > 127 characters)
api/app/ocr.py:138:128: E501 line too long (231 > 127 characters)
api/app/ocr.py:162:128: E501 line too long (155 > 127 characters)
api/app/ocr.py:169:128: E501 line too long (231 > 127 characters)
api/app/ocr.py:175:128: E501 line too long (138 > 127 characters)
api/app/ocr.py:191:128: E501 line too long (177 > 127 characters)
api/app/pricing.py:23:128: E501 line too long (159 > 127 characters)
api/app/pricing.py:77:128: E501 line too long (194 > 127 characters)
api/app/pricing.py:110:128: E501 line too long (227 > 127 characters)
api/app/profile.py:20:128: E501 line too long (157 > 127 characters)
api/app/profile.py:51:128: E501 line too long (140 > 127 characters)
api/app/profile.py:95:128: E501 line too long (145 > 127 characters)
api/app/reader.py:31:128: E501 line too long (205 > 127 characters)
api/app/reader.py:52:128: E501 line too long (141 > 127 characters)
api/app/reader.py:61:128: E501 line too long (174 > 127 characters)
api/app/reader.py:68:128: E501 line too long (147 > 127 characters)
api/app/reader.py:74:128: E501 line too long (256 > 127 characters)
api/app/reader.py:87:128: E501 line too long (178 > 127 characters)
api/app/reader.py:93:128: E501 line too long (314 > 127 characters)
api/app/reader.py:100:128: E501 line too long (151 > 127 characters)
api/app/reader.py:106:128: E501 line too long (260 > 127 characters)
api/app/reader.py:119:128: E501 line too long (419 > 127 characters)
api/app/reader.py:135:128: E501 line too long (189 > 127 characters)
api/app/reader.py:163:128: E501 line too long (175 > 127 characters)
api/app/reader.py:191:128: E501 line too long (143 > 127 characters)
api/app/realtime.py:30:128: E501 line too long (163 > 127 characters)
api/app/realtime.py:46:128: E501 line too long (192 > 127 characters)
api/app/realtime.py:53:1: C901 'ws_note' is too complex (17)
api/app/search.py:16:1: C901 'search' is too complex (27)
api/app/search.py:173:128: E501 line too long (200 > 127 characters)
api/app/search.py:196:128: E501 line too long (210 > 127 characters)
api/app/search.py:199:128: E501 line too long (140 > 127 characters)
api/app/search.py:219:128: E501 line too long (156 > 127 characters)
api/app/search.py:253:128: E501 line too long (182 > 127 characters)
api/app/search.py:261:128: E501 line too long (194 > 127 characters)
api/app/search.py:278:128: E501 line too long (146 > 127 characters)
api/app/search.py:286:128: E501 line too long (158 > 127 characters)
api/app/search.py:306:128: E501 line too long (150 > 127 characters)
api/app/srs.py:45:128: E501 line too long (176 > 127 characters)
api/app/srs.py:61:128: E501 line too long (290 > 127 characters)
api/app/srs.py:96:128: E501 line too long (162 > 127 characters)
api/app/srs.py:107:128: E501 line too long (182 > 127 characters)
api/app/srs.py:123:128: E501 line too long (240 > 127 characters)
api/app/tasks.py:89:128: E501 line too long (153 > 127 characters)
api/app/tasks.py:134:128: E501 line too long (138 > 127 characters)
api/app/tasks.py:159:128: E501 line too long (153 > 127 characters)
api/app/tasks.py:205:128: E501 line too long (202 > 127 characters)
api/app/translate.py:59:128: E501 line too long (198 > 127 characters)
api/app/translate.py:80:128: E501 line too long (147 > 127 characters)
api/app/translate.py:87:128: E501 line too long (200 > 127 characters)
api/app/tts.py:47:128: E501 line too long (178 > 127 characters)
api/app/tts.py:64:128: E501 line too long (141 > 127 characters)
api/app/tts.py:68:128: E501 line too long (185 > 127 characters)
api/app/tts.py:107:128: E501 line too long (203 > 127 characters)
api/app/tts.py:118:128: E501 line too long (211 > 127 characters)
8     C901 'exchange' is too complex (11)
2     E203 whitespace before ':'
174   E501 line too long (141 > 127 characters)
2     W391 blank line at end of file
186
All done! ✨ 🍰 ✨
46 files would be left unchanged.
ERROR: /home/runner/work/Athena/Athena/api/app/notes.py Imports are incorrectly sorted and/or formatted.
ERROR: /home/runner/work/Athena/Athena/api/app/books.py Imports are incorrectly sorted and/or formatted.
Error: Process completed with exit code 1.