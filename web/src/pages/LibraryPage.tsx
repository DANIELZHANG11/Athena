/**
 * 书库页面
 *
 * 说明：
 * - 列出用户书籍，支持网格/列表视图与排序
 * - 监听上传成功、封面就绪、数据更新等事件以刷新
 * - 检测 OCR 处理状态并轮询，确保 UI 实时反馈
 */
import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import BookCard from '../components/BookCard'
import UploadManager from '../components/upload/UploadManager'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth'
import api from '@/lib/api'
import { useLocalBookCache } from '@/hooks/useLocalBookCache'
import { MoreVertical, Grid3X3, List, Clock, BookOpen, User, Upload, Check } from 'lucide-react'

interface BookItem {
  id: string
  title: string
  author?: string
  coverUrl?: string
  progress?: number
  isFinished?: boolean
  downloadUrl?: string
  updatedAt?: string
  createdAt?: string
  ocrStatus?: string | null  // 'pending' | 'processing' | 'completed' | 'failed' | null
  isImageBased?: boolean     // 是否为图片型 PDF
}

type ViewMode = 'grid' | 'list'
type SortBy = 'recent' | 'title' | 'author' | 'upload'

export default function LibraryPage() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const [items, setItems] = useState<BookItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [sortBy, setSortBy] = useState<SortBy>('recent')
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const accessToken = useAuthStore((s) => s.accessToken)

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showMenu])

  // 排序函数
  const sortBooks = (books: BookItem[]): BookItem[] => {
    const sorted = [...books]
    switch (sortBy) {
      case 'recent':
        return sorted.sort((a, b) => {
          const dateA = new Date(a.updatedAt || a.createdAt || 0).getTime()
          const dateB = new Date(b.updatedAt || b.createdAt || 0).getTime()
          return dateB - dateA
        })
      case 'title':
        return sorted.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
      case 'author':
        return sorted.sort((a, b) => (a.author || '').localeCompare(b.author || '', 'zh-CN'))
      case 'upload':
        return sorted.sort((a, b) => {
          const dateA = new Date(a.createdAt || 0).getTime()
          const dateB = new Date(b.createdAt || 0).getTime()
          return dateB - dateA
        })
      default:
        return sorted
    }
  }

  const sortedItems = sortBooks(items)
  
  // 获取所有书籍 ID 并检查本地缓存状态
  const bookIds = useMemo(() => items.map(item => item.id), [items])
  const { getBookCacheStatus } = useLocalBookCache(bookIds)

  // 检查是否有书籍正在 OCR 处理中
  const hasOcrProcessing = useMemo(() => 
    items.some(item => item.ocrStatus === 'pending' || item.ocrStatus === 'processing'),
    [items]
  )

  // fetchList 函数提取出来以便复用
  const fetchList = useCallback(async () => {
    try {
      console.log('[LibraryPage] Fetching books list...')
      const response = await api.get('/books')
      console.log('[LibraryPage] Books response:', response.data)
      const token = accessToken || localStorage.getItem('access_token') || ''
      const list = (response.data?.data?.items || []).map((x: any) => ({
        id: x.id,
        title: x.title || t('common.untitled'),
        author: x.author || undefined,
        // 使用 API 代理封面 URL，兼容移动端，通过 token 参数认证
        coverUrl: x.id && token ? `/api/v1/books/${x.id}/cover?token=${encodeURIComponent(token)}` : undefined,
        // 进度从小数 (0-1) 转换为百分比 (0-100)
        progress: Math.round((x.progress || 0) * 100),
        isFinished: !!x.finished_at,
        downloadUrl: undefined,
        updatedAt: x.updated_at,
        createdAt: x.created_at,
        ocrStatus: x.ocr_status || null,
        isImageBased: x.is_image_based || false,
      }))
      setItems(list)
      console.log('[LibraryPage] Loaded', list.length, 'books')
      return list
    } catch (error) {
      console.error('[LibraryPage] Failed to fetch books:', error)
      return []
    }
  }, [accessToken, t])

  // 初始加载
  useEffect(() => {
    const init = async () => {
      setIsLoading(true)
      await fetchList()
      setIsLoading(false)
    }
    init()
    
    // 监听上传成功事件
    const onUploaded = (e: CustomEvent) => {
      const newBook = e.detail
      if (newBook?.id) {
        setItems((prev) => [{
          id: newBook.id,
          title: newBook.title || t('common.untitled'),
          author: undefined,
          progress: 0,
          isFinished: false,
        }, ...prev])
      }
    }
    window.addEventListener('book_uploaded', onUploaded as any)
    
    // 监听封面就绪事件，刷新书籍列表以显示新封面
    const onCoverReady = () => {
      console.log('[LibraryPage] Cover ready, refreshing list...')
      fetchList()
    }
    window.addEventListener('book_cover_ready', onCoverReady as any)
    
    // 监听书籍数据更新事件（后处理完成后），刷新列表以获取 isImageBased 等更新字段
    const onDataUpdated = () => {
      console.log('[LibraryPage] Book data updated, refreshing list...')
      fetchList()
    }
    window.addEventListener('book_data_updated', onDataUpdated as any)
    
    return () => {
      window.removeEventListener('book_uploaded', onUploaded as any)
      window.removeEventListener('book_cover_ready', onCoverReady as any)
      window.removeEventListener('book_data_updated', onDataUpdated as any)
    }
  }, [t, accessToken, fetchList])

  // OCR 处理中时，每 5 秒轮询一次刷新列表
  useEffect(() => {
    if (!hasOcrProcessing) return

    console.log('[LibraryPage] OCR processing detected, starting polling...')
    const pollInterval = setInterval(() => {
      console.log('[LibraryPage] Polling for OCR status update...')
      fetchList()
    }, 5000) // 每 5 秒轮询

    return () => {
      console.log('[LibraryPage] Stopping OCR polling')
      clearInterval(pollInterval)
    }
  }, [hasOcrProcessing, fetchList])

  // 处理书籍删除
  const handleBookDeleted = useCallback((bookId: string) => {
    setItems(prev => prev.filter(item => item.id !== bookId))
  }, [])

  // 处理已读完状态变更
  const handleFinishedChange = useCallback((bookId: string, finished: boolean) => {
    setItems(prev => prev.map(item => 
      item.id === bookId ? { ...item, isFinished: finished } : item
    ))
  }, [])

  // 处理元数据更新
  const handleMetadataChange = useCallback((bookId: string, metadata: { title?: string; author?: string }) => {
    setItems(prev => prev.map(item => 
      item.id === bookId 
        ? { ...item, title: metadata.title || item.title, author: metadata.author } 
        : item
    ))
  }, [])

  // 处理 OCR 触发成功
  const handleOcrTrigger = useCallback((bookId: string) => {
    // 更新 OCR 状态为 pending
    setItems(prev => prev.map(item => 
      item.id === bookId ? { ...item, ocrStatus: 'pending' } : item
    ))
  }, [])

  return (
    <div className="p-4 md:p-6">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-label">{t('library.title')}</h1>
        <div className="flex items-center gap-3">
          {/* 桌面端：视图切换按钮 */}
          <div className="hidden md:flex items-center gap-1 rounded-lg bg-secondary-background p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                viewMode === 'grid' 
                  ? 'bg-system-background shadow-sm text-label' 
                  : 'text-secondary-label hover:text-label'
              }`}
            >
              网格
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                viewMode === 'list' 
                  ? 'bg-system-background shadow-sm text-label' 
                  : 'text-secondary-label hover:text-label'
              }`}
            >
              列表
            </button>
          </div>
          
          {/* 上传按钮 - 显眼样式 */}
          <UploadManager navigateOnSuccess={false} variant="icon" />
          
          {/* 三点菜单 - 移动端和桌面端都显示 */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-secondary-background transition-colors"
              aria-label="更多选项"
            >
              <MoreVertical className="h-5 w-5 text-secondary-label" />
            </button>
            
            {/* 下拉菜单 - 白色毛玻璃 + 展开动效 */}
            {showMenu && (
              <div 
                className="absolute right-0 top-full mt-2 w-56 rounded-xl bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl shadow-2xl border border-gray-200/50 dark:border-white/10 py-2 z-50 animate-menu-expand"
                style={{ transformOrigin: 'top right' }}
              >
                {/* 视图模式 - 仅移动端 */}
                <div className="md:hidden px-3 py-2">
                  <p className="text-xs font-medium text-secondary-label mb-2">显示方式</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setViewMode('grid'); setShowMenu(false) }}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg transition-colors ${
                        viewMode === 'grid' 
                          ? 'bg-system-blue/10 text-system-blue' 
                          : 'hover:bg-secondary-background text-label'
                      }`}
                    >
                      <Grid3X3 className="h-4 w-4" />
                      <span className="text-sm">网格</span>
                    </button>
                    <button
                      onClick={() => { setViewMode('list'); setShowMenu(false) }}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg transition-colors ${
                        viewMode === 'list' 
                          ? 'bg-system-blue/10 text-system-blue' 
                          : 'hover:bg-secondary-background text-label'
                      }`}
                    >
                      <List className="h-4 w-4" />
                      <span className="text-sm">列表</span>
                    </button>
                  </div>
                </div>
                
                <div className="md:hidden border-t border-separator my-2" />
                
                {/* 排序选项 */}
                <div className="px-3 py-2">
                  <p className="text-xs font-medium text-secondary-label mb-2">排序方式</p>
                  {[
                    { key: 'recent' as SortBy, icon: Clock, label: '最近阅读' },
                    { key: 'title' as SortBy, icon: BookOpen, label: '书名' },
                    { key: 'author' as SortBy, icon: User, label: '作者' },
                    { key: 'upload' as SortBy, icon: Upload, label: '上传时间' },
                  ].map((option) => (
                    <button
                      key={option.key}
                      onClick={() => { setSortBy(option.key); setShowMenu(false) }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                        sortBy === option.key 
                          ? 'bg-system-blue/10 text-system-blue' 
                          : 'hover:bg-secondary-background text-label'
                      }`}
                    >
                      <option.icon className="h-4 w-4" />
                      <span className="text-sm flex-1 text-left">{option.label}</span>
                      {sortBy === option.key && <Check className="h-4 w-4" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 加载状态 */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-system-blue border-t-transparent" />
        </div>
      )}

      {/* 空状态 */}
      {!isLoading && items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-secondary-background">
            <svg className="h-10 w-10 text-secondary-label" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-label mb-2">{t('library.import_first')}</h3>
          <p className="text-sm text-secondary-label mb-6">
            上传你的第一本书，开始你的阅读之旅
          </p>
          <UploadManager variant="button" navigateOnSuccess={false} />
        </div>
      )}

      {/* 书籍列表 */}
      {!isLoading && items.length > 0 && (
        <>
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4">
              {sortedItems.map((item) => {
                // 计算书籍状态：优先显示阅读进度，否则显示缓存状态
                const cacheStatus = getBookCacheStatus(item.id)
                const displayStatus = item.progress && item.progress >= 100 
                  ? 'completed' 
                  : item.progress && item.progress > 0 
                    ? 'reading' 
                    : cacheStatus
                
                  return (
                  <BookCard
                    key={item.id}
                    id={item.id}
                    variant="grid"
                    title={item.title}
                    author={item.author}
                    coverUrl={item.coverUrl}
                    progress={item.progress}
                    status={displayStatus}
                    isFinished={item.isFinished}
                    ocrStatus={item.ocrStatus}
                    isImageBased={item.isImageBased}
                    onDeleted={handleBookDeleted}
                    onFinishedChange={handleFinishedChange}
                    onMetadataChange={handleMetadataChange}
                    onOcrTrigger={handleOcrTrigger}
                    onClick={() => navigate(`/app/read/${item.id}`)}
                  />
                )
              })}
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {sortedItems.map((item) => {
                const cacheStatus = getBookCacheStatus(item.id)
                const displayStatus = item.progress && item.progress >= 100 
                  ? 'completed' 
                  : item.progress && item.progress > 0 
                    ? 'reading' 
                    : cacheStatus
                
                return (
                  <BookCard
                    key={item.id}
                    id={item.id}
                    variant="list"
                    title={item.title}
                    author={item.author}
                    coverUrl={item.coverUrl}
                    progress={item.progress}
                    status={displayStatus}
                    isFinished={item.isFinished}
                    ocrStatus={item.ocrStatus}
                    isImageBased={item.isImageBased}
                    onDeleted={handleBookDeleted}
                    onFinishedChange={handleFinishedChange}
                    onMetadataChange={handleMetadataChange}
                    onOcrTrigger={handleOcrTrigger}
                    onClick={() => navigate(`/app/read/${item.id}`)}
                  />
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
