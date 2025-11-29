import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import Modal from '@/components/ui/Modal'
import { useAuthStore } from '@/stores/auth'
import { Settings2 } from 'lucide-react'

type Props = {
  count: number;
  target: number;
  covers: string[];
  onGoalUpdate?: () => void;
}

export default function YearlyGoalCard({ count, target, covers, onGoalUpdate }: Props) {
  const { t } = useTranslation('common')
  const [showAdjust, setShowAdjust] = useState(false)
  const [newTarget, setNewTarget] = useState(target)
  const [updating, setUpdating] = useState(false)

  const remain = Math.max(0, target - count)

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
    <div className="relative mt-8 bg-secondary-background border border-separator rounded-[20px] shadow-sm p-6 overflow-hidden">
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
        <Modal>
          <div className="p-4 w-full max-w-sm">
            <h3 className="text-lg font-bold mb-4">{t('home.adjust_yearly_goal')}</h3>
            <div className="flex flex-col gap-6 items-center">
              <div className="text-4xl font-bold text-system-blue">
                {newTarget} <span className="text-xl text-secondary-label">{t('common.books')}</span>
              </div>
              <input
                type="range"
                min="1"
                max="100"
                value={newTarget}
                onChange={(e) => setNewTarget(parseInt(e.target.value))}
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
