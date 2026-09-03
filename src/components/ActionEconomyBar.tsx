import { Footprints } from 'lucide-react'
import type { Combatant } from '@/lib/types'
import { cn } from '@/lib/utils'

type Props = {
  combatant: Combatant | undefined
}

export function ActionEconomyBar({ combatant }: Props) {
  if (!combatant) return null

  const speed = Math.max(1, combatant.speedFeet || 30)
  const movementPercent = (combatant.movementRemaining / speed) * 100

  return (
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
  )
}
