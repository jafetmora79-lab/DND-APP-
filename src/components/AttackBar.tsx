import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { parseAttackBonus, parseRangeFeet } from '@/lib/combat'
import { useT } from '@/lib/i18n'
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
  const { t } = useT()
  const pending = pendingIndex != null ? attacks[pendingIndex] : undefined
  const named = attacks.map((atk, i) => ({ atk, i })).filter(({ atk }) => atk.name.trim())
  if (named.length === 0) return null
  const twoDice = rollMode !== 'normal'
  const bonusValue = parseAttackBonus(pending?.bonus)
  return (
    <div className="border-t border-line bg-panel px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-muted">{t('attack.label')}</span>
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
            {t('common.cancel')}
          </Button>
        )}
      </div>
      {disabled && disabledReason && <p className="mt-1 text-xs text-blood">{disabledReason}</p>}
      {pending && !disabled && (
        <>
          <div className="mt-2 flex flex-wrap gap-1">
            {(['normal', 'advantage', 'disadvantage'] as const).map((m) => (
              <Button key={m} size="sm" variant={rollMode === m ? 'default' : 'outline'} onClick={() => onRollMode(m)}>
                {m === 'normal' ? t('attack.normal') : m === 'advantage' ? t('attack.advantage') : t('attack.disadvantage')}
              </Button>
            ))}
            {hasAdvantage && (
              <span className="self-center text-xs text-gold">
                {coverBonus ? t('attack.advantageVsTarget') : t('attack.storedAdvantageVsTarget')}
              </span>
            )}
          </div>
          <div className={cn('mt-2 grid gap-2 md:items-end', twoDice ? 'md:grid-cols-[1fr_4.5rem_4.5rem_4.5rem_auto]' : 'md:grid-cols-[1fr_5rem_5rem_auto]')}>
            <p className="text-sm text-muted">
              {pending.name} · {parseRangeFeet(pending.range)} {t('attack.ft')} · {pending.damage || t('attack.damageOnSheet')}
              {targetName != null && targetAc != null
                ? t('attack.arrowToTarget', {
                    target: targetName,
                    ac: targetAc,
                    cover: coverBonus ? t('attack.coverSuffix', { n: coverBonus }) : '',
                  })
                : t('attack.tapCreature')}
            </p>
            <Input inputMode="numeric" placeholder={twoDice ? t('attack.d20a') : t('attack.d20Placeholder')} value={d20} onChange={(e) => onD20(e.target.value)} aria-label={t('attack.d20Aria')} />
            {twoDice && (
              <Input inputMode="numeric" placeholder={t('attack.d20b')} value={d20b} onChange={(e) => onD20b(e.target.value)} aria-label={t('attack.secondD20Aria')} />
            )}
            <Input inputMode="numeric" placeholder={t('attack.damagePlaceholder')} value={damage} onChange={(e) => onDamage(e.target.value)} aria-label={t('attack.damageAria')} />
            <Button disabled={busy || !canResolve} onClick={onResolve}>
              {t('check.resolve')}
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted">
            {twoDice ? t('attack.enterBothD20s') : ''}
            {t('attack.bonusText', { bonus: `${bonusValue >= 0 ? '+' : ''}${bonusValue}` })}
          </p>
        </>
      )}
      {message && <p className="mt-1 text-sm text-gold">{message}</p>}
    </div>
  )
}
