import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import Modal from '@/components/ui/Modal'
import { Settings2 } from 'lucide-react'

type Props = {
  todaySeconds: number;
  goalMinutes: number;
  onGoalUpdate?: () => void;
}

export default function ReadingGoalCard({ todaySeconds, goalMinutes, onGoalUpdate }: Props) {
  const { t } = useTranslation('common')
  const [showAdjust, setShowAdjust] = useState(false)
  const [newGoal, setNewGoal] = useState(goalMinutes)
  const [updating, setUpdating] = useState(false)

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
      const at = useAuthStore.getState().accessToken || localStorage.getItem('access_token') || ''
      await fetch('/api/v1/home/goals', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${at}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ daily_minutes: parseInt(String(newGoal)) })
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
    <div className="bg-white dark:bg-gray-800 rounded-[20px] p-6 shadow-lg border border-gray-100 dark:border-gray-700 flex flex-col items-center relative">
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
            {todayMinutes} <span className="text-xl font-medium text-secondary-label">min</span>
          </div>
        </div>
      </div>

      <div
        className="flex items-center gap-2 text-system-blue font-medium cursor-pointer hover:opacity-80 transition-opacity"
        onClick={() => { setNewGoal(goalMinutes); setShowAdjust(true) }}
      >
        <span>{t('home.daily_goal')}: {goalMinutes} min</span>
      </div>

      {showAdjust && (
        <Modal>
          <div className="p-4 w-full max-w-sm">
            <h3 className="text-lg font-bold mb-4">{t('home.adjust_daily_goal')}</h3>
            <div className="flex flex-col gap-6 items-center">
              <div className="text-4xl font-bold text-system-blue">
                {newGoal} <span className="text-xl text-secondary-label">min</span>
              </div>
              <input
                type="range"
                min="1"
                max="120"
                value={newGoal}
                onChange={(e) => setNewGoal(parseInt(e.target.value))}
                className="w-full accent-system-blue h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex gap-3 w-full mt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowAdjust(false)}>{t('common.cancel')}</Button>
                <Button className="flex-1" onClick={handleUpdate} disabled={updating}>
                  {updating ? 'Saving...' : t('common.save')}
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
