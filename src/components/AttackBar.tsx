import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { parseAttackBonus, parseRangeFeet } from '@/lib/combat'
import type { Attack, RollMode } from '@/lib/types'
import { cn } from '@/lib/utils'

type Props = {
  attacks: Attack[]
  pendingIndex: number | null
  onPick: (attack: Attack, index: number) => void
  onCancel: () => void
  targetName?: string
  targetAc?: number
  coverBonus?: number
  hasAdvantage?: boolean
  disabled?: boolean
  disabledReason?: string
  rollMode: RollMode
  onRollMode: (mode: RollMode) => void
  d20: string
  d20b: string
  damage: string
  onD20: (value: string) => void
  onD20b: (value: string) => void
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
  coverBonus = 0,
  hasAdvantage,
  disabled,
  disabledReason,
  rollMode,
  onRollMode,
  d20,
  d20b,
  damage,
  onD20,
  onD20b,
  onDamage,
  onResolve,
  canResolve,
  busy,
  message,
}: Props) {
  const pending = pendingIndex != null ? attacks[pendingIndex] : undefined
  const named = attacks.map((atk, i) => ({ atk, i })).filter(({ atk }) => atk.name.trim())
  if (named.length === 0) return null
  const twoDice = rollMode !== 'normal'
  return (
    <div className="border-t border-line bg-panel px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-muted">Attack</span>
        {named.map(({ atk, i }) => (
          <Button
            key={`${atk.name}-${i}`}
            size="sm"
            variant={pendingIndex === i ? 'default' : 'outline'}
            disabled={disabled}
            onClick={() => onPick(atk, i)}
          >
            {atk.name} {atk.bonus || ''}
          </Button>
        ))}
        {pending && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {disabled && disabledReason && <p className="mt-1 text-xs text-blood">{disabledReason}</p>}
      {pending && !disabled && (
        <>
          <div className="mt-2 flex flex-wrap gap-1">
            {(['normal', 'advantage', 'disadvantage'] as const).map((m) => (
              <Button key={m} size="sm" variant={rollMode === m ? 'default' : 'outline'} onClick={() => onRollMode(m)}>
                {m === 'normal' ? 'Normal' : m === 'advantage' ? 'Advantage' : 'Disadvantage'}
              </Button>
            ))}
            {hasAdvantage && (
              <span className="self-center text-xs text-gold">
                {coverBonus ? 'Advantage vs this target' : 'Stored advantage vs this target'}
              </span>
            )}
          </div>
          <div className={cn('mt-2 grid gap-2 md:items-end', twoDice ? 'md:grid-cols-[1fr_4.5rem_4.5rem_4.5rem_auto]' : 'md:grid-cols-[1fr_5rem_5rem_auto]')}>
            <p className="text-sm text-muted">
              {pending.name} · {parseRangeFeet(pending.range)} ft · {pending.damage || 'damage on the sheet'}
              {targetName != null && targetAc != null
                ? ` → ${targetName} (AC ${targetAc}${coverBonus ? ` · cover +${coverBonus}` : ''} — must roll higher)`
                : ' → tap a creature with a green ring'}
            </p>
            <Input inputMode="numeric" placeholder={twoDice ? 'd20 a' : 'd20'} value={d20} onChange={(e) => onD20(e.target.value)} aria-label="d20 roll" />
            {twoDice && (
              <Input inputMode="numeric" placeholder="d20 b" value={d20b} onChange={(e) => onD20b(e.target.value)} aria-label="second d20" />
            )}
            <Input inputMode="numeric" placeholder="Dmg" value={damage} onChange={(e) => onDamage(e.target.value)} aria-label="Damage rolled" />
            <Button disabled={busy || !canResolve} onClick={onResolve}>
              Resolve
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted">
            {twoDice ? 'Enter both d20s from the table. Advantage uses the higher; disadvantage the lower. ' : ''}
            Bonus {parseAttackBonus(pending.bonus) >= 0 ? '+' : ''}
            {parseAttackBonus(pending.bonus)} is added to the used die. Total must be higher than AC to hit. A natural 1 on the
            used die misses and the target has advantage against you next turn.
          </p>
        </>
      )}
      {message && <p className="mt-1 text-sm text-gold">{message}</p>}
    </div>
  )
}
