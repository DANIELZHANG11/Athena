# 03_System_Architecture_and_Decisions.md

> 版本：v2.1 (App-First Pivot)
> 最后更新：2025-12-13
> 定位：系统的物理蓝图与决策档案。任何基础设施变更必须先更新本文档。

## 1. 系统概览 (System Overview)
- Monorepo：`api`（后端）+ `web`（前端/App）+ `contracts`（OpenAPI 契约）。
- 部署：
    - **Backend**: Docker Compose (PostgreSQL, PowerSync Service, Calibre, Celery).
    - **Frontend**: **Capacitor (Android/iOS)** + Web (WASM).
- 核心理念：**App First**, **Offline First (Real)**, **Sync via PowerSync**.

## 2. 技术栈选型 (Tech Stack Matrix)

### 2.1 后端 (Backend)
- Language：Python 3.11
- Framework：FastAPI `0.115.4`
- ORM：SQLAlchemy `2.0.36`
- **Sync Engine**: **PowerSync Service (Open Edition)** [NEW]
- **Book Processing**: **Calibre CLI (ebook-polish/meta)** [NEW]
- Database：PostgreSQL + pgvector
- Task Queue：Celery `5.4.0`
- Broker/Cache：Valkey

### 2.2 前端 (Frontend/Mobile)
- Framework：React `18.3.1`
- **Mobile Runtime**: **Capacitor 6.x** [NEW]
- **Local Database**: **SQLite** (Native Plugin on Mobile, WASM on Web) [NEW]
- **Sync SDK**: **PowerSync SDK** [NEW]
- Build Tool：Vite `5.4.10`
- Language：TypeScript `^5.6.3`
- Styling：Tailwind CSS `4.1.17` + Ionic Framework (Components)
- State：Zustand (UI State), **Live Query** (Data State)

... (Existing Content Preserved: 2.3 - 2.5 Dependency Graph, etc.) ...

## 3. 离线优先架构 (App-First Architecture)

### [DEPRECATED] ADR-006: App-First v2.1 (Dexie.js)
> **状态**: **SUPERSEDED** by ADR-007
> **说明**: 原计划使用 Dexie.js + 自建心跳同步。现已废弃。原因是 IndexedDB 在移动端（尤其是 iOS）的不稳定性以及自建同步引擎的复杂性。

### [NEW] ADR-007: App-First Architecture (SQLite + PowerSync)
> **版本**: v3.0
> **状态**: **APPROVED** ✅
> **日期**: 2025-12-13

#### 核心决策
1.  **Native Edge Database**: 客户端不再使用 IndexedDB。
    -   **Mobile**: 使用 `capacitor-sqlite` 调用原生 SQLite，性能极高，无存储限制。
    -   **Web**: 使用 `sqlite-wasm` over `OPFS`，实现近似原生的性能。
2.  **Sync Engine**: 采用 **PowerSync**。
    -   **协议**: 基于流式复制 (Streaming Replication)，而非轮询 (Polling)。
    -   **一致性**: 最终一致性 (Eventual Consistency)。
3.  **Data Flow**:
    ```text
    UI <--> SQLite (Local) <--> PowerSync SDK <---(Sync)---> PowerSync Service <--> PostgreSQL
    ```
    -   前端代码**只读写本地 SQLite**，完全不直接调 API (Auth/Billing 除外)。
    -   同步在后台自动进行。

#### 数据与功能分层
-   **Auth/Billing**: 依然走 HTTPS API (FastAPI)。
-   **User Data (Notes, Progress, Settings)**: 走 PowerSync (SQLite)。
-   **Binary Assets (Covers, EPUBs)**: 走 Capacitor Filesystem + CDN (S3)。

### 3.1 PowerSync Service 拓扑

| 组件 | 配置 | 说明 |
| :--- | :--- | :--- |
| `powersync` 容器 | 镜像 `powersync/service:latest`，端口 `8090` | 通过 gRPC/WebSocket 为 SDK 提供流式同步 |
| PostgreSQL 连接 | 复用 `POSTGRES_HOST/USER/PASSWORD`，单独 schema `powersync` | 存储订阅 offset、上传队列、冲突日志 |
| sync_rules.yaml | 定义 10 个同步表（见下表）的列映射与过滤条件 | 与 `04_DB` 同步维护 |
| 监控 | `/metrics` 暴露 Prometheus 指标：`powersync_stream_lag`, `powersync_upload_errors_total` | 纳入 07_DevOps |

**PowerSync 同步表清单（共 9 个）**：
| # | 表名 | 同步方向 | 冲突策略 |
|---|:-----|:--------|:---------|
| 1 | `books` | ↕ 双向 | LWW（仅元数据：title/author/deleted_at） |
| 2 | `reading_progress` | ↕ 双向 | LWW |
| 3 | `reading_sessions` | ↕ 双向 | LWW |
| 4 | `notes` | ↕ 双向 | Conflict Copy |
| 5 | `highlights` | ↕ 双向 | Conflict Copy |
| 6 | `bookmarks` | ↕ 双向 | 无 |
| 7 | `shelves` | ↕ 双向 | 字段合并 |
| 8 | `shelf_books` | ↕ 双向 | 无 |
| 9 | `user_settings` | ↕ 双向 | JSONB 合并 |

> **权威来源**：`docker/powersync/sync_rules.yaml` + `web/src/lib/powersync/schema.ts`  
> **详细字段映射**：见 `04_Database_Schema.md` Section 3.2
> **注意**：阅读统计通过前端聚合 `reading_sessions` + `reading_progress` 计算，不作为独立同步表。 

### 3.2 客户端 SQLite 实现

1. **Web**：`sqlite-wasm` 运行于 OPFS，首次同步自动迁移 Dexie 数据；提供备份/恢复脚本。
2. **Mobile (Capacitor)**：`capacitor-community/sqlite` + 原生加密插件（可选），支持增量迁移与版本回滚。
3. **Provider 层**：`PowerSyncProvider` 包裹在 `App.tsx`，负责：
    - 初始化数据库与 schema
    - 监听网络状态并调用 SDK `connect()/disconnect()`
    - 暴露 `useLiveQuery`、`useMutation` 辅助函数
4. **数据仓储 (Repositories)**：`lib/powersync/repo/*.ts` 封装查询与写入，替代 `*Storage.ts`。

### 3.3 冲突策略

| 实体 | 策略 | 技术实现 |
| :--- | :--- | :--- |
| `reading_progress` | LWW (last_write_wins) | `updated_at` 由客户端生成，PostgreSQL 触发器比较并拒绝旧写入 |
| `notes`/`highlights` | Conflict Copy | 触发器检测同书籍+位置冲突，写入 `conflict_of` 副本，由前端提示合并 |
| `shelves`/`user_settings` | 字段级合并 (merge) | PowerSync `merge_columns` 特性 + JSONB patch |
| `books` metadata | LWW（客户端可修改） | PowerSync 允许修改 title/author/deleted_at，文件相关字段（minio_key, sha256）服务端控制 |

### 3.4 Feature Flag 设计

| 名称 | 位置 | 默认值 | 行为 |
| :--- | :--- | :--- | :--- |
| `APP_FIRST_ENABLED` | `web/src/config/featureFlags.ts` | `true` | 控制是否注入 PowerSync Provider（已启用） |
| `POWERSYNC_UPLOAD_ENABLED` | 后端环境变量 | `true` | 控制 PowerSync Service 是否允许写回 |

---

### [NEW] ADR-008: SHA256 全局去重与 OCR 复用
> **版本**: v1.0
> **状态**: **APPROVED** ✅
> **日期**: 2025-12-10

#### 核心决策
1. **存储去重**: 通过 `content_sha256` 字段实现文件级去重，相同文件只存储一份。
2. **OCR 复用**: 相同 SHA256 的书籍可复用已有 OCR 结果，实现"假 OCR"秒级完成。
3. **引用计数**: `storage_ref_count` 跟踪共享存储的引用数，支持软删除/硬删除分层策略。
4. **秒传接口**: `POST /books/dedup_reference` 允许跳过上传直接创建引用书。

> 详见 `02_Functional_Specifications_PRD.md` 中 B.1.1 节完整说明。

... (Existing Content Preserved: ADR-001 to ADR-005) ...
