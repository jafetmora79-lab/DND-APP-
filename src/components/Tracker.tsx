import { useState } from 'react'
import { CONDITIONS, conditionRingColor, type Combatant, type TurnEconomy } from '@/lib/types'
import { cn, hpColor } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { emptyTurnEconomy } from '@/lib/combat'

type Props = {
  combatants: Combatant[]
  current: number
  round: number
  isDm: boolean
  selectedId?: string | null
  economyId?: string | null
  onSelect: (id: string) => void
  onPatch: (id: string, body: Record<string, unknown>) => void
  onNext: () => void
  onSort: () => void
  onReorder: (dir: -1 | 1, id: string) => void
  onDeathSave?: (id: string, d20: number) => void
  onResetDeath?: (id: string) => void
}

const ECON: { key: keyof TurnEconomy; label: string }[] = [
  { key: 'action', label: 'Action' },
  { key: 'bonus', label: 'Bonus' },
  { key: 'reaction', label: 'Reaction' },
  { key: 'movement', label: 'Move' },
]

export function Tracker({
  combatants,
  current,
  round,
  isDm,
  selectedId,
  economyId,
  onSelect,
  onPatch,
  onNext,
  onSort,
  onReorder,
  onDeathSave,
  onResetDeath,
}: Props) {
  const ordered = [...combatants].sort((a, b) => a.turnOrderPosition - b.turnOrderPosition)
  const whose = ordered[current]
  const [deathD20, setDeathD20] = useState('')

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
        <div>
          <div className="font-display text-lg text-gold-2">Round {round}</div>
          <div className="text-sm text-muted">{whose ? `${whose.name}'s turn` : 'No combatants yet'}</div>
        </div>
        {isDm && (
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={onSort}>
              Sort
            </Button>
            <Button size="sm" variant="ember" onClick={onNext}>
              Next turn
            </Button>
          </div>
        )}
      </div>
      <ul className="mt-2 flex-1 space-y-2 overflow-y-auto scroll-thin pr-1">
        {ordered.map((c, i) => {
          const econ = c.turnEconomy ?? emptyTurnEconomy()
          const canEcon = isDm || c.id === economyId
          const dying = c.deathState === 'dying' || c.deathState === 'stable' || c.deathState === 'dead'
          return (
          <li
            key={c.id}
            className={cn(
              'cursor-pointer rounded-md border p-2',
              i === current ? 'border-ember bg-ember/15' : 'border-line bg-panel-2/40',
              selectedId === c.id && 'ring-1 ring-gold',
              c.deathState === 'dead' && 'opacity-70',
            )}
            onClick={() => onSelect(c.id)}
          >
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ background: c.color }} />
              <span className="flex-1 font-medium">{c.name}</span>
              {c.deathState === 'dying' && <span className="text-[10px] uppercase tracking-wide text-blood">Dying</span>}
              {c.deathState === 'stable' && <span className="text-[10px] uppercase tracking-wide text-gold">Stable</span>}
              {c.deathState === 'dead' && <span className="text-[10px] uppercase tracking-wide text-blood">Dead</span>}
              {isDm && (
                <span className="flex gap-1">
                  <button type="button" className="text-xs text-muted" onClick={() => onReorder(-1, c.id)}>
                    ↑
                  </button>
                  <button type="button" className="text-xs text-muted" onClick={() => onReorder(1, c.id)}>
                    ↓
                  </button>
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs">
              {isDm ? (
                <input
                  className="w-12 rounded border border-line bg-bg px-1"
                  type="number"
                  value={c.initiative}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onPatch(c.id, { initiative: Number(e.target.value) })}
                />
              ) : (
                <span className="stat-num text-muted">Init {c.initiative}</span>
              )}
              <span className="text-muted">AC {c.ac}</span>
            </div>
            {c.advantageAgainst?.length > 0 && (
              <div className="mt-1 text-[10px] uppercase tracking-wide text-gold">
                Adv vs {c.advantageAgainst.map((id) => combatants.find((x) => x.id === id)?.name ?? 'foe').join(', ')}
              </div>
            )}
            <div className="mt-1 flex items-center gap-2">
              {isDm ? (
                <>
                  <input
                    className="w-14 rounded border border-line bg-bg px-1 text-sm"
                    type="number"
                    value={c.hpCurrent}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onPatch(c.id, { hpCurrent: Number(e.target.value) })}
                  />
                  <span className="text-muted">/</span>
                  <input
                    className="w-14 rounded border border-line bg-bg px-1 text-sm"
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
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg">
              <div className={cn('h-full', hpColor(c.hpCurrent, c.hpMax))} style={{ width: `${Math.max(0, Math.min(100, (c.hpCurrent / c.hpMax) * 100))}%` }} />
            </div>
            {c.conditions.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {c.conditions.map((cond) => (
                  <span
                    key={cond}
                    className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-bg"
                    style={{ background: conditionRingColor(cond) }}
                  >
                    {cond}
                    {isDm && (
                      <button
                        type="button"
                        className="ml-1"
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
                className="mt-2 w-full rounded border border-line bg-bg px-2 py-1 text-xs"
                defaultValue=""
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const v = e.target.value
                  if (v && !c.conditions.includes(v)) onPatch(c.id, { conditions: [...c.conditions, v] })
                  e.target.value = ''
                }}
              >
                <option value="">Add condition…</option>
                {CONDITIONS.map((cond) => (
                  <option key={cond}>{cond}</option>
                ))}
              </select>
            )}
            <div className="mt-1 text-[10px] uppercase tracking-wide text-muted">
              Move {c.movementRemaining ?? 0} / {c.speedFeet ?? 30} ft
            </div>
            {isDm && selectedId === c.id && (
              <div className="mt-1 flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted"
                  onClick={() => onPatch(c.id, { movementRemaining: (c.movementRemaining ?? 0) + 5 })}
                >
                  +5 ft
                </button>
                <button
                  type="button"
                  className="rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted"
                  onClick={() => onPatch(c.id, { movementRemaining: (c.movementRemaining ?? 0) + 30 })}
                >
                  +30 ft
                </button>
                <button
                  type="button"
                  className="rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted"
                  onClick={() => onPatch(c.id, { movementRemaining: c.speedFeet ?? 30 })}
                >
                  Reset
                </button>
                <input
                  className="h-7 w-14 rounded border border-line bg-bg px-1 text-xs"
                  type="number"
                  min={0}
                  value={c.movementRemaining ?? 0}
                  onChange={(e) => onPatch(c.id, { movementRemaining: Number(e.target.value) || 0 })}
                  aria-label="Movement remaining"
                />
              </div>
            )}
            {canEcon && (
              <div className="mt-2 flex flex-wrap gap-1">
                {ECON.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide',
                      econ[key] ? 'bg-gold text-bg' : 'border border-line text-muted',
                    )}
                    onClick={(e) => {
                      e.stopPropagation()
                      onPatch(c.id, { turnEconomy: { ...econ, [key]: !econ[key] } })
                    }}
                  >
                    {label}
                    {econ[key] ? ' ✓' : ''}
                  </button>
                ))}
              </div>
            )}
            {c.source === 'character' && dying && (
              <div className="mt-2 text-[10px] uppercase tracking-wide text-muted">
                Death saves {c.deathSuccess}/3 ok · {c.deathFail}/3 fail
              </div>
            )}
            {isDm && c.source === 'character' && selectedId === c.id && (
              <div className="mt-2 flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <span className="text-[10px] uppercase tracking-wide text-muted">Saves</span>
                <input
                  className="h-8 w-10 rounded border border-line bg-bg px-1 text-xs"
                  type="number"
                  min={0}
                  max={3}
                  value={c.deathSuccess}
                  onChange={(e) => onPatch(c.id, { deathSuccess: Math.max(0, Math.min(3, Number(e.target.value))) })}
                  aria-label="Death save successes"
                />
                <input
                  className="h-8 w-10 rounded border border-line bg-bg px-1 text-xs"
                  type="number"
                  min={0}
                  max={3}
                  value={c.deathFail}
                  onChange={(e) => onPatch(c.id, { deathFail: Math.max(0, Math.min(3, Number(e.target.value))) })}
                  aria-label="Death save failures"
                />
                <select
                  className="h-8 rounded border border-line bg-bg px-1 text-xs"
                  value={c.deathState}
                  onChange={(e) => onPatch(c.id, { deathState: e.target.value })}
                  aria-label="Death state"
                >
                  <option value="ok">Ok</option>
                  <option value="dying">Dying</option>
                  <option value="stable">Stable</option>
                  <option value="dead">Dead</option>
                </select>
              </div>
            )}
            {c.source === 'character' && c.deathState === 'dying' && onDeathSave && (selectedId === c.id || economyId === c.id) && (
              <div className="mt-2 flex gap-1" onClick={(e) => e.stopPropagation()}>
                <input
                  className="h-8 w-14 rounded border border-line bg-bg px-1 text-xs"
                  inputMode="numeric"
                  placeholder="d20"
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
                  Death save
                </Button>
              </div>
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
                Reset death saves
              </Button>
            )}
          </li>
          )
        })}
      </ul>
    </div>
  )
}
