# Capacitor 插件兼容性评估报告

> **版本**: v1.0
> **评估日期**: 2025-12-13
> **评估者**: Claude Opus 4.5
> **关联文档**: 09 - APP-FIRST架构改造计划.md - Phase 0

---

## 1. 评估概述

本报告评估 App-First 架构改造所需的 Capacitor 插件兼容性，重点关注 SQLite 和文件系统相关插件。

---

## 2. 核心依赖插件

### 2.1 @capacitor-community/sqlite

| 项目 | 说明 |
|:-----|:-----|
| **版本** | ^6.0.0 (推荐) |
| **用途** | 移动端 SQLite 数据库访问 |
| **平台支持** | iOS 13+, Android 6.0+ (API 23+) |
| **Web 支持** | ❌ 不支持 (需配合 sql.js/sqlite-wasm) |
| **加密支持** | ✅ SQLCipher (需额外配置) |
| **兼容性评估** | ✅ 完全兼容 |

**注意事项**:
- iOS 需要在 `Info.plist` 中添加 `UIFileSharingEnabled` 和 `LSSupportsOpeningDocumentsInPlace`
- Android 需要在 `AndroidManifest.xml` 中添加 `android:allowBackup="false"`

### 2.2 @capacitor/filesystem

| 项目 | 说明 |
|:-----|:-----|
| **版本** | ^6.0.0 |
| **用途** | 书籍文件存储 (EPUB/PDF) |
| **平台支持** | iOS 13+, Android 6.0+ |
| **Web 支持** | ⚠️ 有限 (使用 IndexedDB 模拟) |
| **兼容性评估** | ✅ 完全兼容 |

**存储位置建议**:
- `Directory.Data`: SQLite 数据库文件
- `Directory.Library`: 书籍文件 (iOS 不会被 iCloud 备份)
- `Directory.External`: 大文件缓存 (Android)

### 2.3 @powersync/web

| 项目 | 说明 |
|:-----|:-----|
| **版本** | ^0.8.0 (最新稳定版) |
| **用途** | Web 端 PowerSync SDK + sqlite-wasm |
| **平台支持** | 现代浏览器 (Chrome 90+, Safari 15.4+, Firefox 100+) |
| **OPFS 支持** | ✅ 需要 HTTPS 或 localhost |
| **兼容性评估** | ✅ 完全兼容 |

**注意事项**:
- OPFS (Origin Private File System) 需要 HTTPS 环境
- Safari < 15.4 不支持 OPFS，需要 fallback 到 IndexedDB
- Web Worker 模式需要配置 COOP/COEP headers

### 2.4 @powersync/react

| 项目 | 说明 |
|:-----|:-----|
| **版本** | ^0.8.0 |
| **用途** | React hooks 封装 (useLiveQuery 等) |
| **依赖** | @powersync/web |
| **兼容性评估** | ✅ 完全兼容 |

---

## 3. 平台兼容性矩阵

| 功能 | iOS (Capacitor) | Android (Capacitor) | Web (PWA) |
|:-----|:---------------:|:-------------------:|:---------:|
| SQLite 本地存储 | ✅ capacitor-sqlite | ✅ capacitor-sqlite | ✅ sqlite-wasm + OPFS |
| PowerSync 同步 | ✅ @powersync/react-native | ✅ @powersync/react-native | ✅ @powersync/web |
| 文件存储 | ✅ Filesystem | ✅ Filesystem | ⚠️ 有限 |
| 后台同步 | ✅ Background Fetch | ✅ WorkManager | ⚠️ Service Worker |
| 离线检测 | ✅ Network plugin | ✅ Network plugin | ✅ navigator.onLine |

---

## 4. 所需依赖包

### 4.1 Web 端

```bash
pnpm add @powersync/web @powersync/react
```

### 4.2 移动端 (Capacitor)

```bash
# Capacitor 核心
pnpm add @capacitor/core @capacitor/cli
pnpm add @capacitor/ios @capacitor/android

# 移动端插件
pnpm add @capacitor-community/sqlite
pnpm add @capacitor/filesystem
pnpm add @capacitor/network
pnpm add @capacitor/preferences
pnpm add @capacitor/device

# PowerSync 移动端 SDK
pnpm add @powersync/react-native
```

---

## 5. 风险评估

### 5.1 高风险

| 风险 | 影响 | 缓解措施 |
|:-----|:-----|:---------|
| sqlite-wasm 在旧版 Safari 不工作 | Web 用户无法使用 | 检测 OPFS 支持，fallback 到 Dexie |
| OPFS 需要 HTTPS | 本地开发受影响 | 使用 localhost 例外 |

### 5.2 中风险

| 风险 | 影响 | 缓解措施 |
|:-----|:-----|:---------|
| capacitor-sqlite 版本升级 | API 变更 | 锁定主版本号 |
| PowerSync SDK 版本变更 | 同步逻辑变化 | 严格测试 + 回滚机制 |

### 5.3 低风险

| 风险 | 影响 | 缓解措施 |
|:-----|:-----|:---------|
| Android WebView 版本差异 | 部分设备异常 | 设置最低 Android 版本要求 |

---

## 6. 浏览器兼容性检测

```typescript
/**
 * 检测当前环境是否支持 App-First 架构
 */
export function checkAppFirstSupport(): {
  supported: boolean
  opfsSupported: boolean
  wasmSupported: boolean
  reason?: string
} {
  const wasmSupported = typeof WebAssembly !== 'undefined'
  
  // OPFS 支持检测
  const opfsSupported = 
    typeof navigator !== 'undefined' &&
    'storage' in navigator &&
    'getDirectory' in (navigator.storage || {})
  
  if (!wasmSupported) {
    return {
      supported: false,
      opfsSupported,
      wasmSupported,
      reason: 'WebAssembly not supported',
    }
  }
  
  // 即使没有 OPFS，也可以用 IndexedDB 作为 fallback
  return {
    supported: true,
    opfsSupported,
    wasmSupported,
  }
}
```

---

## 7. 结论与建议

### 7.1 结论

**✅ 评估通过** - 所有核心插件均满足 App-First 架构需求。

### 7.2 建议

1. **Phase 1**: 先在 Web 端实现 PowerSync + sqlite-wasm
2. **Phase 2**: 再添加 Capacitor 移动端支持
3. **测试优先**: 在 CI 中添加浏览器兼容性测试
4. **渐进式回退**: 保留 Dexie 作为 fallback 至少 2 个版本周期

---

## 8. 参考资料

1. [Capacitor Community SQLite](https://github.com/capacitor-community/sqlite)
2. [PowerSync Documentation](https://docs.powersync.com/)
3. [OPFS Browser Support](https://caniuse.com/native-filesystem-api)
4. [sqlite-wasm](https://github.com/nicebyte/nicebyte.github.io/tree/main/sql.js-httpvfs)
