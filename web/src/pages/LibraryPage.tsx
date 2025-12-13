/**
 * 书库页面 (App-First 版)
 *
 * 说明：
 * - 使用 PowerSync (useBooksData) 作为唯一数据源
 * - 使用 IndexedDB (useLocalBookCache) 管理文件缓存
 * - 移除所有旧 API 调用和 Dexie 依赖
 * - 纯响应式设计
 */
import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import BookCard from '../components/BookCard'
import ShelfView from '../components/ShelfView'
import UploadManager from '../components/upload/UploadManager'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth'
import { useBooksData, type BookItem } from '@/hooks/useBooksData'
import { useBookFileCache } from '@/hooks/useBookFileCache'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { toast } from '@/components/ui/sonner'
import { MoreVertical, Grid3X3, List, Clock, BookOpen, User, Upload, Check, Library, WifiOff, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"

type ViewMode = 'grid' | 'list' | 'shelf'
type SortBy = 'recent' | 'title' | 'author' | 'upload'

// localStorage key 用于持久化视图模式
const VIEW_MODE_STORAGE_KEY = 'athena_library_view_mode'

export default function LibraryPage() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const isOnline = useOnlineStatus()
  const accessToken = useAuthStore((s) => s.accessToken)
  
  // 视图状态
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    return (saved === 'grid' || saved === 'list' || saved === 'shelf') ? saved : 'grid'
  })
  const [sortBy, setSortBy] = useState<SortBy>('recent')
  const [searchQuery, setSearchQuery] = useState('')

  // 数据源 (PowerSync)
  const { 
    items, 
    isLoading, 
    stats, 
    hasProcessing, 
    refresh,
    isReady 
  } = useBooksData({
    sortBy,
    search: searchQuery
  })

  // 本地文件缓存状态
  const bookIds = useMemo(() => items.map(item => item.id), [items])
  const { getBookCacheStatus, markDownloading, markDownloaded } = useBookFileCache(bookIds)

  // 持久化视图模式
  useEffect(() => {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode)
  }, [viewMode])

  // 后台下载书籍（缓存文件到 IndexedDB）
  const handleSyncBook = useCallback(async (bookId: string) => {
    if (!isOnline) {
      toast.error(t('offline.sync_unavailable', '离线状态无法下载书籍'))
      return
    }
    
    const token = accessToken || localStorage.getItem('access_token') || ''
    if (!token) return
    
    markDownloading(bookId)
    
    try {
      const contentUrl = `/api/v1/books/${bookId}/content?token=${encodeURIComponent(token)}`
      const response = await fetch(contentUrl)
      
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`)
      }
      
      const blob = await response.blob()
      const contentType = response.headers.get('Content-Type') || ''
      const format = contentType.includes('pdf') ? 'pdf' : 'epub'
      const etag = response.headers.get('ETag') || undefined
      
      // 动态导入以避免循环依赖
      const { saveBookFile } = await import('@/lib/bookStorage')
      await saveBookFile(bookId, blob, format as 'epub' | 'pdf', etag)
      
      markDownloaded(bookId)
      toast.success(t('library.download_success', '书籍已下载到本地'))
    } catch (error) {
      console.error(`[LibraryPage] Failed to sync book ${bookId}:`, error)
      markDownloaded(bookId) // 移除下载状态
      toast.error(t('library.download_failed', '下载失败'))
    }
  }, [isOnline, t, accessToken, markDownloading, markDownloaded])

  // 处理书籍点击
  const handleBookClick = useCallback((bookId: string) => {
    const cacheStatus = getBookCacheStatus(bookId)
    
    if (cacheStatus === 'downloading') {
      toast.info(t('offline.book_downloading', '书籍正在下载中...'))
      return
    }
    
    // 如果离线且未缓存，无法阅读
    if (!isOnline && cacheStatus !== 'ready') {
      toast.error(t('offline.book_not_cached', '未缓存书籍无法离线阅读'))
      return
    }
    
    navigate(`/app/read/${bookId}`)
  }, [isOnline, getBookCacheStatus, navigate, t])

  // 渲染内容
  const renderContent = () => {
    if (isLoading && items.length === 0) {
      return (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      )
    }

    if (items.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
          <BookOpen className="h-12 w-12 mb-4 opacity-20" />
          <p>{searchQuery ? t('library.no_search_results', '未找到相关书籍') : t('library.empty', '书库为空')}</p>
          {!searchQuery && (
            <p className="text-sm mt-2">{t('library.upload_hint', '点击右上角上传书籍')}</p>
          )}
        </div>
      )
    }

    if (viewMode === 'shelf') {
      return (
        <ShelfView 
          books={items} 
          onBookClick={handleBookClick}
          getBookCacheStatus={getBookCacheStatus}
        />
      )
    }

    return (
      <div className={viewMode === 'grid' 
        ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6"
        : "flex flex-col space-y-2"
      }>
        {items.map((book) => (
          <BookCard
            key={book.id}
            book={book}
            viewMode={viewMode === 'list' ? 'list' : 'grid'}
            onClick={() => handleBookClick(book.id)}
            onDownload={() => handleSyncBook(book.id)}
            cacheStatus={getBookCacheStatus(book.id)}
            isOnline={isOnline}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-6 pb-24 md:pb-6 max-w-7xl">
      {/* 顶部栏 */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Library className="h-6 w-6" />
            {t('nav.library', '我的书库')}
            {!isOnline && <WifiOff className="h-4 w-4 text-muted-foreground" />}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {stats.total} {t('common.books', '本书籍')} 
            {stats.inProgress > 0 && ` · ${stats.inProgress} ${t('library.reading', '正在阅读')}`}
          </p>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Input
              placeholder={t('common.search', '搜索书籍...')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full"
            />
          </div>

          <UploadManager />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t('library.view_mode', '视图模式')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
                <DropdownMenuRadioItem value="grid">
                  <Grid3X3 className="mr-2 h-4 w-4" /> {t('library.view_grid', '网格')}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="list">
                  <List className="mr-2 h-4 w-4" /> {t('library.view_list', '列表')}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="shelf">
                  <Library className="mr-2 h-4 w-4" /> {t('library.view_shelf', '书架')}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              
              <DropdownMenuSeparator />
              
              <DropdownMenuLabel>{t('library.sort_by', '排序方式')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
                <DropdownMenuRadioItem value="recent">
                  <Clock className="mr-2 h-4 w-4" /> {t('library.sort_recent', '最近阅读')}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="upload">
                  <Upload className="mr-2 h-4 w-4" /> {t('library.sort_upload', '最近上传')}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="title">
                  <BookOpen className="mr-2 h-4 w-4" /> {t('library.sort_title', '标题')}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="author">
                  <User className="mr-2 h-4 w-4" /> {t('library.sort_author', '作者')}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>

              <DropdownMenuSeparator />
              
              <DropdownMenuItem onClick={() => refresh()}>
                <RefreshCw className="mr-2 h-4 w-4" /> {t('common.refresh', '刷新')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* 处理中提示 */}
      {hasProcessing && (
        <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 px-4 py-2 rounded-md mb-4 text-sm flex items-center animate-pulse">
          <RefreshCw className="h-3 w-3 mr-2 animate-spin" />
          {t('library.processing_books', '正在处理上传的书籍...')}
        </div>
      )}

      {/* 书籍列表 */}
      {renderContent()}
    </div>
  )
}
