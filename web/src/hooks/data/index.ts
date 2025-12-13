/**
 * PowerSync 数据 Hooks 统一导出
 *
 * App-First 架构的数据访问入口
 * 所有数据操作都通过这些 Hooks 进行
 *
 * @see 09 - APP-FIRST架构改造计划.md Phase 3
 */

// 书籍数据
export {
  useBooksData,
  useBookData,
  type BookItem,
} from './useBooksData'

// 笔记和高亮数据
export {
  useNotesData,
  useHighlightsData,
  useBookAnnotations,
  type NoteItem,
  type HighlightItem,
} from './useNotesData'

// 阅读进度数据
export {
  useProgressData,
  useAllProgressData,
  useReadingSession,
  type ReadingProgressData,
} from './useProgressData'

// 书架数据
export {
  useShelvesData,
  useShelfData,
  useBookShelvesData,
  type ShelfData,
  type ShelfBookData,
} from './useShelvesData'
