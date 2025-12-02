import { useTranslation } from 'react-i18next'
import { useMemo } from 'react'

type Day = { 
  date: string
  minutes: number
  status: 'FUTURE' | 'MISSED' | 'REACHED' | 'PARTIAL' 
}

type Props = { 
  days: Day[]
  goalMinutes: number 
}

export default function WeeklyActivity({ days, goalMinutes }: Props) {
  const { t, i18n } = useTranslation('common')
  const isChinese = i18n.language?.startsWith('zh')
  
  // 周一到周日 - 中文显示完整，英文显示首字母
  const weekDaysEn = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  const weekDaysZh = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

  // 获取今天的日期字符串 (YYYY-MM-DD) - 使用用户本地时区
  const todayStr = useMemo(() => {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }, [])

  return (
    <div className="bg-white dark:bg-gray-800 rounded-[20px] p-6 border border-gray-100 dark:border-gray-700 shadow-lg flex flex-col transition-transform duration-200 hover:scale-[1.02]">
      {/* 标题 */}
      <div className="text-secondary-label text-sm font-medium uppercase tracking-wide mb-4">
        {t('home.weekly_activity', 'Weekly Activity')}
      </div>
      
      <div className="flex justify-between items-center">
        {days.map((d, idx) => {
          // 判断是否是今天：通过比较日期字符串
          const isToday = d.date === todayStr
          
          // 判断是否是未来：通过比较日期字符串 (日期大于今天)
          const isFuture = d.date > todayStr
          
          // 过去的日期
          const isPast = !isToday && !isFuture
          const hasReading = d.minutes > 0
          
          // 计算进度百分比
          const percent = Math.min(100, Math.round((d.minutes / Math.max(1, goalMinutes)) * 100))
          
          // 圆环参数 - 中文需要更大的圆来容纳文字
          const size = isChinese ? 44 : 40
          const strokeWidth = 3
          const radius = (size - strokeWidth) / 2
          const circumference = 2 * Math.PI * radius
          const offset = circumference - (percent / 100) * circumference
          
          // 获取当天显示的文字
          const dayLabel = isChinese ? weekDaysZh[idx] : weekDaysEn[idx]
          // 中文字体更小以适配圆内
          const textSizeClass = isChinese ? 'text-[10px]' : 'text-xs'

          return (
            <div key={idx} className="flex flex-col items-center">
              <div className="relative" style={{ width: size, height: size }}>
                {/* 未来日期：灰色外圈 + 白色内圈 + 灰色文字 */}
                {isFuture && (
                  <>
                    <div 
                      className="absolute inset-0 rounded-full border-2 border-gray-200 dark:border-gray-600"
                    />
                    <div 
                      className="absolute rounded-full bg-white dark:bg-gray-800"
                      style={{ 
                        top: strokeWidth, 
                        left: strokeWidth, 
                        right: strokeWidth, 
                        bottom: strokeWidth 
                      }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className={`${textSizeClass} font-medium text-gray-400 dark:text-gray-500`}>
                        {dayLabel}
                      </span>
                    </div>
                  </>
                )}

                {/* 今天：白色内圈 + 黑色文字 + 蓝色进度环 */}
                {isToday && (
                  <>
                    {/* 背景灰色圆环 */}
                    <svg 
                      className="absolute inset-0" 
                      width={size} 
                      height={size} 
                      viewBox={`0 0 ${size} ${size}`}
                    >
                      <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        fill="none"
                        stroke="var(--color-gray-200, #E5E7EB)"
                        strokeWidth={strokeWidth}
                        className="dark:stroke-gray-600"
                      />
                      {/* 蓝色进度环 */}
                      <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        fill="none"
                        stroke="var(--system-blue)"
                        strokeWidth={strokeWidth}
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        strokeLinecap="round"
                        transform={`rotate(-90 ${size / 2} ${size / 2})`}
                        className="transition-all duration-500"
                      />
                    </svg>
                    {/* 白色内圈 */}
                    <div 
                      className="absolute rounded-full bg-white dark:bg-gray-800"
                      style={{ 
                        top: strokeWidth + 1, 
                        left: strokeWidth + 1, 
                        right: strokeWidth + 1, 
                        bottom: strokeWidth + 1 
                      }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className={`${textSizeClass} font-bold text-label`}>
                        {dayLabel}
                      </span>
                    </div>
                  </>
                )}

                {/* 过去日期：根据是否有阅读记录显示不同样式 */}
                {isPast && (
                  <>
                    {hasReading ? (
                      // 有阅读记录：显示蓝色进度环
                      <>
                        <svg 
                          className="absolute inset-0" 
                          width={size} 
                          height={size} 
                          viewBox={`0 0 ${size} ${size}`}
                        >
                          <circle
                            cx={size / 2}
                            cy={size / 2}
                            r={radius}
                            fill="none"
                            stroke="var(--color-gray-200, #E5E7EB)"
                            strokeWidth={strokeWidth}
                            className="dark:stroke-gray-600"
                          />
                          <circle
                            cx={size / 2}
                            cy={size / 2}
                            r={radius}
                            fill="none"
                            stroke="var(--system-blue)"
                            strokeWidth={strokeWidth}
                            strokeDasharray={circumference}
                            strokeDashoffset={offset}
                            strokeLinecap="round"
                            transform={`rotate(-90 ${size / 2} ${size / 2})`}
                          />
                        </svg>
                        <div 
                          className="absolute rounded-full bg-white dark:bg-gray-800"
                          style={{ 
                            top: strokeWidth + 1, 
                            left: strokeWidth + 1, 
                            right: strokeWidth + 1, 
                            bottom: strokeWidth + 1 
                          }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className={`${textSizeClass} font-medium text-label`}>
                            {dayLabel}
                          </span>
                        </div>
                      </>
                    ) : (
                      // 没有阅读记录：灰色外圈 + 灰色内圈 + 白色文字
                      <>
                        <div 
                          className="absolute inset-0 rounded-full bg-gray-300 dark:bg-gray-600"
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className={`${textSizeClass} font-medium text-white`}>
                            {dayLabel}
                          </span>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
