/**
 * useBookAnnotations - 书籍内标注管理 Hook
 * 
 * 用于 EpubReader 组件中管理笔记和高亮:
 * - 加载当前书籍的所有笔记和高亮
 * - 创建/更新/删除操作
 * - 高亮渲染样式生成
 * 
 * @see 02 - 功能规格 - 2.4 Notes & Highlights
 * @see 09 - APP-FIRST架构改造计划 - PowerSync CRUD
 */

import { useCallback } from 'react'
import { useNotesData, useHighlightsData, type NoteItem, type HighlightItem } from './useNotesData'
import { type HighlightColor, getHighlightColorConfig } from '@/lib/highlightColors'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

export interface TextSelection {
  text: string
  startCfi: string
  endCfi: string
  pageNumber?: number
}

export interface UseBookAnnotationsOptions {
  bookId: string
}

export interface UseBookAnnotationsReturn {
  // 数据
  notes: NoteItem[]
  highlights: HighlightItem[]
  isLoading: boolean
  
  // 高亮操作
  addHighlight: (selection: TextSelection, color: HighlightColor) => Promise<string>
  updateHighlightColor: (highlightId: string, color: HighlightColor) => Promise<void>
  deleteHighlight: (highlightId: string) => Promise<void>
  
  // 笔记操作
  addNote: (content: string, color: HighlightColor, selection?: TextSelection) => Promise<string>
  updateNote: (noteId: string, content: string, color?: HighlightColor) => Promise<void>
  deleteNote: (noteId: string) => Promise<void>
  
  // 辅助
  getHighlightCSS: () => string
  findHighlightAtCfi: (cfi: string) => HighlightItem | undefined
  findNoteAtCfi: (cfi: string) => NoteItem | undefined
}

/**
 * 书籍标注管理 Hook
 */
export function useBookAnnotations({ bookId }: UseBookAnnotationsOptions): UseBookAnnotationsReturn {
  const { t } = useTranslation('reader')
  
  // 获取数据
  const { 
    notes, 
    isLoading: notesLoading,
    addNote: _addNote,
    updateNote: _updateNote,
    deleteNote: _deleteNote,
  } = useNotesData({ bookId })
  
  const {
    highlights,
    isLoading: highlightsLoading,
    addHighlight: _addHighlight,
    updateHighlight: _updateHighlight,
    deleteHighlight: _deleteHighlight,
  } = useHighlightsData({ bookId })
  
  const isLoading = notesLoading || highlightsLoading
  
  // ============ 高亮操作 ============
  
  const addHighlight = useCallback(async (
    selection: TextSelection,
    color: HighlightColor
  ): Promise<string> => {
    try {
      const id = await _addHighlight({
        bookId,
        textContent: selection.text,
        cfiRange: selection.startCfi,
        cfiRangeEnd: selection.endCfi,
        pageNumber: selection.pageNumber,
        color,
      })
      return id
    } catch (error) {
      console.error('[useBookAnnotations] addHighlight failed:', error)
      toast.error(t('common.error', '操作失败'))
      throw error
    }
  }, [bookId, _addHighlight, t])
  
  const updateHighlightColor = useCallback(async (
    highlightId: string,
    color: HighlightColor
  ): Promise<void> => {
    try {
      await _updateHighlight(highlightId, { color })
    } catch (error) {
      console.error('[useBookAnnotations] updateHighlightColor failed:', error)
      toast.error(t('common.error', '操作失败'))
      throw error
    }
  }, [_updateHighlight, t])
  
  const deleteHighlight = useCallback(async (highlightId: string): Promise<void> => {
    try {
      await _deleteHighlight(highlightId)
      toast.success(t('common.deleted', '已删除'))
    } catch (error) {
      console.error('[useBookAnnotations] deleteHighlight failed:', error)
      toast.error(t('common.error', '操作失败'))
      throw error
    }
  }, [_deleteHighlight, t])
  
  // ============ 笔记操作 ============
  
  const addNote = useCallback(async (
    content: string,
    color: HighlightColor,
    selection?: TextSelection
  ): Promise<string> => {
    try {
      const id = await _addNote({
        bookId,
        content,
        color,
        cfiRange: selection?.startCfi,
        pageNumber: selection?.pageNumber,
      })
      toast.success(t('common.saved', '已保存'))
      return id
    } catch (error) {
      console.error('[useBookAnnotations] addNote failed:', error)
      toast.error(t('common.error', '操作失败'))
      throw error
    }
  }, [bookId, _addNote, t])
  
  const updateNote = useCallback(async (
    noteId: string,
    content: string,
    color?: HighlightColor
  ): Promise<void> => {
    try {
      await _updateNote(noteId, content, color)
      toast.success(t('common.saved', '已保存'))
    } catch (error) {
      console.error('[useBookAnnotations] updateNote failed:', error)
      toast.error(t('common.error', '操作失败'))
      throw error
    }
  }, [_updateNote, t])
  
  const deleteNote = useCallback(async (noteId: string): Promise<void> => {
    try {
      await _deleteNote(noteId)
      toast.success(t('common.deleted', '已删除'))
    } catch (error) {
      console.error('[useBookAnnotations] deleteNote failed:', error)
      toast.error(t('common.error', '操作失败'))
      throw error
    }
  }, [_deleteNote, t])
  
  // ============ 辅助方法 ============
  
  /**
   * 生成高亮 CSS (注入到 foliate-js 渲染器)
   * 每种颜色生成对应的样式类
   */
  const getHighlightCSS = useCallback((): string => {
    // 基础高亮样式
    let css = `
      /* 高亮基础样式 */
      .athena-highlight {
        background-color: var(--highlight-yellow-bg);
        border-radius: 2px;
        cursor: pointer;
        transition: background-color 0.15s ease;
      }
      .athena-highlight:hover {
        filter: brightness(0.95);
      }
    `
    
    // 为每种颜色生成样式
    const colors: HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'purple']
    colors.forEach(color => {
      const config = getHighlightColorConfig(color)
      css += `
      .athena-highlight--${color} {
        background-color: ${config.backgroundColor};
      }
      `
    })
    
    return css
  }, [])
  
  /**
   * 根据 CFI 查找高亮
   */
  const findHighlightAtCfi = useCallback((cfi: string): HighlightItem | undefined => {
    return highlights.find(h => 
      h.cfiRange === cfi || 
      (h.cfiRange <= cfi && h.cfiRangeEnd && h.cfiRangeEnd >= cfi)
    )
  }, [highlights])
  
  /**
   * 根据 CFI 查找笔记
   */
  const findNoteAtCfi = useCallback((cfi: string): NoteItem | undefined => {
    return notes.find(n => n.cfiRange === cfi)
  }, [notes])
  
  return {
    notes,
    highlights,
    isLoading,
    addHighlight,
    updateHighlightColor,
    deleteHighlight,
    addNote,
    updateNote,
    deleteNote,
    getHighlightCSS,
    findHighlightAtCfi,
    findNoteAtCfi,
  }
}

export default useBookAnnotations
