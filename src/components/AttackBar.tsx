import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { parseAttackBonus, parseRangeFeet } from '@/lib/combat'
import type { Attack } from '@/lib/types'

type Props = {
  attacks: Attack[]
  pendingIndex: number | null
  onPick: (attack: Attack, index: number) => void
  onCancel: () => void
  targetName?: string
  targetAc?: number
  hasAdvantage?: boolean
  d20: string
  damage: string
  onD20: (value: string) => void
  onDamage: (value: string) => void
  onResolve: () => void
  canResolve: boolean
  busy?: boolean
  message?: string
}

export function AttackBar({
  attacks,
  pendingIndex,
  onPick,
  onCancel,
  targetName,
  targetAc,
  hasAdvantage,
  d20,
  damage,
  onD20,
  onDamage,
  onResolve,
  canResolve,
  busy,
  message,
}: Props) {
  const pending = pendingIndex != null ? attacks[pendingIndex] : undefined
  const named = attacks.map((atk, i) => ({ atk, i })).filter(({ atk }) => atk.name.trim())
  if (named.length === 0) return null
  return (
    <div className="border-t border-line bg-panel px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-muted">Attack</span>
        {named.map(({ atk, i }) => (
          <Button key={`${atk.name}-${i}`} size="sm" variant={pendingIndex === i ? 'default' : 'outline'} onClick={() => onPick(atk, i)}>
            {atk.name} {atk.bonus || ''}
          </Button>
        ))}
        {pending && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {pending && (
        <>
          <div className="mt-2 grid gap-2 md:grid-cols-[1fr_5rem_5rem_auto] md:items-end">
            <p className="text-sm text-muted">
              {pending.name} · {parseRangeFeet(pending.range)} ft · {pending.damage || 'damage on the sheet'}
              {targetName != null && targetAc != null
                ? ` → ${targetName} (AC ${targetAc} — must roll higher)`
                : ' → tap a creature with a green ring'}
            </p>
            <Input inputMode="numeric" placeholder="d20" value={d20} onChange={(e) => onD20(e.target.value)} aria-label="d20 roll" />
            <Input inputMode="numeric" placeholder="Dmg" value={damage} onChange={(e) => onDamage(e.target.value)} aria-label="Damage rolled" />
            <Button disabled={busy || !canResolve} onClick={onResolve}>
              Resolve
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted">
            {hasAdvantage ? 'Advantage: roll two d20s at the table and enter the higher. ' : ''}
            Enter the d20 (bonus {parseAttackBonus(pending.bonus) >= 0 ? '+' : ''}
            {parseAttackBonus(pending.bonus)} is added). Total must be higher than AC to hit. A natural 1 misses and the target
            has advantage against you next turn.
          </p>
        </>
      )}
      {message && <p className="mt-1 text-sm text-gold">{message}</p>}
    </div>
  )
}
