/**
 * 继续阅读 Hero 卡片
 *
 * 说明：
 * - 显示封面、标题、作者与进度，点击跳转阅读
 * - 提取封面主色用于 Ambient Blur 背景，自动适配文字颜色
 * - 集成 `BookCardMenu` 提供删除/已读完等操作
 */
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Play, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import BookCardMenu from '@/components/BookCardMenu'
import { useState, useEffect } from 'react'

type Props = {
    bookId: string
    title: string
    author?: string
    coverUrl?: string
    progress: number
    isFinished?: boolean
    onDeleted?: () => void
    onFinishedChange?: (finished: boolean) => void
}

/**
 * 从图片 URL 提取主色调
 * 支持跨域图片和带 token 的 API 请求
 */
function extractDominantColor(imageUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    // 对于同源 API 请求，不设置 crossOrigin
    // 对于外部 URL（如 S3 预签名 URL），需要设置 crossOrigin
    const isLocalApi = imageUrl.startsWith('/api/') || imageUrl.startsWith(window.location.origin)
    if (!isLocalApi) {
      img.crossOrigin = 'anonymous'
    }
    console.log('[Hero ColorExtract] Loading:', imageUrl, 'crossOrigin:', !isLocalApi)
    
    const timeoutId = setTimeout(() => {
      console.log('[Hero ColorExtract] Timeout for:', imageUrl)
      resolve('#6B7280')
    }, 5000)
    
    img.onload = () => {
      clearTimeout(timeoutId)
      try {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve('#6B7280')
          return
        }
        // 采样整个图片的中心区域
        canvas.width = 50
        canvas.height = 75
        ctx.drawImage(img, 0, 0, 50, 75)
        const imageData = ctx.getImageData(5, 10, 40, 55)
        const data = imageData.data
        let r = 0, g = 0, b = 0, count = 0
        // 跳过太暗或太亮的像素
        for (let i = 0; i < data.length; i += 4) {
          const pr = data[i]
          const pg = data[i + 1]
          const pb = data[i + 2]
          const brightness = (pr + pg + pb) / 3
          if (brightness > 20 && brightness < 235) {
            r += pr
            g += pg
            b += pb
            count++
          }
        }
        if (count === 0) count = 1
        r = Math.round(r / count)
        g = Math.round(g / count)
        b = Math.round(b / count)
        console.log('[Hero ColorExtract] Extracted:', `rgb(${r}, ${g}, ${b})`)
        resolve(`rgb(${r}, ${g}, ${b})`)
      } catch (e) {
        console.warn('[Hero ColorExtract] Canvas error:', e)
        resolve('#6B7280')
      }
    }
    img.onerror = (e) => {
      clearTimeout(timeoutId)
      console.warn('[Hero ColorExtract] Image load error:', e)
      resolve('#6B7280')
    }
    img.src = imageUrl
  })
}

/**
 * 计算颜色亮度 (0-1)
 */
function getLuminance(color: string): number {
  try {
    const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
    if (match) {
      const r = parseInt(match[1]) / 255
      const g = parseInt(match[2]) / 255
      const b = parseInt(match[3]) / 255
      return 0.299 * r + 0.587 * g + 0.114 * b
    }
    const hex = color.replace('#', '')
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16) / 255
      const g = parseInt(hex.slice(2, 4), 16) / 255
      const b = parseInt(hex.slice(4, 6), 16) / 255
      return 0.299 * r + 0.587 * g + 0.114 * b
    }
  } catch {
    // Invalid hex color, return default luminance
  }
  return 0.5
}

export default function ContinueReadingHero({ bookId, title, author, coverUrl, progress, isFinished = false, onDeleted, onFinishedChange }: Props) {
    const { t } = useTranslation('common')
    const navigate = useNavigate()
    const [dominantColor, setDominantColor] = useState('#6B7280')
    const [imgError, setImgError] = useState(false)
    
    // 调试：记录传入的 coverUrl
    useEffect(() => {
        console.log('[Hero] Received props - bookId:', bookId, 'coverUrl:', coverUrl)
    }, [bookId, coverUrl])
    
    useEffect(() => {
        if (coverUrl) {
            setImgError(false) // Reset error state when coverUrl changes
            extractDominantColor(coverUrl).then(setDominantColor)
        }
    }, [coverUrl])
    
    const luminance = getLuminance(dominantColor)
    // 默认使用白色文字，因为 blur 背景通常较暗
    // 只有当确认提取到浅色时才使用深色文字
    const isLight = dominantColor !== '#6B7280' && luminance > 0.6
    const textClass = isLight ? 'text-gray-900' : 'text-white'
    const subTextClass = isLight ? 'text-gray-700' : 'text-white/80'
    // progress 已经是百分比 (0-100)，直接使用
    const progressPercent = Math.min(100, Math.round(progress))

    return (
        <div className="w-full mb-8">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">{t('home.continue_reading')}</h2>
                <Button variant="ghost" className="text-system-blue" onClick={() => navigate('/app/library')}>
                    {t('common.view_all')}
                </Button>
            </div>

            {/* Hero Card - 1/4 封面 + 3/4 Ambient Blur */}
            <div
                className="relative overflow-hidden rounded-2xl shadow-xl cursor-pointer group transition-transform duration-200 hover:scale-[1.01]"
                style={{ backgroundColor: dominantColor, height: '160px' }}
                onClick={() => navigate(`/app/read/${bookId}`)}
            >
                {/* Ambient Blur 背景 - 使用封面图片模糊放大 */}
                {coverUrl && (
                    <div 
                        className="absolute inset-0 scale-150"
                        style={{
                            backgroundImage: `url(${coverUrl})`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            filter: 'blur(40px) brightness(0.9)',
                        }}
                    />
                )}
                
                {/* 渐变遮罩 - 确保文字可读 */}
                <div 
                    className="absolute inset-0"
                    style={{
                        background: isLight 
                            ? 'linear-gradient(to right, rgba(255,255,255,0.2), rgba(255,255,255,0.5))'
                            : 'linear-gradient(to right, rgba(0,0,0,0.2), rgba(0,0,0,0.4))'
                    }}
                />
                
                {/* 内容布局 */}
                <div className="relative flex h-full">
                    {/* 封面区域 - 图片上边与标题齐平，下边与进度条齐平 */}
                    <div className="w-1/4 shrink-0 flex items-stretch py-3 pl-4">
                        {/* 封面图片容器 - 占满高度 */}
                        <div className="relative w-full overflow-hidden rounded-lg shadow-2xl" style={{ aspectRatio: '2/3', minWidth: '80px', maxWidth: '100px' }}>
                            {coverUrl && !imgError ? (
                                <img
                                    src={coverUrl}
                                    alt={title}
                                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                    onError={() => {
                                        console.warn('[Hero] Image load error:', coverUrl)
                                        setImgError(true)
                                    }}
                                />
                            ) : (
                                <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center">
                                    <BookOpen className="w-8 h-8 text-gray-400" />
                                </div>
                            )}
                            
                            {/* Play 按钮 - Hover 时显示 */}
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center shadow-lg backdrop-blur-sm">
                                    <Play className="w-4 h-4 ml-0.5 text-black" fill="currentColor" />
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    {/* 内容区域 - 占 3/4 宽度 */}
                    <div className="flex-1 flex flex-col justify-center px-4 py-3 pr-12 overflow-hidden">
                        <h3 className={`text-lg font-bold mb-1 overflow-hidden whitespace-nowrap ${textClass}`}>
                            {title || t('common.untitled')}
                        </h3>
                        <p className={`text-sm mb-3 overflow-hidden whitespace-nowrap ${subTextClass}`}>
                            {author || t('common.unknown_author')}
                        </p>
                        
                        {/* 进度信息 - 已读完时显示勾选图标和"已读完" */}
                        <div className="mt-auto">
                            {isFinished ? (
                                <div className={`flex items-center gap-2 ${textClass}`}>
                                    <div className="w-5 h-5 rounded-full bg-system-blue flex items-center justify-center">
                                        <Check className="w-3 h-3 text-white" />
                                    </div>
                                    <span className="text-sm font-medium">{t('common.finished')}</span>
                                </div>
                            ) : (
                                <>
                                    <div className={`text-sm mb-2 opacity-80 ${textClass}`}>
                                        {progressPercent}% {t('common.completed')}
                                    </div>
                                    <div className="h-1.5 rounded-full bg-black/10 overflow-hidden">
                                        <div
                                            className="h-full bg-white/90 rounded-full transition-all duration-500 ease-out"
                                            style={{ width: `${Math.max(2, progressPercent)}%` }}
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                    
                    {/* 更多按钮 - 使用 BookCardMenu */}
                    <div className="absolute top-3 right-3">
                        <BookCardMenu
                            bookId={bookId}
                            bookTitle={title}
                            isFinished={isFinished}
                            onDeleted={onDeleted}
                            onFinishedChange={onFinishedChange}
                            buttonClassName={textClass}
                        />
                    </div>
                </div>
                
                {/* 底部进度条线 - 已读完时隐藏 */}
                {!isFinished && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-black/10">
                        <div 
                            className="h-full bg-white/80 transition-all"
                            style={{ width: `${progressPercent}%` }}
                        />
                    </div>
                )}
            </div>
        </div>
    )
}
