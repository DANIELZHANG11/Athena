/**
 * AnnotationList - 书籍注释列表组件
 * 
 * Apple Books 风格的注释列表:
 * - 显示某本书的所有笔记和高亮
 * - 按时间或章节排序
 * - 点击跳转到对应位置
 * - 支持编辑和删除
 * 
 * @see 06 - UIUX设计系统
 * @see 苹果风格的笔记高亮视图效果/
 */

import { useMemo, useState, useCallback } from 'react'
import { FileText, Highlighter, ChevronRight, Trash2, MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  getHighlightColorConfig,
  type HighlightColor
} from '@/lib/highlightColors'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
// Button removed - using ActionButton instead
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

// ============================================================================
// 类型定义
// ============================================================================

export interface AnnotationNote {
  id: string
  type: 'note'
  bookId: string
  content: string
  color: HighlightColor
  highlightedText?: string
  pageNumber?: number
  positionCfi?: string
  createdAt: string
  updatedAt: string
}

export interface AnnotationHighlight {
  id: string
  type: 'highlight'
  bookId: string
  text: string
  color: HighlightColor
  note?: string
  pageNumber?: number
  positionStartCfi?: string
  positionEndCfi?: string
  createdAt: string
  updatedAt: string
}

export type Annotation = AnnotationNote | AnnotationHighlight

export interface AnnotationListProps {
  /** 是否显示列表 */
  open: boolean
  /** 关闭列表 */
  onClose: () => void
  /** 书籍标题 */
  bookTitle: string
  /** 笔记列表 */
  notes: AnnotationNote[]
  /** 高亮列表 */
  highlights: AnnotationHighlight[]
  /** 跳转到位置 */
  onNavigate: (cfi: string) => void
  /** 编辑笔记 */
  onEditNote: (note: AnnotationNote) => void
  /** 删除笔记 */
  onDeleteNote: (noteId: string) => Promise<void>
  /** 编辑高亮 */
  onEditHighlight: (highlight: AnnotationHighlight) => void
  /** 删除高亮 */
  onDeleteHighlight: (highlightId: string) => Promise<void>
  /** 是否正在加载 */
  isLoading?: boolean
}

// ============================================================================
// 辅助组件
// ============================================================================

/**
 * 颜色条 - 左侧彩色边框
 */
function ColorBar({ color }: { color: HighlightColor }) {
  const config = getHighlightColorConfig(color)
  return (
    <div
      className="w-1 rounded-full shrink-0"
      style={{ backgroundColor: config.color }}
    />
  )
}

/**
 * 时间格式化
 */
function formatTime(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } else if (diffDays === 1) {
    return '昨天'
  } else if (diffDays < 7) {
    return `${diffDays} 天前`
  } else {
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }
}

/**
 * 笔记卡片
 */
function NoteCard({
  note,
  onNavigate,
  onEdit,
  onDelete,
}: {
  note: AnnotationNote
  onNavigate: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const colorConfig = getHighlightColorConfig(note.color)

  return (
    <div
      className={cn(
        'flex gap-3 p-3 rounded-xl',
        'bg-secondary-background',
        'hover:bg-tertiary-background transition-colors duration-fast',
        'cursor-pointer group'
      )}
      onClick={onNavigate}
    >
      <ColorBar color={note.color} />

      <div className="flex-1 min-w-0">
        {/* 高亮原文 (如果有) */}
        {note.highlightedText && (
          <div
            className="mb-2 p-2 rounded-lg text-sm italic"
            style={{ backgroundColor: colorConfig.backgroundColor }}
          >
            <p className="text-label/80 line-clamp-2">"{note.highlightedText}"</p>
          </div>
        )}

        {/* 笔记内容 */}
        <p className="text-sm text-label line-clamp-3 mb-2">
          {note.content}
        </p>

        {/* 元信息 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-secondary-label">
            <FileText size={12} />
            <span>{formatTime(note.updatedAt)}</span>
            {note.pageNumber && <span>· 第 {note.pageNumber} 页</span>}
          </div>

          <ChevronRight
            size={16}
            className="text-secondary-label opacity-0 group-hover:opacity-100 transition-opacity"
          />
        </div>
      </div>

      {/* 更多操作 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
          <button className="p-1.5 rounded-lg hover:bg-hover-background opacity-0 group-hover:opacity-100 transition-opacity" aria-label="更多操作">
            <MoreHorizontal size={16} className="text-secondary-label" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit() }}>
            <FileText size={14} className="mr-2" />
            编辑笔记
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="text-system-red focus:text-system-red"
          >
            <Trash2 size={14} className="mr-2" />
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * 高亮卡片
 */
function HighlightCard({
  highlight,
  onNavigate,
  onEdit,
  onDelete,
}: {
  highlight: AnnotationHighlight
  onNavigate: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const colorConfig = getHighlightColorConfig(highlight.color)

  return (
    <div
      className={cn(
        'flex gap-3 p-3 rounded-xl',
        'bg-secondary-background',
        'hover:bg-tertiary-background transition-colors duration-fast',
        'cursor-pointer group'
      )}
      onClick={onNavigate}
    >
      <ColorBar color={highlight.color} />

      <div className="flex-1 min-w-0">
        {/* 高亮文本 */}
        <div
          className="p-2 rounded-lg mb-2"
          style={{ backgroundColor: colorConfig.backgroundColor }}
        >
          <p className="text-sm text-label line-clamp-3">
            "{highlight.text}"
          </p>
        </div>

        {/* 附加笔记 (如果有) */}
        {highlight.note && (
          <p className="text-sm text-secondary-label line-clamp-2 mb-2">
            💭 {highlight.note}
          </p>
        )}

        {/* 元信息 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-secondary-label">
            <Highlighter size={12} />
            <span>{formatTime(highlight.updatedAt)}</span>
            {highlight.pageNumber && <span>· 第 {highlight.pageNumber} 页</span>}
          </div>

          <ChevronRight
            size={16}
            className="text-secondary-label opacity-0 group-hover:opacity-100 transition-opacity"
          />
        </div>
      </div>

      {/* 更多操作 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
          <button className="p-1.5 rounded-lg hover:bg-hover-background opacity-0 group-hover:opacity-100 transition-opacity">
            <MoreHorizontal size={16} className="text-secondary-label" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit() }}>
            <FileText size={14} className="mr-2" />
            添加笔记
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="text-system-red focus:text-system-red"
          >
            <Trash2 size={14} className="mr-2" />
            删除高亮
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * 空状态
 */
function EmptyState({ type }: { type: 'notes' | 'highlights' | 'all' }) {
  const { t } = useTranslation('reader')

  const messages = {
    notes: {
      title: t('notes.empty.title', '暂无笔记'),
      description: t('notes.empty.description', '选中文字后可以添加笔记'),
    },
    highlights: {
      title: t('highlights.empty.title', '暂无高亮'),
      description: t('highlights.empty.description', '选中文字后可以添加高亮'),
    },
    all: {
      title: t('annotations.empty.title', '暂无标注'),
      description: t('annotations.empty.description', '阅读时选中文字可以添加高亮和笔记'),
    },
  }

  const { title, description } = messages[type]

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-full bg-secondary-background flex items-center justify-center mb-4">
        {type === 'notes' ? (
          <FileText size={24} className="text-secondary-label" />
        ) : (
          <Highlighter size={24} className="text-secondary-label" />
        )}
      </div>
      <h3 className="text-base font-medium text-label mb-1">{title}</h3>
      <p className="text-sm text-secondary-label">{description}</p>
    </div>
  )
}

// ============================================================================
// 主组件
// ============================================================================

export function AnnotationList({
  open,
  onClose,
  bookTitle,
  notes,
  highlights,
  onNavigate,
  onEditNote,
  onDeleteNote,
  onEditHighlight,
  onDeleteHighlight,
  isLoading = false,
}: AnnotationListProps) {
  const { t } = useTranslation('reader')
  const [activeTab, setActiveTab] = useState<'all' | 'notes' | 'highlights'>('all')
  const [_deletingId, setDeletingId] = useState<string | null>(null)

  // 合并并按时间排序
  const allAnnotations = useMemo(() => {
    const items: Annotation[] = [
      ...notes.map(n => ({ ...n, type: 'note' as const })),
      ...highlights.map(h => ({ ...h, type: 'highlight' as const })),
    ]
    return items.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  }, [notes, highlights])

  const handleDeleteNote = useCallback(async (noteId: string) => {
    setDeletingId(noteId)
    try {
      await onDeleteNote(noteId)
    } finally {
      setDeletingId(null)
    }
  }, [onDeleteNote])

  const handleDeleteHighlight = useCallback(async (highlightId: string) => {
    setDeletingId(highlightId)
    try {
      await onDeleteHighlight(highlightId)
    } finally {
      setDeletingId(null)
    }
  }, [onDeleteHighlight])

  const handleNavigate = useCallback((cfi?: string) => {
    if (cfi) {
      onNavigate(cfi)
      onClose()
    }
  }, [onNavigate, onClose])

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent
        side="right"
        className={cn(
          'w-full sm:w-[400px] sm:max-w-[400px]',
          'p-0',
          // 完全不透明的背景 - 根据 06 号文档设计规范
          // 不使用透明或半透明，确保内容清晰可读
        )}
        style={{ backgroundColor: 'var(--system-background)', opacity: 1 }}
        aria-describedby="annotation-list-description"
      >
        <SheetHeader className="px-4 py-3 border-b border-separator">
          <SheetTitle className="text-base font-semibold text-label text-left">
            {bookTitle}
          </SheetTitle>
          <SheetDescription id="annotation-list-description" className="text-sm text-secondary-label text-left">
            {notes.length} {t('notes.count', '条笔记')} · {highlights.length} {t('highlights.count', '处高亮')}
          </SheetDescription>
        </SheetHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as 'all' | 'notes' | 'highlights')}
          className="flex-1"
        >
          <TabsList className="w-full justify-start px-4 py-2 bg-transparent border-b border-separator">
            <TabsTrigger
              value="all"
              className="text-sm data-[state=active]:text-system-blue data-[state=active]:border-b-2 data-[state=active]:border-system-blue rounded-none"
            >
              {t('annotations.all', '全部')} ({allAnnotations.length})
            </TabsTrigger>
            <TabsTrigger
              value="notes"
              className="text-sm data-[state=active]:text-system-blue data-[state=active]:border-b-2 data-[state=active]:border-system-blue rounded-none"
            >
              {t('annotations.notes', '笔记')} ({notes.length})
            </TabsTrigger>
            <TabsTrigger
              value="highlights"
              className="text-sm data-[state=active]:text-system-blue data-[state=active]:border-b-2 data-[state=active]:border-system-blue rounded-none"
            >
              {t('annotations.highlights', '高亮')} ({highlights.length})
            </TabsTrigger>
          </TabsList>

          <div className="overflow-y-auto h-[calc(100vh-180px)] px-4 py-3">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 border-2 border-system-blue border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                <TabsContent value="all" className="mt-0 space-y-3">
                  {allAnnotations.length === 0 ? (
                    <EmptyState type="all" />
                  ) : (
                    allAnnotations.map((item) =>
                      item.type === 'note' ? (
                        <NoteCard
                          key={item.id}
                          note={item as AnnotationNote}
                          onNavigate={() => handleNavigate((item as AnnotationNote).positionCfi)}
                          onEdit={() => onEditNote(item as AnnotationNote)}
                          onDelete={() => handleDeleteNote(item.id)}
                        />
                      ) : (
                        <HighlightCard
                          key={item.id}
                          highlight={item as AnnotationHighlight}
                          onNavigate={() => handleNavigate((item as AnnotationHighlight).positionStartCfi)}
                          onEdit={() => onEditHighlight(item as AnnotationHighlight)}
                          onDelete={() => handleDeleteHighlight(item.id)}
                        />
                      )
                    )
                  )}
                </TabsContent>

                <TabsContent value="notes" className="mt-0 space-y-3">
                  {notes.length === 0 ? (
                    <EmptyState type="notes" />
                  ) : (
                    notes.map((note) => (
                      <NoteCard
                        key={note.id}
                        note={note}
                        onNavigate={() => handleNavigate(note.positionCfi)}
                        onEdit={() => onEditNote(note)}
                        onDelete={() => handleDeleteNote(note.id)}
                      />
                    ))
                  )}
                </TabsContent>

                <TabsContent value="highlights" className="mt-0 space-y-3">
                  {highlights.length === 0 ? (
                    <EmptyState type="highlights" />
                  ) : (
                    highlights.map((highlight) => (
                      <HighlightCard
                        key={highlight.id}
                        highlight={highlight}
                        onNavigate={() => handleNavigate(highlight.positionStartCfi)}
                        onEdit={() => onEditHighlight(highlight)}
                        onDelete={() => handleDeleteHighlight(highlight.id)}
                      />
                    ))
                  )}
                </TabsContent>
              </>
            )}
          </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}

export default AnnotationList
