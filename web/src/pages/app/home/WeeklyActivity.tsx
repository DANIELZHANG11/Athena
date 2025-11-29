type Day = { date: string; minutes: number; status: 'FUTURE' | 'MISSED' | 'REACHED' | 'PARTIAL' }
type Props = { days: Day[]; goalMinutes: number }

export default function WeeklyActivity({ days, goalMinutes }: Props) {
  const weekDays = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] // Should be localized ideally

  return (
    <div className="bg-secondary-background rounded-[20px] p-6 border border-separator shadow-sm h-[140px] flex flex-col justify-center">
      <div className="flex justify-between items-center">
        {days.map((d, idx) => {
          const isFuture = d.status === 'FUTURE'
          const isReached = d.status === 'REACHED'
          const _isMissed = d.status === 'MISSED'
          void _isMissed // Reserved for future MISSED status styling
          const percent = Math.min(100, Math.round((d.minutes / Math.max(1, goalMinutes)) * 100))

          return (
            <div key={idx} className="flex flex-col items-center gap-2">
              <div className="relative w-8 h-8 flex items-center justify-center">
                {/* Background Circle */}
                <div className={`w-full h-full rounded-full border-2 ${isFuture ? 'border-gray-200 dark:border-gray-700' :
                    isReached ? 'bg-system-blue border-system-blue' :
                      'border-gray-300 dark:border-gray-600'
                  }`} />

                {/* Partial Progress (if not reached/future/missed) */}
                {d.status === 'PARTIAL' && (
                  <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 32 32">
                    <circle
                      cx="16" cy="16" r="14"
                      fill="none"
                      stroke="var(--system-blue)"
                      strokeWidth="2"
                      strokeDasharray={`${(percent / 100) * 88} 88`}
                    />
                  </svg>
                )}

                {/* Checkmark for Reached */}
                {isReached && (
                  <svg className="w-4 h-4 text-white absolute" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <span className="text-xs text-secondary-label font-medium">{weekDays[idx]}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
