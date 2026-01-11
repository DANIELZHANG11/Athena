# 10 - 测试策略与质量保证 | Test Strategy & QA

> **“首版即完美”** 是雅典娜项目的核心追求。为了实现这一目标，我们需要从代码层面的静态检查、单元测试，到业务层面的集成测试、E2E测试，构建一套无死角的质量保证体系。

## 1. 质量目标 (Quality Goals)

我们的目标是建立 **100% 的可信度 (Confidence)**，而不仅仅是 100% 的代码覆盖率。

*   **架构合规性**: 100% 遵守 8 大宪章 (已完成)。
*   **核心业务逻辑**: 100% 单元测试覆盖 (API Services, Frontend Hooks/Utils)。
*   **关键用户旅程**: 100% E2E 测试覆盖 (Critical User Journeys)。
*   **零回归**: 任何 Bug 修复必须伴随回归测试用例。

## 2. 现状差距分析 (Gap Analysis)

| 测试层级 | 当前状态 | 覆盖率估计 | 风险等级 |
|:---------|:---------|:-----------|:---------|
| **L1: 宪章检查** (CI) | ✅ 完善 | 100% | 低 |
| **L2: 后端单元测试** (Pytest) | ⚠️ 部分缺失 | ~60% | 中 |
| **L3: 前端单元测试** (Vitest) | ❌ 严重缺失 | < 5% | **极高** |
| **L4: 集成测试** (API+DB) | ⚠️ 部分覆盖 | ~40% | 中 |
| **L5: E2E 测试** (Cypress) | ⚠️ 仅基础 | ~20% | 高 |

### 主要痛点
1.  **前端“裸奔”**: 核心组件（阅读器、笔记、AI对话）和复杂Hooks缺乏保护，重构极易引入Bug。
2.  **RAG 链路黑盒**: 向量索引、检索、生成这一长链路缺乏集成测试。
3.  **同步逻辑复杂**: Offline-First 的同步冲突处理缺乏针对性测试。

## 3. 测试分层策略 (Test Pyramid)

### L1: 静态分析与宪章 (Static Analysis)
- **工具**: 8大宪章脚本, ESLint, TypeScript, MyPy, Flake8
- **目标**: 拦截所有架构违规和低级语法错误。
- **CI 门禁**: 必须全部通过。

### L2: 单元测试 (Unit Tests)
- **后端 (Pytest)**:
    - 覆盖 `services/` 下的所有业务逻辑。
    - Mock 外部依赖 (S3, OpenSearch, LLM API)。
- **前端 (Vitest)**:
    - **Hooks**: 测试 `useReader`, `useSync`, `useNotesData` 等状态逻辑。
    - **Utils**: 测试数据转换、格式化函数。
    - **Components**: 测试原子组件的渲染和交互 (使用 React Testing Library)。

### L3: 集成测试 (Integration Tests)
- **后端**: 测试 API 接口与真实数据库 (Postgres/Redis) 的交互。对于 LLM/OCR 继续使用 Mock 或 Sandbox 环境。
- **前端**: 测试页面级组件 (Pages) 的数据加载和状态流转。

### L4: 端到端测试 (E2E Tests)
- **工具**: Cypress
- **覆盖**: 模拟真实用户操作，覆盖核心路径。
- **环境**: 真实的前后端容器环境 (Docker Compose)。

## 4. 实施路线图 (Implementation Roadmap)

### 第一阶段：前端补课 (Phase 1: Frontend Foundation) [P0]
**目标**: 建立前端测试基准，覆盖最脆弱的逻辑。
- [ ] 配置 Vitest 全局覆盖率报告 (Coverage > 0%)。
- [ ] 测试核心 Utils (`epub-parser`, `color-utils`).
- [ ] 测试核心 Hooks (`useNotesData`, `useFontDownload`).
- [ ] 测试核心组件 (`NoteEditor`, `HighlightToolbar`).

### 第二阶段：后端强化 (Phase 2: Backend Hardening) [P1]
**目标**: 补全 AI 和同步模块的测试。
- [ ] 对接 `llama_rag` 的集成测试 (使用 Mock Embedder 但真实 OpenSearch)。
- [ ] 完善 `sync_core` 的冲突解决单元测试 (覆盖 LWW 策略)。
- [ ] 补充 Celery 任务的测试用例。

### 第三阶段：E2E 关键路径 (Phase 3: Critical Journeys) [P1]
**目标**: 确保主流程不挂。
- [ ] **Journey A**: 用户登录 -> 上传 EPUB -> 打开阅读 -> 翻页。
- [ ] **Journey B**: 阅读 -> 添加高亮 -> 添加笔记 -> 验证数据同步。
- [ ] **Journey C**: 打开 AI 对话 -> 提问 -> 验证 SSE 流式响应。

### 第四阶段：覆盖率门禁 (Phase 4: Coverage Gates) [P2]
**目标**: 锁定质量基线。
- [ ] CI/CD 设置最低覆盖率门禁 (如 Backend 80%, Frontend 60%)。
- [ ] 引入 SonarQube 或 Codecov 进行可视化追踪。

## 5. 测试规范 (Testing Standards)

1.  **Arrange-Act-Assert**: 所有测试用例必须遵循 AAA 模式。
2.  **独立性**: 测试用例之间不能有状态依赖，每个测试均可独立运行。
3.  **数据清理**: 数据库测试必须在事务回滚或 fixture 清理中重置状态。
4.  **Mock 规范**: 
    - 单元测试**必须** Mock 外部 I/O。
    -集成测试**尽量**使用 Docker 容器内的真实服务 (Postgres, Redis)。
