/**
 * 搜索页面
 * 
 * 功能:
 * - 全局搜索书籍、笔记、高亮
 * - 离线支持：搜索本地缓存的书籍列表和笔记
 * - 在线时调用服务器搜索 API
 * 
 * 注意：全文搜索（FlexSearch）为 P2 功能，待后续实现
 * 
 * @see App-First改造计划.md
 */
import { useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Search, BookOpen, FileText, Highlighter, X, Loader2 } from 'lucide-react'
import { useBooksData } from '@/hooks/useBooksData'
import { useNotesData, useHighlightsData } from '@/hooks/useNotesData'

type SearchCategory = 'all' | 'books' | 'notes' | 'highlights'

interface SearchResult {
  type: 'book' | 'note' | 'highlight'
  id: string
  title: string
  subtitle?: string
  bookId?: string
}

export default function SearchPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [category, setCategory] = useState<SearchCategory>('all')
  const [searched, setSearched] = useState(false)

  // 使用防抖更新查询词
  // 简单起见，这里直接使用 useEffect 做防抖，或者直接响应 query
  // 为了更好的体验，我们假设 query 是即时更新的， PowerSync 本地查询很快

  // 查询书籍
  const { items: books, isLoading: booksLoading } = useBooksData({
    search: query,
    // 如果 query 为空，我们不希望列出所有书籍，除非用户确实想看
    // 但 current behavior logic needed: search page usually starts empty
  })

  // 查询笔记
  const { notes, isLoading: notesLoading } = useNotesData({
    search: query
  })

  // 查询高亮
  const { highlights, isLoading: highlightsLoading } = useHighlightsData({
    search: query
  })

  const loading = booksLoading || notesLoading || highlightsLoading

  // 聚合结果
  const results: SearchResult[] = useMemo(() => {
    if (!query.trim()) return []

    const list: SearchResult[] = []

    // 书籍结果
    if (category === 'all' || category === 'books') {
      books.forEach(book => {
        list.push({
          type: 'book',
          id: book.id,
          title: book.title,
          subtitle: book.author,
        })
      })
    }

    // 笔记结果
    if (category === 'all' || category === 'notes') {
      notes.forEach(note => {
        list.push({
          type: 'note',
          id: note.id,
          title: note.content.slice(0, 100) + (note.content.length > 100 ? '...' : ''),
          subtitle: note.bookTitle,
          bookId: note.bookId,
        })
      })
    }

    // 高亮结果
    if (category === 'all' || category === 'highlights') {
      highlights.forEach(hl => {
        list.push({
          type: 'highlight',
          id: hl.id,
          title: hl.textContent.slice(0, 100) + (hl.textContent.length > 100 ? '...' : ''),
          subtitle: hl.bookTitle,
          bookId: hl.bookId,
        })
      })
    }

    return list
  }, [query, category, books, notes, highlights])

  const handleSearch = () => {
    if (query.trim()) {
      setSearched(true)
    }
  }

  // 结果点击处理
  const handleResultClick = (result: SearchResult) => {
    if (result.type === 'book') {
      navigate(`/app/read/${result.id}`)
    } else if (result.bookId) {
      navigate(`/app/read/${result.bookId}`)
    }
  }

  // 分类标签
  const categories = useMemo(() => [
    { key: 'all', label: t('search.all', '全部') },
    { key: 'books', label: t('search.books', '书籍'), icon: BookOpen },
    { key: 'notes', label: t('search.notes', '笔记'), icon: FileText },
    { key: 'highlights', label: t('search.highlights', '高亮'), icon: Highlighter },
  ], [t])

  // 结果图标
  const getResultIcon = (type: string) => {
    switch (type) {
      case 'book': return <BookOpen className="h-5 w-5 text-system-blue" />
      case 'note': return <FileText className="h-5 w-5 text-system-green" />
      case 'highlight': return <Highlighter className="h-5 w-5 text-system-yellow" />
      default: return <Search className="h-5 w-5 text-secondary-label" />
    }
  }

  return (
    <div className="min-h-screen bg-system-background">
      {/* 搜索头部 */}
      <div className="sticky top-0 z-10 bg-system-background border-b border-separator p-4">
        {/* 搜索框 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-secondary-label" />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              if (!e.target.value) setSearched(false)
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder={t('search.placeholder', '搜索书籍、笔记、高亮...')}
            className="w-full pl-10 pr-10 py-3 rounded-xl bg-secondary-background text-label placeholder-tertiary-label focus:outline-none focus:ring-2 focus:ring-system-blue"
            autoFocus
          />
          {query && (
            <button
              onClick={() => {
                setQuery('')
                setSearched(false)
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-tertiary-background"
            >
              <X className="h-4 w-4 text-secondary-label" />
            </button>
          )}
        </div>

        {/* 分类标签 */}
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
          {categories.map(cat => (
            <button
              key={cat.key}
              onClick={() => setCategory(cat.key as SearchCategory)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors ${category === cat.key
                ? 'bg-system-blue text-white'
                : 'bg-secondary-background text-secondary-label hover:bg-tertiary-background'
                }`}
            >
              {cat.icon && <cat.icon className="h-4 w-4" />}
              <span>{cat.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 搜索结果 */}
      <div className="p-4">
        {loading && searched ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-system-blue" />
            <p className="mt-2 text-secondary-label">{t('search.searching', '搜索中...')}</p>
          </div>
        ) : !searched && !query ? (
          <div className="flex flex-col items-center justify-center py-16 text-secondary-label">
            <Search className="h-16 w-16 opacity-30" />
            <p className="mt-4">{t('search.hint', '输入关键词开始搜索')}</p>
          </div>
        ) : results.length === 0 && (searched || query) ? (
          <div className="flex flex-col items-center justify-center py-16 text-secondary-label">
            <Search className="h-16 w-16 opacity-30" />
            <p className="mt-4">{t('search.no_results', '未找到相关结果')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-secondary-label mb-4">
              {t('search.results_count', '找到 {{count}} 个结果', { count: results.length })}
            </p>
            {results.map((result) => (
              <button
                key={`${result.type}-${result.id}`}
                onClick={() => handleResultClick(result)}
                className="w-full flex items-start gap-3 p-3 rounded-xl bg-secondary-background hover:bg-tertiary-background transition-colors text-left"
              >
                <div className="shrink-0 mt-0.5">
                  {getResultIcon(result.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-label line-clamp-2">{result.title}</p>
                  {result.subtitle && (
                    <p className="text-sm text-secondary-label mt-1 truncate">{result.subtitle}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
