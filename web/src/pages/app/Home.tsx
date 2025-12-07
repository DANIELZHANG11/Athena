import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import HomeHeader from './home/HomeHeader'
import ReadingGoalCard from './home/ReadingGoalCard'
import ContinueReadingHero from './home/ContinueReadingHero'
import ContinueReadingList from './home/ContinueReadingList'
import WeeklyActivity from './home/WeeklyActivity'
import YearlyGoalCard from './home/YearlyGoalCard'
import HomeSkeleton from './home/HomeSkeleton'
import { useAuthStore } from '@/stores/auth'

export default function Home() {
  const { t } = useTranslation('common')
  const [dash, setDash] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const at = useAuthStore.getState().accessToken || ''
    try {
      const r = await fetch('/api/v1/home/dashboard', { headers: { Authorization: `Bearer ${at}` } })
      const j = await r.json()
      setDash(j.data || null)
    } catch {
      // Dashboard fetch failed, use default state
    }
  }, [])

  const loadItems = useCallback(async () => {
    const at = useAuthStore.getState().accessToken || ''
    try {
      const r2 = await fetch('/api/v1/reader/progress', { headers: { Authorization: `Bearer ${at}` } })
      const j2 = await r2.json()
      // Fetch details for each book to get author and cover
      const progressItems = j2.data || []
      const detailedItems = await Promise.all(progressItems.map(async (x: any) => {
        try {
          const bookRes = await fetch(`/api/v1/books/${x.book_id}`, { headers: { Authorization: `Bearer ${at}` } })
          if (!bookRes.ok) {
            // 书籍不存在 (可能已被删除)，返回 null 以便过滤掉
            console.warn('[Home] Book not found, skipping:', x.book_id)
            return null
          }
          const bookData = await bookRes.json()
          console.log('[Home] Book data:', x.book_id, bookData.data?.title, 'author:', bookData.data?.author)
          // 始终使用 API 代理获取封面，避免移动端无法访问 localhost S3
          const hasCover = bookData.data.cover_url || bookData.data.cover_image_key
          const coverUrl = hasCover ? `/api/v1/books/${x.book_id}/cover?token=${encodeURIComponent(at)}` : undefined
          return {
            book_id: x.book_id,
            title: bookData.data.title,
            author: bookData.data.author || undefined,
            coverUrl,
            // 进度从小数 (0-1) 转换为百分比 (0-100)
            progress: Math.round((x.progress || 0) * 100),
            isFinished: !!x.finished_at,
          }
        } catch (e) {
          console.error('[Home] Failed to fetch book:', x.book_id, e)
          return null  // 返回 null 以便过滤掉
        }
      }))
      // 过滤掉无效的项目 (null)
      setItems(detailedItems.filter((item): item is NonNullable<typeof item> => item !== null))
    } catch {
      // Progress fetch failed, use empty list
    }
  }, [])

  useEffect(() => {
    (async () => {
      await refresh()
      await loadItems()
      setLoading(false)
    })()
  }, [refresh, loadItems])

  // 处理书籍删除
  const handleBookDeleted = useCallback((bookId: string) => {
    setItems(prev => prev.filter(item => item.book_id !== bookId))
    refresh() // 刷新 dashboard 数据
  }, [refresh])

  // 处理已读完状态变更
  const handleFinishedChange = useCallback((bookId: string, finished: boolean) => {
    setItems(prev => prev.map(item => 
      item.book_id === bookId ? { ...item, isFinished: finished } : item
    ))
    refresh() // 刷新 dashboard 数据以更新年度目标
  }, [refresh])

  const heroBook = items[0]
  const recentBooks = items.slice(1)

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 pb-24">
      <HomeHeader />

      {loading ? (
        <HomeSkeleton />
      ) : (
        <div className="space-y-10">
          {/* Hero Section */}
          {heroBook && (
            <ContinueReadingHero
              bookId={heroBook.book_id}
              title={heroBook.title}
              author={heroBook.author}
              coverUrl={heroBook.coverUrl}
              progress={heroBook.progress}
              isFinished={heroBook.isFinished}
              onDeleted={() => handleBookDeleted(heroBook.book_id)}
              onFinishedChange={(finished) => handleFinishedChange(heroBook.book_id, finished)}
            />
          )}

          {/* Reading Goals Section */}
          <div>
            <h2 className="text-xl font-bold mb-4">{t('home.reading_goals')}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <ReadingGoalCard
                todaySeconds={dash?.today?.seconds || 0}
                goalMinutes={dash?.goals?.daily_minutes || 30}
                onGoalUpdate={refresh}
              />
              <div className="space-y-6 md:flex md:flex-col md:justify-between md:space-y-0 md:gap-4">
                <WeeklyActivity days={dash?.weekly || []} goalMinutes={dash?.goals?.daily_minutes || 30} />

                {/* Streak Card - 统一阴影和hover效果 */}
                <div className="bg-white dark:bg-gray-800 rounded-[20px] p-6 border border-gray-100 dark:border-gray-700 shadow-lg flex flex-col justify-center h-[140px] transition-transform duration-fast hover:scale-[1.02]">
                  <div className="text-sm text-secondary-label uppercase font-medium mb-1">{t('home.current_streak')}</div>
                  <div className="text-3xl font-bold mb-1">{dash?.streak?.current_streak || 0} {t('common.days')}</div>
                  <div className="text-sm text-secondary-label">
                    {t('home.longest_streak')}: {dash?.streak?.longest_streak || 0} {t('common.days')}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Previously Read Section */}
          {recentBooks.length > 0 && (
            <div>
              <h2 className="text-xl font-bold mb-4">{t('home.previously_read')}</h2>
              <ContinueReadingList 
                items={recentBooks}
                onItemDeleted={handleBookDeleted}
                onItemFinishedChange={handleFinishedChange}
              />
            </div>
          )}

          {/* Yearly Goal Section */}
          <YearlyGoalCard
            count={dash?.yearly_finished?.count || 0}
            target={dash?.goals?.yearly_books || 10}
            covers={(dash?.yearly_finished?.recent_covers || []).map((bookId: string) => {
              const at = useAuthStore.getState().accessToken || ''
              return `/api/v1/books/${bookId}/cover?token=${encodeURIComponent(at)}`
            })}
            onGoalUpdate={refresh}
          />
        </div>
      )}
    </div>
  )
}
