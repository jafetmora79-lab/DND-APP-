import { CONDITIONS, conditionRingColor, type Combatant } from '@/lib/types'
import { cn, hpColor } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type Props = {
  combatants: Combatant[]
  current: number
  round: number
  isDm: boolean
  selectedId?: string | null
  onSelect: (id: string) => void
  onPatch: (id: string, body: Record<string, unknown>) => void
  onNext: () => void
  onSort: () => void
  onReorder: (dir: -1 | 1, id: string) => void
}

export function Tracker({ combatants, current, round, isDm, selectedId, onSelect, onPatch, onNext, onSort, onReorder }: Props) {
  const ordered = [...combatants].sort((a, b) => a.turnOrderPosition - b.turnOrderPosition)
  const whose = ordered[current]

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
        {ordered.map((c, i) => (
          <li
            key={c.id}
            className={cn(
              'cursor-pointer rounded-md border p-2',
              i === current ? 'border-ember bg-ember/15' : 'border-line bg-panel-2/40',
              selectedId === c.id && 'ring-1 ring-gold',
            )}
            onClick={() => onSelect(c.id)}
          >
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ background: c.color }} />
              <span className="flex-1 font-medium">{c.name}</span>
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
          </li>
        ))}
      </ul>
    </div>
  )
}
