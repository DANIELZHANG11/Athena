import { useTranslation } from 'react-i18next'
import { BookOpen } from 'lucide-react'

type Item = { book_id: string; title: string; coverUrl?: string; progress: number }
type Props = { items: Item[] }

export default function ContinueReadingList({ items }: Props) {
  const { t } = useTranslation('common')
  const empty = !items || items.length === 0
  return (
    <div className="mt-4">
      <div className="flex gap-3 overflow-x-auto snap-x" style={{ scrollSnapType: 'x mandatory' }}>
        {empty ? (
          <a href="/app/library" className="min-w-[160px] snap-start">
            <div className="aspect-[2/3] rounded-[20px] shadow-md border border-black/5 overflow-hidden">
              <div className="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700 flex flex-col items-center justify-center gap-2">
                <BookOpen className="w-7 h-7" style={{ color: 'var(--secondary-label)' }} />
                <span className="text-xs" style={{ color: 'var(--secondary-label)' }}>{t('library.import_book')}</span>
              </div>
            </div>
          </a>
        ) : (
          items.map((it) => (
            <div key={it.book_id} className="min-w-[160px] snap-start">
              <div className="rounded-2xl shadow-md border border-separator bg-system-background overflow-hidden">
                <div className="h-32 bg-overlay" style={{ backgroundImage: it.coverUrl ? `url(${it.coverUrl})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }} />
                <div className="p-2">
                  <div className="text-label text-sm line-clamp-2">{it.title || 'Untitled'}</div>
                  <div className="mt-1 h-1 rounded bg-secondary-background">
                    <div className="h-1 rounded" style={{ width: `${Math.min(100, Math.round(it.progress * 100))}%`, backgroundColor: 'var(--system-blue)' }} />
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
