/**
 * NotesPage - 笔记与高亮管理页面 (App-First 版)
 *
 * 架构:
 * - 数据源: PowerSync (useNotesData, useHighlightsData, useBooksData)
 * - 纯响应式，无 API 调用
 */

import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNotesData, useHighlightsData, type NoteItem, type HighlightItem } from '@/hooks/useNotesData'
import { useBooksData } from '@/hooks/useBooksData'
import { Search, BookOpen, Highlighter, StickyNote, Trash2, Edit2, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'

export default function NotesPage() {
  const { t } = useTranslation()
  const { toast } = useToast()

  // 1. 获取所有笔记和高亮
  const { notes, isLoading: notesLoading, updateNote, deleteNote } = useNotesData({})
  const { highlights, isLoading: highlightsLoading, updateHighlight, deleteHighlight } = useHighlightsData({})
  
  // 2. 获取书籍列表 (用于筛选)
  const { items: books } = useBooksData({ sortBy: 'title' })

  // 本地状态
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedBookId, setSelectedBookId] = useState<string>('all')
  const [activeTab, setActiveTab] = useState('all')

  // 编辑相关状态
  const [editingNote, setEditingNote] = useState<NoteItem | null>(null)
  const [editContent, setEditContent] = useState('')

  // 统一数据结构用于渲染
  type DisplayItem = {
    id: string
    type: 'note' | 'highlight'
    content: string
    color?: string
    bookId: string
    bookTitle?: string
    createdAt: string
    original: NoteItem | HighlightItem
  }

  const allItems: DisplayItem[] = useMemo(() => {
    const noteItems: DisplayItem[] = notes.map(n => ({
      id: n.id,
      type: 'note',
      content: n.content,
      bookId: n.bookId,
      bookTitle: n.bookTitle,
      createdAt: n.createdAt,
      original: n
    }))

    const highlightItems: DisplayItem[] = highlights.map(h => ({
      id: h.id,
      type: 'highlight',
      content: h.textContent, // 高亮文本作为内容展示
      color: h.color,
      bookId: h.bookId,
      bookTitle: h.bookTitle,
      createdAt: h.createdAt,
      original: h
    }))

    return [...noteItems, ...highlightItems].sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  }, [notes, highlights])

  // 过滤逻辑
  const filteredItems = useMemo(() => {
    return allItems.filter(item => {
      // 标签页过滤
      if (activeTab === 'notes' && item.type !== 'note') return false
      if (activeTab === 'highlights' && item.type !== 'highlight') return false

      // 书籍过滤
      if (selectedBookId !== 'all' && item.bookId !== selectedBookId) return false

      // 搜索过滤
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        return (
          item.content.toLowerCase().includes(q) ||
          (item.bookTitle || '').toLowerCase().includes(q)
        )
      }

      return true
    })
  }, [allItems, activeTab, selectedBookId, searchQuery])

  // 处理删除
  const handleDelete = async (item: DisplayItem) => {
    if (!confirm(t('common.confirm_delete', '确定要删除吗？'))) return

    try {
      if (item.type === 'note') {
        await deleteNote(item.id)
      } else {
        await deleteHighlight(item.id)
      }
      toast({ title: t('common.deleted', '已删除') })
    } catch (error) {
      toast({ 
        title: t('common.error', '操作失败'), 
        variant: 'destructive' 
      })
    }
  }

  // 处理编辑
  const handleEdit = (item: DisplayItem) => {
    if (item.type === 'note') {
      setEditingNote(item.original as NoteItem)
      setEditContent(item.content)
    } else {
      // 高亮目前只支持编辑备注，这里简化处理，暂不支持直接编辑高亮文本
      toast({ title: t('notes.highlight_edit_hint', '高亮文本无法直接编辑') })
    }
  }

  const saveEdit = async () => {
    if (!editingNote) return

    try {
      await updateNote(editingNote.id, editContent)
      setEditingNote(null)
      toast({ title: t('common.saved', '已保存') })
    } catch (error) {
      toast({ 
        title: t('common.error', '保存失败'), 
        variant: 'destructive' 
      })
    }
  }

  const isLoading = notesLoading || highlightsLoading

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <StickyNote className="h-6 w-6" />
            {t('nav.notes', '笔记与高亮')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {notes.length} {t('notes.notes_count', '条笔记')} · {highlights.length} {t('notes.highlights_count', '条高亮')}
          </p>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t('common.search', '搜索内容...')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          
          <Select value={selectedBookId} onValueChange={setSelectedBookId}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t("notes.filter_book", "所有书籍")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('notes.all_books', '所有书籍')}</SelectItem>
              {books.map(book => (
                <SelectItem key={book.id} value={book.id}>
                  {book.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="all">{t('common.all', '全部')}</TabsTrigger>
          <TabsTrigger value="notes">{t('notes.only_notes', '仅笔记')}</TabsTrigger>
          <TabsTrigger value="highlights">{t('notes.only_highlights', '仅高亮')}</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-0">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p>{t('common.empty', '暂无内容')}</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {filteredItems.map(item => (
                <Card key={item.id} className="overflow-hidden">
                  <CardHeader className="pb-2 flex flex-row items-start justify-between space-y-0">
                    <div className="flex items-center gap-2">
                      <Badge variant={item.type === 'note' ? 'default' : 'secondary'}>
                        {item.type === 'note' ? <StickyNote className="h-3 w-3 mr-1" /> : <Highlighter className="h-3 w-3 mr-1" />}
                        {item.type === 'note' ? t('notes.note', '笔记') : t('notes.highlight', '高亮')}
                      </Badge>
                      <span className="text-sm text-muted-foreground flex items-center gap-1">
                        <BookOpen className="h-3 w-3" />
                        {item.bookTitle || t('common.unknown_book', '未知书籍')}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: zhCN })}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      {item.type === 'note' && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(item)}>
                          <Edit2 className="h-4 w-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(item)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className={`text-sm leading-relaxed ${item.type === 'highlight' ? 'border-l-4 pl-3 py-1' : ''}`}
                      style={item.type === 'highlight' && item.color ? { borderLeftColor: item.color } : undefined}
                    >
                      {item.content}
                    </div>
                    {item.type === 'highlight' && (item.original as HighlightItem).note && (
                      <div className="mt-2 text-sm text-muted-foreground bg-muted p-2 rounded">
                        <span className="font-semibold mr-1">{t('notes.note', '笔记')}:</span>
                        {(item.original as HighlightItem).note}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* 编辑对话框 */}
      <Dialog open={!!editingNote} onOpenChange={(open) => !open && setEditingNote(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('notes.edit_note', '编辑笔记')}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="min-h-[150px]"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingNote(null)}>
              {t('common.cancel', '取消')}
            </Button>
            <Button onClick={saveEdit}>
              {t('common.save', '保存')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
