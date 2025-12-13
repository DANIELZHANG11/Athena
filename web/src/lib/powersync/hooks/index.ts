/**
 * PowerSync Hooks 统一导出
 *
 * @see 09 - APP-FIRST架构改造计划.md Phase 2
 */

// Books
export {
  useBooks,
  useBook,
  useBookCount,
  useBookMutations,
  type Book,
  type UseBookOptions
} from './useBooks'

// Notes
export {
  useNotes,
  useNote,
  useNoteCount,
  useNoteMutations,
  type Note,
  type UseNotesOptions
} from './useNotes'

// Highlights
export {
  useHighlights,
  useHighlight,
  useHighlightCount,
  useHighlightMutations,
  type Highlight,
  type UseHighlightsOptions
} from './useHighlights'

// Reading Progress
export {
  useReadingProgress,
  useAllReadingProgress,
  useRecentlyReadBooks,
  useReadingProgressMutations,
  type ReadingProgress
} from './useReadingProgress'

// Shelves
export {
  useShelves,
  useShelvesWithBookCount,
  useShelf,
  useShelfBookIds,
  useBookShelves,
  useShelfMutations,
  type Shelf,
  type ShelfBook,
  type ShelfWithBooks
} from './useShelves'
