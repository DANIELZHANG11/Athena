import { useEffect, useState } from 'react'
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

  const refresh = async () => {
    const at = useAuthStore.getState().accessToken || ''
    try {
      const r = await fetch('/api/v1/home/dashboard', { headers: { Authorization: `Bearer ${at}` } })
      const j = await r.json()
      setDash(j.data || null)
    } catch { }
  }

  useEffect(() => {
    const at = useAuthStore.getState().accessToken || ''
      ; (async () => {
        await refresh()
        try {
          const r2 = await fetch('/api/v1/reader/progress', { headers: { Authorization: `Bearer ${at}` } })
          const j2 = await r2.json()
          // Fetch details for each book to get author and cover
          const progressItems = j2.data || []
          const detailedItems = await Promise.all(progressItems.map(async (x: any) => {
            try {
              const bookRes = await fetch(`/api/v1/books/${x.book_id}`, { headers: { Authorization: `Bearer ${at}` } })
              const bookData = await bookRes.json()
              return {
                book_id: x.book_id,
                title: bookData.data.title,
                author: bookData.data.author,
                coverUrl: bookData.data.cover_image_key ? `/api/v1/books/${x.book_id}/cover` : undefined,
                progress: x.progress
              }
            } catch {
              return { book_id: x.book_id, title: 'Unknown', progress: x.progress }
            }
          }))
          setItems(detailedItems)
        } catch { }
        setLoading(false)
      })()
  }, [])

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
              <div className="space-y-6">
                <WeeklyActivity days={dash?.weekly || []} goalMinutes={dash?.goals?.daily_minutes || 30} />

                {/* Streak Card */}
                <div className="bg-secondary-background rounded-[20px] p-6 border border-separator shadow-sm flex flex-col justify-center h-[140px]">
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
              <ContinueReadingList items={recentBooks} />
            </div>
          )}

          {/* Yearly Goal Section */}
          <YearlyGoalCard
            count={dash?.yearly_finished?.count || 0}
            target={dash?.goals?.yearly_books || 10}
            covers={dash?.yearly_finished?.recent_covers || []}
            onGoalUpdate={refresh}
          />
        </div>
      )}
    </div>
  )
}
