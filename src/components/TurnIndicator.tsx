import { useEffect, useState } from 'react'
import { Clock, User, Zap } from 'lucide-react'
import type { Combatant } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'

type Props = {
  current: Combatant | undefined
  myTurn: boolean
  combatantName: string
  setup?: boolean
}

export function TurnIndicator({ current, myTurn, combatantName, setup = false }: Props) {
  const { t } = useT()
  const [pulse, setPulse] = useState(false)

  useEffect(() => {
    if (myTurn) {
      setPulse(true)
      const interval = setInterval(() => {
        setPulse((prev) => !prev)
      }, 2000)
      return () => clearInterval(interval)
    }
  }, [myTurn])

  if (setup) {
    return (
      <div className="rounded-lg border border-gold/40 bg-gold/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-gold" />
          <div className="font-display text-lg tracking-wide text-gold-2">{t('battle.setupInitiative')}</div>
        </div>
        <div className="mt-1 text-sm text-muted">{t('battle.setupInitiativeHint')}</div>
      </div>
    )
  }

  if (myTurn) {
    return (
      <div
        className={cn(
          'rounded-lg border px-4 py-3 transition-all',
          pulse ? 'border-gold bg-gold/15 shadow-[0_0_20px_rgba(245,158,11,0.3)]' : 'border-gold bg-gold/10',
        )}
      >
        <div className="flex items-center gap-2">
          <Zap className={cn('h-5 w-5 text-gold', pulse && 'animate-pulse')} />
          <div className="font-display text-2xl tracking-wide text-gold-2">{t('battle.yourTurn')}</div>
        </div>
        <div className="mt-1 text-sm text-ink">{combatantName}</div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-line bg-panel/50 px-4 py-3">
      <div className="flex items-center gap-2">
        <User className="h-5 w-5 text-muted" />
        <div className="font-display text-lg tracking-wide text-muted">{t('battle.waiting')}</div>
      </div>
      <div className="mt-1 text-sm text-muted">{current ? t('battle.turnOf', { name: current.name }) : t('battle.waitingForTurn')}</div>
    </div>
  )
}
