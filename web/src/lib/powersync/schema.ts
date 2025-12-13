/**
 * schema.ts - PowerSync SQLite Schema 定义
 * 
 * 定义客户端 SQLite 数据库的表结构
 * 与服务端 sync_rules.yaml 保持一致
 * 
 * @see 09 - APP-FIRST架构改造计划.md - Phase 2
 * @see docker/powersync/sync_rules.yaml
 * @ai-generated Claude Opus 4.5 (2025-12-13)
 */

import { column, Schema, Table } from '@powersync/web'

// ============ 书籍元数据表 ============
const books = new Table({
  // 基础信息
  user_id: column.text,
  title: column.text,
  author: column.text,
  cover_url: column.text,
  file_type: column.text,
  file_size: column.integer,
  content_sha256: column.text,
  storage_key: column.text,
  
  // 元数据状态
  metadata_extracted: column.integer, // boolean as 0/1
  metadata_confirmed: column.integer,
  pdf_type: column.text, // 'text' | 'image' | 'mixed'
  
  // OCR 状态
  ocr_status: column.text, // 'pending' | 'processing' | 'completed' | 'failed'
  ocr_version: column.text,
  
  // 格式转换
  conversion_status: column.text,
  converted_epub_key: column.text,
  
  // 时间戳
  created_at: column.text, // ISO 8601
  updated_at: column.text,
  deleted_at: column.text,
}, {
  indexes: {
    by_user: ['user_id'],
    by_sha256: ['content_sha256'],
  }
})

// ============ 阅读进度表 ============
const reading_progress = new Table({
  user_id: column.text,
  book_id: column.text,
  device_id: column.text,
  progress: column.real, // 0.0 - 1.0
  last_position: column.text, // JSON: CFI 或页码
  last_location: column.text, // JSON: 位置对象
  updated_at: column.text,
}, {
  indexes: {
    by_book: ['book_id'],
    by_user_book: ['user_id', 'book_id'],
  }
})

// ============ 阅读会话表 ============
const reading_sessions = new Table({
  user_id: column.text,
  book_id: column.text,
  device_id: column.text,
  is_active: column.integer, // boolean
  total_ms: column.integer,
  created_at: column.text,
  updated_at: column.text,
}, {
  indexes: {
    by_book: ['book_id'],
    by_active: ['is_active'],
  }
})

// ============ 笔记表 ============
const notes = new Table({
  user_id: column.text,
  book_id: column.text,
  device_id: column.text,
  content: column.text,
  page_number: column.integer,
  position_cfi: column.text,
  color: column.text,
  is_deleted: column.integer,
  deleted_at: column.text,
  created_at: column.text,
  updated_at: column.text,
}, {
  indexes: {
    by_book: ['book_id'],
    by_user_book: ['user_id', 'book_id'],
  }
})

// ============ 高亮表 ============
const highlights = new Table({
  user_id: column.text,
  book_id: column.text,
  device_id: column.text,
  text: column.text,
  page_number: column.integer,
  position_start_cfi: column.text,
  position_end_cfi: column.text,
  color: column.text,
  is_deleted: column.integer,
  deleted_at: column.text,
  created_at: column.text,
  updated_at: column.text,
}, {
  indexes: {
    by_book: ['book_id'],
    by_user_book: ['user_id', 'book_id'],
  }
})

// ============ 书签表 ============
const bookmarks = new Table({
  user_id: column.text,
  book_id: column.text,
  device_id: column.text,
  title: column.text,
  page_number: column.integer,
  position_cfi: column.text,
  is_deleted: column.integer,
  deleted_at: column.text,
  created_at: column.text,
  updated_at: column.text,
}, {
  indexes: {
    by_book: ['book_id'],
  }
})

// ============ 书架表 ============
const shelves = new Table({
  user_id: column.text,
  name: column.text,
  description: column.text,
  cover_url: column.text,
  sort_order: column.integer,
  is_deleted: column.integer,
  deleted_at: column.text,
  created_at: column.text,
  updated_at: column.text,
}, {
  indexes: {
    by_user: ['user_id'],
    by_sort: ['sort_order'],
  }
})

// ============ 书架书籍关联表 ============
const shelf_books = new Table({
  shelf_id: column.text,
  book_id: column.text,
  sort_order: column.integer,
  added_at: column.text,
}, {
  indexes: {
    by_shelf: ['shelf_id'],
    by_book: ['book_id'],
  }
})

// ============ 用户设置表 ============
const user_settings = new Table({
  user_id: column.text,
  device_id: column.text,
  settings_json: column.text, // JSON 字符串
  updated_at: column.text,
}, {
  indexes: {
    by_user: ['user_id'],
  }
})

// ============ 阅读统计表 (只读) ============
const reading_stats = new Table({
  user_id: column.text,
  date: column.text, // ISO date: YYYY-MM-DD
  total_seconds: column.integer,
  pages_read: column.integer,
  books_finished: column.integer,
  updated_at: column.text,
}, {
  indexes: {
    by_user: ['user_id'],
    by_date: ['date'],
  }
})

// ============ 本地专用表 (不同步到服务端) ============

// 书籍文件缓存元数据 (实际文件存储在 OPFS/Filesystem)
const local_book_files = new Table({
  book_id: column.text,
  format: column.text, // 'epub' | 'pdf'
  size: column.integer,
  downloaded_at: column.text,
  etag: column.text,
  file_path: column.text, // OPFS 或 Filesystem 路径
}, {
  indexes: {
    by_book: ['book_id'],
  },
  localOnly: true, // 不同步到服务端
})

// OCR 数据缓存
const local_ocr_data = new Table({
  book_id: column.text,
  is_image_based: column.integer,
  confidence: column.real,
  total_pages: column.integer,
  total_chars: column.integer,
  total_regions: column.integer,
  image_width: column.integer,
  image_height: column.integer,
  page_sizes_json: column.text, // JSON
  regions_json: column.text, // JSON (压缩后)
  downloaded_at: column.text,
}, {
  indexes: {
    by_book: ['book_id'],
  },
  localOnly: true,
})

// 封面缓存元数据
const local_cover_cache = new Table({
  book_id: column.text,
  mime_type: column.text,
  cached_at: column.text,
  original_url: column.text,
  file_path: column.text,
}, {
  indexes: {
    by_book: ['book_id'],
  },
  localOnly: true,
})

// ============ 导出 Schema ============

export const AppSchema = new Schema({
  // 同步表
  books,
  reading_progress,
  reading_sessions,
  notes,
  highlights,
  bookmarks,
  shelves,
  shelf_books,
  user_settings,
  reading_stats,
  
  // 本地表 (不同步)
  local_book_files,
  local_ocr_data,
  local_cover_cache,
})

// 导出表类型供其他模块使用
export type Database = (typeof AppSchema)['types']
export type BooksRecord = Database['books']
export type ReadingProgressRecord = Database['reading_progress']
export type NotesRecord = Database['notes']
export type HighlightsRecord = Database['highlights']
export type BookmarksRecord = Database['bookmarks']
export type ShelvesRecord = Database['shelves']
export type ShelfBooksRecord = Database['shelf_books']
export type UserSettingsRecord = Database['user_settings']
export type ReadingStatsRecord = Database['reading_stats']
export type LocalBookFilesRecord = Database['local_book_files']
export type LocalOcrDataRecord = Database['local_ocr_data']
export type LocalCoverCacheRecord = Database['local_cover_cache']
