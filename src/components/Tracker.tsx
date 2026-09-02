import { useState } from 'react'
import { CONDITIONS, conditionLabelKey, conditionRingColor, type Combatant, type TurnEconomy } from '@/lib/types'
import { cn, hpColor } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { emptyTurnEconomy } from '@/lib/combat'
import { useT } from '@/lib/i18n'

type Props = {
  combatants: Combatant[]
  current: number
  round: number
  isDm: boolean
  selectedId?: string | null
  economyId?: string | null
  setup?: boolean
  onSelect: (id: string) => void
  onPatch: (id: string, body: Record<string, unknown>) => void
  onNext: () => void
  onSort: () => void
  onSkip?: () => void
  onBeginRound?: () => void
  onRemove?: (id: string) => void
  onReorder: (dir: -1 | 1, id: string) => void
  onDeathSave?: (id: string, d20: number) => void
  onResetDeath?: (id: string) => void
}

const ECON: { key: keyof TurnEconomy; labelKey: string }[] = [
  { key: 'action', labelKey: 'econ.action' },
  { key: 'bonus', labelKey: 'econ.bonus' },
  { key: 'reaction', labelKey: 'econ.reaction' },
  { key: 'movement', labelKey: 'econ.move' },
]

export function Tracker({
  combatants,
  current,
  round,
  isDm,
  selectedId,
  economyId,
  setup,
  onSelect,
  onPatch,
  onNext,
  onSort,
  onSkip,
  onBeginRound,
  onRemove,
  onReorder,
  onDeathSave,
  onResetDeath,
}: Props) {
  const { t } = useT()
  const ordered = [...combatants].sort((a, b) => a.turnOrderPosition - b.turnOrderPosition)
  const whose = ordered[current]
  const [deathD20, setDeathD20] = useState('')

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-panel-2/50 px-3 py-2.5">
        <div className="min-w-0">
          <div className="font-display text-base font-semibold text-gold-2">{setup ? t('init.title') : t('tracker.round', { round })}</div>
          <div className="text-xs text-muted truncate">
            {setup ? t('tracker.setupHint') : whose ? t('tracker.whoseTurn', { name: whose.name }) : t('tracker.noCombatants')}
          </div>
        </div>
        {isDm && (
          <div className="flex flex-wrap justify-end gap-1.5 shrink-0">
            <Button size="sm" variant="outline" onClick={onSort} className="h-8 px-3 text-xs">
              {t('tracker.sort')}
            </Button>
            {setup ? (
              <Button size="sm" variant="ember" onClick={onBeginRound} className="h-8 px-3 text-xs">
                {t('tracker.beginRound1')}
              </Button>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={onSkip ?? onNext} className="h-8 px-3 text-xs">
                  {t('tracker.skip')}
                </Button>
                <Button size="sm" variant="ember" onClick={onNext} className="h-8 px-3 text-xs">
                  {t('tracker.nextTurn')}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      <ul className="mt-2 flex-1 space-y-1.5 overflow-y-auto scroll-thin px-2 pb-2">
        {ordered.map((c, i) => {
          const econ = c.turnEconomy ?? emptyTurnEconomy()
          const canEcon = isDm || c.id === economyId
          const dying = c.deathState === 'dying' || c.deathState === 'stable' || c.deathState === 'dead'
          return (
          <li
            key={c.id}
            className={cn(
              'cursor-pointer rounded-lg border p-2.5 transition-all hover:border-line/60',
              i === current ? 'border-gold bg-gold/10 shadow-sm' : 'border-line bg-panel/50',
              selectedId === c.id && 'ring-2 ring-gold/50',
              c.deathState === 'dead' && 'opacity-60',
            )}
            onClick={() => onSelect(c.id)}
          >
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full shadow-sm" style={{ background: c.color }} />
              <span className="flex-1 font-medium text-sm">{c.name}</span>
              {c.deathState === 'dying' && <span className="text-[10px] uppercase tracking-wide text-blood font-semibold">{t('tracker.dying')}</span>}
              {c.deathState === 'stable' && <span className="text-[10px] uppercase tracking-wide text-gold font-semibold">{t('tracker.stable')}</span>}
              {c.deathState === 'dead' && <span className="text-[10px] uppercase tracking-wide text-blood font-semibold">{t('tracker.dead')}</span>}
              {c.hpCurrent <= 0 && c.source === 'bestiary' && c.deathState !== 'dead' && (
                <span className="text-[10px] uppercase tracking-wide text-muted">{t('tracker.down')}</span>
              )}
              {isDm && (
                <span className="flex gap-0.5">
                  <button type="button" className="text-xs text-muted hover:text-ink px-1" onClick={() => onReorder(-1, c.id)}>
                    ↑
                  </button>
                  <button type="button" className="text-xs text-muted hover:text-ink px-1" onClick={() => onReorder(1, c.id)}>
                    ↓
                  </button>
                </span>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-xs">
              {isDm ? (
                <input
                  className="w-10 rounded border border-line bg-bg px-1.5 py-0.5 text-center text-xs focus:border-gold focus:outline-none"
                  type="number"
                  value={c.initiative}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onPatch(c.id, { initiative: Number(e.target.value) })}
                />
              ) : (
                <span className="stat-num text-muted">{t('tracker.init', { value: c.initiative })}</span>
              )}
              <span className="text-muted">{t('tracker.ac', { value: c.ac })}</span>
            </div>
            {c.advantageAgainst?.length > 0 && (
              <div className="mt-1 text-[10px] uppercase tracking-wide text-gold">
                {t('tracker.advVs', { names: c.advantageAgainst.map((id) => combatants.find((x) => x.id === id)?.name ?? t('tracker.foe')).join(', ') })}
              </div>
            )}
            <div className="mt-2 flex items-center gap-2">
              {isDm ? (
                <>
                  <input
                    className="w-12 rounded border border-line bg-bg px-1.5 py-0.5 text-center text-sm focus:border-gold focus:outline-none"
                    type="number"
                    value={c.hpCurrent}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onPatch(c.id, { hpCurrent: Number(e.target.value) })}
                  />
                  <span className="text-muted text-sm">/</span>
                  <input
                    className="w-12 rounded border border-line bg-bg px-1.5 py-0.5 text-center text-sm focus:border-gold focus:outline-none"
                    type="number"
                    value={c.hpMax}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onPatch(c.id, { hpMax: Number(e.target.value) })}
                  />
                </>
              ) : (
                <span className="stat-num text-sm">
                  {c.hpCurrent}/{c.hpMax}
                  {c.hpTemp ? ` +${c.hpTemp}` : ''}
                </span>
              )}
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-bg">
              <div className={cn('h-full rounded-full transition-all', hpColor(c.hpCurrent, c.hpMax))} style={{ width: `${Math.max(0, Math.min(100, (c.hpCurrent / c.hpMax) * 100))}%` }} />
            </div>
            {c.conditions.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {c.conditions.map((cond) => (
                  <span
                    key={cond}
                    className="rounded-md px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-bg font-medium"
                    style={{ background: conditionRingColor(cond) }}
                  >
                    {t(conditionLabelKey(cond))}
                    {isDm && (
                      <button
                        type="button"
                        className="ml-1 hover:opacity-70"
                        onClick={(e) => {
                          e.stopPropagation()
                          onPatch(c.id, { conditions: c.conditions.filter((x) => x !== cond) })
                        }}
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
            {isDm && selectedId === c.id && (
              <select
                className="mt-2 w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-xs focus:border-gold focus:outline-none"
                defaultValue=""
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const v = e.target.value
                  if (v && !c.conditions.includes(v)) onPatch(c.id, { conditions: [...c.conditions, v] })
                  e.target.value = ''
                }}
              >
                <option value="">{t('tracker.addCondition')}</option>
                {CONDITIONS.map((cond) => (
                  <option key={cond} value={cond}>{t(conditionLabelKey(cond))}</option>
                ))}
              </select>
            )}
            <div className="mt-1.5 text-[10px] uppercase tracking-wide text-muted">
              {t('tracker.move', { remaining: c.movementRemaining ?? 0, speed: c.speedFeet ?? 30 })}
            </div>
            {isDm && selectedId === c.id && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="rounded-md border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted hover:border-gold/50 hover:text-ink"
                  onClick={() => onPatch(c.id, { movementRemaining: (c.movementRemaining ?? 0) + 5 })}
                >
                  {t('tracker.plus5ft')}
                </button>
                <button
                  type="button"
                  className="rounded-md border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted hover:border-gold/50 hover:text-ink"
                  onClick={() => onPatch(c.id, { movementRemaining: (c.movementRemaining ?? 0) + 30 })}
                >
                  {t('tracker.plus30ft')}
                </button>
                <button
                  type="button"
                  className="rounded-md border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted hover:border-gold/50 hover:text-ink"
                  onClick={() => onPatch(c.id, { movementRemaining: c.speedFeet ?? 30 })}
                >
                  {t('tracker.reset')}
                </button>
                <input
                  className="h-7 w-14 rounded-md border border-line bg-bg px-1.5 text-xs focus:border-gold focus:outline-none"
                  type="number"
                  min={0}
                  value={c.movementRemaining ?? 0}
                  onChange={(e) => onPatch(c.id, { movementRemaining: Number(e.target.value) || 0 })}
                  aria-label={t('tracker.movementRemainingAria')}
                />
              </div>
            )}
            {canEcon && (
              <div className="mt-2 flex flex-wrap gap-1">
                {ECON.map(({ key, labelKey }) => (
                  <button
                    key={key}
                    type="button"
                    className={cn(
                      'rounded-md px-1.5 py-0.5 text-[10px] uppercase tracking-wide transition-colors',
                      econ[key] ? 'bg-gold text-bg font-medium' : 'border border-line text-muted hover:border-gold/50 hover:text-ink',
                    )}
                    onClick={(e) => {
                      e.stopPropagation()
                      onPatch(c.id, { turnEconomy: { ...econ, [key]: !econ[key] } })
                    }}
                  >
                    {t(labelKey)}
                    {econ[key] ? ' ✓' : ''}
                  </button>
                ))}
              </div>
            )}
            {c.source === 'character' && dying && (
              <div className="mt-2 text-[10px] uppercase tracking-wide text-muted">
                {t('tracker.deathSaves', { success: c.deathSuccess, fail: c.deathFail })}
              </div>
            )}
            {isDm && c.source === 'character' && selectedId === c.id && (
              <div className="mt-2 flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <span className="text-[10px] uppercase tracking-wide text-muted">{t('tracker.saves')}</span>
                <input
                  className="h-8 w-10 rounded-md border border-line bg-bg px-1.5 text-xs focus:border-gold focus:outline-none"
                  type="number"
                  min={0}
                  max={3}
                  value={c.deathSuccess}
                  onChange={(e) => onPatch(c.id, { deathSuccess: Math.max(0, Math.min(3, Number(e.target.value))) })}
                  aria-label={t('tracker.deathSaveSuccessesAria')}
                />
                <input
                  className="h-8 w-10 rounded-md border border-line bg-bg px-1.5 text-xs focus:border-gold focus:outline-none"
                  type="number"
                  min={0}
                  max={3}
                  value={c.deathFail}
                  onChange={(e) => onPatch(c.id, { deathFail: Math.max(0, Math.min(3, Number(e.target.value))) })}
                  aria-label={t('tracker.deathSaveFailuresAria')}
                />
                <select
                  className="h-8 rounded-md border border-line bg-bg px-1.5 text-xs focus:border-gold focus:outline-none"
                  value={c.deathState}
                  onChange={(e) => onPatch(c.id, { deathState: e.target.value })}
                  aria-label={t('tracker.deathStateAria')}
                >
                  <option value="ok">{t('tracker.stateOk')}</option>
                  <option value="dying">{t('tracker.dying')}</option>
                  <option value="stable">{t('tracker.stable')}</option>
                  <option value="dead">{t('tracker.dead')}</option>
                </select>
              </div>
            )}
            {c.source === 'character' && c.deathState === 'dying' && onDeathSave && (selectedId === c.id || economyId === c.id) && (
              <div className="mt-2 flex gap-1" onClick={(e) => e.stopPropagation()}>
                <input
                  className="h-8 w-14 rounded-md border border-line bg-bg px-1.5 text-xs focus:border-gold focus:outline-none"
                  inputMode="numeric"
                  placeholder={t('attack.d20Placeholder')}
                  value={deathD20}
                  onChange={(e) => setDeathD20(e.target.value)}
                />
                <Button
                  size="sm"
                  onClick={() => {
                    onDeathSave(c.id, Number(deathD20))
                    setDeathD20('')
                  }}
                >
                  {t('tracker.deathSave')}
                </Button>
              </div>
            )}
            {isDm && onRemove && selectedId === c.id && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-2"
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(c.id)
                }}
              >
                {t('tracker.removeFromFight')}
              </Button>
            )}
            {isDm && dying && onResetDeath && selectedId === c.id && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-1"
                onClick={(e) => {
                  e.stopPropagation()
                  onResetDeath(c.id)
                }}
              >
                {t('tracker.resetDeathSaves')}
              </Button>
            )}
          </li>
          )
        })}
      </ul>
    </div>
  )
}
