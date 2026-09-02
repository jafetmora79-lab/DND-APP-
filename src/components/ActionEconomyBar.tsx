import type { ReactNode } from 'react'
import { Swords, Sparkles, Shield, Footprints } from 'lucide-react'
import type { Combatant } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'

type Props = {
  combatant: Combatant | undefined
}

export function ActionEconomyBar({ combatant }: Props) {
  const { t } = useT()
  if (!combatant) return null

  const econ = combatant.turnEconomy
  const speed = Math.max(1, combatant.speedFeet || 30)
  const movementPercent = (combatant.movementRemaining / speed) * 100

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <ActionIcon icon={<Swords className="h-4 w-4" />} label={t('battle.economyAction')} used={Boolean(econ?.action)} />
        <ActionIcon icon={<Sparkles className="h-4 w-4" />} label={t('battle.economyBonus')} used={Boolean(econ?.bonus)} />
        <ActionIcon icon={<Shield className="h-4 w-4" />} label={t('battle.economyReaction')} used={Boolean(econ?.reaction)} />
      </div>
      <div className="flex items-center gap-2 text-xs">
        <Footprints className="h-4 w-4 text-muted" />
        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-bg">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              movementPercent > 50 ? 'bg-moss' : movementPercent > 25 ? 'bg-gold' : 'bg-blood',
            )}
            style={{ width: `${Math.max(0, Math.min(100, movementPercent))}%` }}
          />
        </div>
        <span className="text-muted">{combatant.movementRemaining} ft</span>
      </div>
    </div>
  )
}

function ActionIcon({ icon, label, used }: { icon: ReactNode; label: string; used: boolean }) {
  return (
    <div
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-lg border transition-all',
        used ? 'border-line bg-line/30 opacity-50' : 'border-gold/50 bg-gold/10',
      )}
      title={label}
    >
      <div className={cn(used ? 'text-muted' : 'text-gold')}>{icon}</div>
    </div>
  )
}
