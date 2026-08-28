import { Swords, Sparkles, Shield, Footprints } from 'lucide-react'
import type { Combatant } from '@/lib/types'
import { cn } from '@/lib/utils'

type Props = {
  combatant: Combatant | undefined
}

export function ActionEconomyBar({ combatant }: Props) {
  if (!combatant) return null

  const econ = combatant.turnEconomy
  const movementPercent = (combatant.movementRemaining / 30) * 100

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <ActionIcon
          icon={<Swords className="h-4 w-4" />}
          label="Action"
          used={Boolean(econ?.action)}
        />
        <ActionIcon
          icon={<Sparkles className="h-4 w-4" />}
          label="Bonus"
          used={Boolean(econ?.bonus)}
        />
        <ActionIcon
          icon={<Shield className="h-4 w-4" />}
          label="Reaction"
          used={Boolean(econ?.reaction)}
        />
      </div>
      <div className="flex items-center gap-2 text-xs">
        <Footprints className="h-4 w-4 text-muted" />
        <div className="w-16 h-1.5 bg-bg rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              movementPercent > 50 ? 'bg-moss' : movementPercent > 25 ? 'bg-gold' : 'bg-blood'
            )}
            style={{ width: `${movementPercent}%` }}
          />
        </div>
        <span className="text-muted">{combatant.movementRemaining} ft</span>
      </div>
    </div>
  )
}

function ActionIcon({ icon, label, used }: { icon: React.ReactNode; label: string; used: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center justify-center w-8 h-8 rounded-lg border transition-all',
        used ? 'border-line bg-line/30 opacity-50' : 'border-gold/50 bg-gold/10'
      )}
      title={label}
    >
      <div className={cn(used ? 'text-muted' : 'text-gold')}>{icon}</div>
    </div>
  )
}
