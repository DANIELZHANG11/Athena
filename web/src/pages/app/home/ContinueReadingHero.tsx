import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = {
    bookId: string
    title: string
    author?: string
    coverUrl?: string
    progress: number
}

export default function ContinueReadingHero({ bookId, title, author, coverUrl, progress }: Props) {
    const { t } = useTranslation('common')
    const navigate = useNavigate()

    return (
        <div className="w-full mb-8">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">{t('home.continue_reading')}</h2>
                <Button variant="ghost" className="text-system-blue" onClick={() => navigate('/app/library')}>
                    {t('common.view_all')}
                </Button>
            </div>

            <div
                className="relative overflow-hidden rounded-[20px] bg-white dark:bg-gray-800 shadow-lg border border-gray-100 dark:border-gray-700 cursor-pointer group"
                onClick={() => navigate(`/app/read/${bookId}`)}
            >
                <div className="flex flex-col sm:flex-row">
                    {/* Cover Image Section */}
                    <div className="sm:w-1/3 h-48 sm:h-auto relative bg-gray-100 dark:bg-gray-900 flex items-center justify-center overflow-hidden">
                        {coverUrl ? (
                            <img
                                src={coverUrl}
                                alt={title}
                                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                            />
                        ) : (
                            <BookOpen className="w-12 h-12 text-gray-400" />
                        )}

                        {/* Play Button Overlay */}
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                            <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg backdrop-blur-sm">
                                <Play className="w-5 h-5 ml-1 text-black" fill="currentColor" />
                            </div>
                        </div>
                    </div>

                    {/* Content Section */}
                    <div className="flex-1 p-6 flex flex-col justify-between">
                        <div>
                            <h3 className="text-2xl font-bold line-clamp-2 mb-2">{title || t('common.untitled')}</h3>
                            <p className="text-secondary-label text-lg mb-4">{author || t('common.unknown_author')}</p>
                        </div>

                        <div className="mt-auto">
                            <div className="flex justify-between text-sm text-secondary-label mb-2">
                                <span>{Math.round(progress * 100)}% {t('common.completed')}</span>
                            </div>
                            <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                                <div
                                    className="h-full bg-system-blue rounded-full transition-all duration-500 ease-out"
                                    style={{ width: `${Math.max(2, Math.min(100, progress * 100))}%` }}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
