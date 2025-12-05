/**
 * 继续阅读列表（横向滚动）
 *
 * 说明：
 * - 当无项目时显示导入提示卡片
 * - 使用 `BookCard` list 变体呈现多个继续阅读项
 * - 支持删除与已读完事件回调
 */
import { useTranslation } from 'react-i18next'
import { BookOpen } from 'lucide-react'
import BookCard from '@/components/BookCard'

type Item = { 
  book_id: string
  title: string
  author?: string
  coverUrl?: string
  progress: number
  isFinished?: boolean
}
type Props = { 
  items: Item[]
  onItemDeleted?: (bookId: string) => void
  onItemFinishedChange?: (bookId: string, finished: boolean) => void
}

export default function ContinueReadingList({ items, onItemDeleted, onItemFinishedChange }: Props) {
  const { t } = useTranslation('common')
  const empty = !items || items.length === 0
  
  return (
    <div className="mt-4">
      <div className="flex gap-4 overflow-x-auto snap-x pb-2" style={{ scrollSnapType: 'x mandatory' }}>
        {empty ? (
          <a href="/app/library" className="min-w-[280px] snap-start">
            <div className="h-[100px] rounded-2xl shadow-lg border border-black/5 overflow-hidden bg-linear-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700 flex items-center justify-center gap-3">
              <BookOpen className="w-7 h-7" style={{ color: 'var(--secondary-label)' }} />
              <span className="text-sm font-medium" style={{ color: 'var(--secondary-label)' }}>
                {t('library.import_book')}
              </span>
            </div>
          </a>
        ) : (
          items.map((item) => (
            <BookCard
              key={item.book_id}
              id={item.book_id}
              title={item.title}
              author={item.author}
              coverUrl={item.coverUrl}
              progress={item.progress}
              isFinished={item.isFinished}
              status={item.isFinished ? 'completed' : 'reading'}
              variant="list"
              className="min-w-[280px] max-w-[360px] snap-start"
              onClick={() => window.location.href = `/app/read/${item.book_id}`}
              onDeleted={onItemDeleted}
              onFinishedChange={onItemFinishedChange}
            />
          ))
        )}
      </div>
    </div>
  )
}
