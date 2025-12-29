/**
 * 每日阅读目标卡片
 *
 * 说明：
 * - 展示今日阅读分钟与目标进度环
 * - 支持打开模态使用轮盘选择器调整目标
 * - 通过回调 onGoalUpdate 更新目标
 */
import { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import Modal from '@/components/ui/Modal'
import { Settings2, ChevronUp, ChevronDown } from 'lucide-react'

type Props = {
  todaySeconds: number;
  goalMinutes: number;
  onGoalUpdate: (minutes: number) => Promise<void> | void;
}

// 轮盘式数字选择器组件 - 稳定版本，支持触摸滑动
function WheelPicker({
  value,
  onChange,
  min = 1,
  max = 1440,
  step = 5,
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

export default function ReadingGoalCard({ todaySeconds, goalMinutes, onGoalUpdate }: Props) {
  const { t } = useTranslation('common')
  const [showAdjust, setShowAdjust] = useState(false)
  const [newGoal, setNewGoal] = useState(goalMinutes)
  const [updating, setUpdating] = useState(false)

  // 当弹窗打开时，同步当前目标值
  useEffect(() => {
    if (showAdjust) {
      setNewGoal(goalMinutes)
    }
  }, [showAdjust, goalMinutes])

  const todayMinutes = Math.floor(todaySeconds / 60)
  const percent = useMemo(() => Math.max(0, Math.min(100, Math.round((todayMinutes / Math.max(1, goalMinutes)) * 100))), [todayMinutes, goalMinutes])

  // Apple Books style: "12 min" - reserved for future UI display
  const _timeDisplay = `${todayMinutes} ${t('common.min')}`
  void _timeDisplay

  const w = 280
  const h = 280
  const cx = w / 2
  const cy = h / 2
  const r = 100
  const strokeWidth = 24

  // Background circle
  const bgCircle = (
    <circle
      cx={cx} cy={cy} r={r}
      fill="none"
      stroke="var(--secondary-background)"
      strokeWidth={strokeWidth}
      className="opacity-20 dark:opacity-10"
    />
  )

  // Progress arc
  const circumference = 2 * Math.PI * r
  const offset = circumference - (percent / 100) * circumference

  const progCircle = (
    <circle
      cx={cx} cy={cy} r={r}
      fill="none"
      stroke="var(--system-blue)"
      strokeWidth={strokeWidth}
      strokeDasharray={circumference}
      strokeDashoffset={offset}
      strokeLinecap="round"
      transform={`rotate(-90 ${cx} ${cy})`}
      className="transition-all duration-1000 ease-out"
    />
  )

  const handleUpdate = async () => {
    setUpdating(true)
    try {
      await onGoalUpdate(newGoal)
      setShowAdjust(false)
    } catch (e) {
      console.error(e)
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-[20px] p-6 shadow-lg border border-gray-100 dark:border-gray-700 flex flex-col items-center relative transition-transform duration-fast hover:scale-[1.02]">
      <div className="absolute top-4 right-4">
        <Button variant="ghost" size="icon" onClick={() => { setNewGoal(goalMinutes); setShowAdjust(true) }}>
          <Settings2 className="w-5 h-5 text-secondary-label" />
        </Button>
      </div>

      <div className="relative mb-4">
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
          {bgCircle}
          {progCircle}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-secondary-label text-sm font-medium uppercase tracking-wide mb-1">{t('home.today_reading')}</div>
          <div className="text-4xl font-bold text-label mb-1" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {todayMinutes} <span className="text-xl font-medium text-secondary-label">{t('common.min')}</span>
          </div>
        </div>
      </div>

      <div
        className="flex items-center gap-2 text-system-blue font-medium cursor-pointer hover:opacity-80 transition-opacity"
        onClick={() => { setNewGoal(goalMinutes); setShowAdjust(true) }}
      >
        <span>{t('home.daily_goal')}: {goalMinutes} {t('common.min')}</span>
      </div>

      {showAdjust && (
        <Modal className="flex flex-col items-center">
          <div className="w-full max-w-[280px] md:max-w-sm">
            <h3 className="text-base md:text-lg font-bold mb-4 md:mb-6 text-center">{t('home.adjust_daily_goal')}</h3>

            <div className="flex flex-col items-center gap-3 md:gap-4">
              {/* 轮盘选择器 */}
              <WheelPicker
                value={newGoal}
                onChange={setNewGoal}
                min={1}
                max={1440}
                step={5}
              />

              <div className="text-base md:text-lg text-secondary-label">
                {t('common.min')}
              </div>

              {/* 快捷预设按钮 */}
              <div className="flex flex-wrap gap-1.5 md:gap-2 justify-center mt-1 md:mt-2">
                {[15, 30, 60, 90, 120].map((mins) => (
                  <button
                    key={mins}
                    onClick={() => setNewGoal(mins)}
                    className={`px-3 py-1.5 md:px-4 md:py-2 rounded-full text-xs md:text-sm font-medium transition-colors ${newGoal === mins
                      ? 'bg-system-blue text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-label hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                  >
                    {mins}
                  </button>
                ))}
              </div>

              <div className="flex gap-2 md:gap-3 w-full mt-3 md:mt-4">
                <Button variant="outline" className="flex-1 text-sm" onClick={() => setShowAdjust(false)}>
                  {t('common.cancel')}
                </Button>
                <Button className="flex-1 text-sm" onClick={handleUpdate} disabled={updating}>
                  {updating ? t('common.saving') : t('common.save')}
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
