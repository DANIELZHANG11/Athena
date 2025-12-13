import { useTranslation } from 'react-i18next'
import HomeHeader from './home/HomeHeader'
import ReadingGoalCard from './home/ReadingGoalCard'
import ContinueReadingHero from './home/ContinueReadingHero'
import ContinueReadingList from './home/ContinueReadingList'
import WeeklyActivity from './home/WeeklyActivity'
import YearlyGoalCard from './home/YearlyGoalCard'
import HomeSkeleton from './home/HomeSkeleton'
import { useAuthStore } from '@/stores/auth'
import { useDashboardData } from '@/hooks/useDashboardData'
import { useAllProgressData } from '@/hooks/useProgressData'

export default function Home() {
  const { t } = useTranslation('common')
  const { dashboard, updateGoals, isLoading: isDashboardLoading } = useDashboardData()
  const { recentBooks, isLoading: isBooksLoading } = useAllProgressData({ limit: 10 })
  const accessToken = useAuthStore(s => s.accessToken)

  const loading = isDashboardLoading || isBooksLoading

  // 转换最近阅读书籍数据格式
  const items = recentBooks.map(item => ({
    book_id: item.bookId,
    title: item.title,
    author: item.author,
    coverUrl: item.bookId && accessToken
      ? `/api/v1/books/${item.bookId}/cover?token=${encodeURIComponent(accessToken)}`
      : undefined,
    progress: Math.round(item.percentage * 100),
    isFinished: item.percentage >= 1.0,
  }))

  const heroBook = items[0]
  const recentList = items.slice(1)

  // 处理书籍删除 (仅本地状态更新，实际上 PowerSync 会自动处理)
  const handleBookDeleted = (bookId: string) => {
    // 乐观 UI 更新在 useQuery 中是自动的，这里只要 Query 重新运行即可
    // PowerSync 接收到 delete 事件后会自动更新 recentBooks
    console.log('Book deleted:', bookId)
  }

  // 处理已读完状态变更
  const handleFinishedChange = (bookId: string, finished: boolean) => {
    // 同样，PowerSync 会自动处理
    console.log('Book finished status changed:', bookId, finished)
  }

  // 处理目标更新
  const handleGoalUpdate = async (val: number, type: 'daily' | 'yearly') => {
    if (type === 'daily') {
      await updateGoals(val, undefined)
    } else {
      await updateGoals(undefined, val)
    }
  }

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
                todaySeconds={dashboard.today.seconds}
                goalMinutes={dashboard.goals.daily_minutes}
                onGoalUpdate={(val) => handleGoalUpdate(val, 'daily')}
              />
              <div className="space-y-6 md:flex md:flex-col md:justify-between md:space-y-0 md:gap-4">
                <WeeklyActivity
                  days={dashboard.weekly}
                  goalMinutes={dashboard.goals.daily_minutes}
                />

                {/* Streak Card - 统一阴影和hover效果 */}
                <div className="bg-white dark:bg-gray-800 rounded-[20px] p-6 border border-gray-100 dark:border-gray-700 shadow-lg flex flex-col justify-center h-[140px] transition-transform duration-fast hover:scale-[1.02]">
                  <div className="text-sm text-secondary-label uppercase font-medium mb-1">{t('home.current_streak')}</div>
                  <div className="text-3xl font-bold mb-1">{dashboard.streak.current_streak} {t('common.days')}</div>
                  <div className="text-sm text-secondary-label">
                    {t('home.longest_streak')}: {dashboard.streak.longest_streak} {t('common.days')}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Previously Read Section */}
          {recentList.length > 0 && (
            <div>
              <h2 className="text-xl font-bold mb-4">{t('home.previously_read')}</h2>
              <ContinueReadingList
                items={recentList}
                onItemDeleted={handleBookDeleted}
                onItemFinishedChange={handleFinishedChange}
              />
            </div>
          )}

          {/* Yearly Goal Section */}
          <YearlyGoalCard
            count={dashboard.yearly_finished.count}
            target={dashboard.goals.yearly_books}
            covers={dashboard.yearly_finished.recent_covers}
            onGoalUpdate={(val) => handleGoalUpdate(val, 'yearly')}
          />
        </div>
      )}
    </div>
  )
}
