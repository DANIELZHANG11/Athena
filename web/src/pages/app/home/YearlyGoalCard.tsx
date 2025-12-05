/**
 * 年度阅读目标卡片
 *
 * 说明：
 * - 展示已读/目标书籍数量与剩余提示
 * - 显示封面栈视觉效果
 * - 支持轮盘选择器调整年度目标并调用 API 更新
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import Modal from '@/components/ui/Modal'
import { useAuthStore } from '@/stores/auth'
import { Settings2, ChevronUp, ChevronDown } from 'lucide-react'

type Props = {
  count: number;
  target: number;
  covers: string[];
  onGoalUpdate?: () => void;
}

// 轮盘式数字选择器组件 - 稳定版本，支持触摸滑动
function WheelPicker({ 
  value, 
  onChange, 
  min = 1, 
  max = 365, 
  step = 1,
}: { 
  value: number; 
  onChange: (v: number) => void; 
  min?: number; 
  max?: number;
  step?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const touchStartY = useRef<number>(0)
  const touchStartValue = useRef<number>(value)
  const valueRef = useRef<number>(value)

  // 同步 value 到 ref
  useEffect(() => {
    valueRef.current = value
  }, [value])
  
  // 快捷按钮调整
  const increment = useCallback(() => {
    onChange(Math.min(max, value + step))
  }, [value, max, step, onChange])
  
  const decrement = useCallback(() => {
    onChange(Math.max(min, value - step))
  }, [value, min, step, onChange])

  // 处理鼠标滚轮 - 使用 ref 避免频繁重绑事件
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    const currentVal = valueRef.current
    const delta = e.deltaY > 0 ? -step : step
    const newValue = Math.max(min, Math.min(max, currentVal + delta))
    
    if (newValue !== currentVal) {
      onChange(newValue)
    }
  }, [min, max, step, onChange])

  // 触摸开始
  const handleTouchStart = useCallback((e: TouchEvent) => {
    touchStartY.current = e.touches[0].clientY
    touchStartValue.current = valueRef.current
  }, [])

  // 触摸移动
  const handleTouchMove = useCallback((e: TouchEvent) => {
    e.preventDefault()
    const deltaY = touchStartY.current - e.touches[0].clientY
    const deltaSteps = Math.round(deltaY / 30) // 每30px一个step
    const newValue = Math.max(min, Math.min(max, touchStartValue.current + deltaSteps * step))
    
    if (newValue !== valueRef.current) {
      onChange(newValue)
    }
  }, [min, max, step, onChange])

  // 绑定事件监听器
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // 使用 passive: false 允许 preventDefault
    container.addEventListener('wheel', handleWheel, { passive: false })
    container.addEventListener('touchstart', handleTouchStart, { passive: true })
    container.addEventListener('touchmove', handleTouchMove, { passive: false })

    return () => {
      container.removeEventListener('wheel', handleWheel)
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchmove', handleTouchMove)
    }
  }, [handleWheel, handleTouchStart, handleTouchMove])

  // 计算上下显示的数值
  const prevValue = value > min ? value - step : null
  const nextValue = value < max ? value + step : null

  return (
    <div className="flex flex-col items-center gap-1">
      {/* 上箭头 */}
      <button 
        type="button"
        onClick={increment}
        className="p-2 md:p-3 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors active:scale-95"
      >
        <ChevronUp className="w-5 h-5 md:w-6 md:h-6 text-system-blue" />
      </button>
      
      {/* 数字滚动区域 */}
      <div
        ref={containerRef}
        className="relative select-none touch-none cursor-ns-resize"
      >
        {/* 中间高亮框 */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-10 md:h-14 border-y-2 border-system-blue/30 pointer-events-none" />
        
        {/* 数字显示区域 */}
        <div className="py-4 md:py-6 px-6 md:px-10">
          <div className="flex flex-col items-center justify-center gap-2 md:gap-3">
            {/* 上一个数值 */}
            <div className="text-lg md:text-2xl font-medium text-gray-300 dark:text-gray-600 h-6 md:h-8 flex items-center justify-center tabular-nums min-w-[60px] md:min-w-[80px]">
              {prevValue ?? ''}
            </div>
            
            {/* 当前数值 */}
            <div className="text-3xl md:text-5xl font-bold text-system-blue h-10 md:h-14 flex items-center justify-center tabular-nums min-w-[60px] md:min-w-[80px]">
              {value}
            </div>
            
            {/* 下一个数值 */}
            <div className="text-lg md:text-2xl font-medium text-gray-300 dark:text-gray-600 h-6 md:h-8 flex items-center justify-center tabular-nums min-w-[60px] md:min-w-[80px]">
              {nextValue ?? ''}
            </div>
          </div>
        </div>
      </div>
      
      {/* 下箭头 */}
      <button 
        type="button"
        onClick={decrement}
        className="p-2 md:p-3 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors active:scale-95"
      >
        <ChevronDown className="w-5 h-5 md:w-6 md:h-6 text-system-blue" />
      </button>
    </div>
  )
}

export default function YearlyGoalCard({ count, target, covers, onGoalUpdate }: Props) {
  const { t } = useTranslation('common')
  const [showAdjust, setShowAdjust] = useState(false)
  const [newTarget, setNewTarget] = useState(target)
  const [updating, setUpdating] = useState(false)

  const remain = Math.max(0, target - count)
  
  // 当弹窗打开时，同步当前目标值
  useEffect(() => {
    if (showAdjust) {
      setNewTarget(target)
    }
  }, [showAdjust, target])

  const handleUpdate = async () => {
    setUpdating(true)
    try {
      const at = useAuthStore.getState().accessToken || localStorage.getItem('access_token') || ''
      await fetch('/api/v1/home/goals', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${at}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ yearly_books: parseInt(String(newTarget)) })
      })
      setShowAdjust(false)
      onGoalUpdate?.()
    } catch (e) {
      console.error(e)
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div className="relative mt-8 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-[20px] shadow-lg p-6 overflow-hidden transition-transform duration-200 hover:scale-[1.01]">
      <div className="flex justify-between items-start mb-4 relative z-10">
        <div>
          <div className="text-secondary-label text-sm font-medium uppercase tracking-wide mb-1">{t('home.yearly_goal')}</div>
          <div className="text-2xl font-bold mb-1">
            {remain === 0 ? t('yearly_goal.reached_msg') : t('yearly_goal.remaining_msg', { count: remain })}
          </div>
          <div className="text-secondary-label text-sm">
            {count} / {target} {t('common.books')}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => { setNewTarget(target); setShowAdjust(true) }}>
          <Settings2 className="w-5 h-5 text-secondary-label" />
        </Button>
      </div>

      {/* Book Stack Visualization */}
      <div className="relative h-32 mt-4 flex items-end ml-4">
        {covers.length > 0 ? (
          covers.slice(0, 5).map((cv, idx) => {
            const z = 10 - idx
            const off = idx * 25
            return (
              <div
                key={idx}
                className="absolute w-20 h-32 rounded-md shadow-lg border border-white/20 transition-transform hover:-translate-y-2"
                style={{
                  left: `${off}px`,
                  zIndex: z,
                  backgroundImage: cv ? `url(${cv})` : undefined,
                  backgroundColor: '#fff',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  transform: `rotate(${idx * 2}deg)`
                }}
              />
            )
          })
        ) : (
          <div className="w-20 h-32 rounded-md bg-gray-200 dark:bg-gray-700 border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center">
            <span className="text-xs text-secondary-label">No books</span>
          </div>
        )}
      </div>

      {showAdjust && (
        <Modal className="flex flex-col items-center">
          <div className="w-full max-w-[280px] md:max-w-sm">
            <h3 className="text-base md:text-lg font-bold mb-4 md:mb-6 text-center">{t('home.adjust_yearly_goal')}</h3>
            
            <div className="flex flex-col items-center gap-3 md:gap-4">
              {/* 轮盘选择器 */}
              <WheelPicker
                value={newTarget}
                onChange={setNewTarget}
                min={1}
                max={365}
                step={1}
              />
              
              <div className="text-base md:text-lg text-secondary-label">
                {t('common.books')}
              </div>
              
              {/* 快捷预设按钮 */}
              <div className="flex flex-wrap gap-1.5 md:gap-2 justify-center mt-1 md:mt-2">
                {[12, 24, 52, 100, 150].map((num) => (
                  <button
                    key={num}
                    onClick={() => setNewTarget(num)}
                    className={`px-3 py-1.5 md:px-4 md:py-2 rounded-full text-xs md:text-sm font-medium transition-colors ${
                      newTarget === num
                        ? 'bg-system-blue text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-label hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {num}
                  </button>
                ))}
              </div>
              
              <div className="flex gap-2 md:gap-3 w-full mt-3 md:mt-4">
                <Button variant="outline" className="flex-1 text-sm" onClick={() => setShowAdjust(false)}>
                  {t('common.cancel')}
                </Button>
                <Button className="flex-1 text-sm" onClick={handleUpdate} disabled={updating}>
                  {updating ? '...' : t('common.save')}
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
