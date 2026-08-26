import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { characterSaveBonus, resolveSavingThrow, saveBonusForCombatant } from '@/lib/combat'
import { ABILITIES, ABILITY_LABELS, type Ability, type Combatant, type Monster, type PlayerCharacter } from '@/lib/types'
import { proficiencyBonus } from '@/lib/utils'

type Props = {
  combatants: Combatant[]
  selectedId: string | null
  characters: PlayerCharacter[]
  monster: Monster | null
  compact?: boolean
}

export function SaveBar({ combatants, selectedId, characters, monster, compact }: Props) {
  const target = combatants.find((c) => c.id === selectedId) ?? combatants[0]
  const [ability, setAbility] = useState<Ability>('dex')
  const [dc, setDc] = useState('13')
  const [d20, setD20] = useState('')
  const [msg, setMsg] = useState('')
  const pc = target?.source === 'character' ? characters.find((c) => c.id === target.sourceId) : undefined
  const modifier = useMemo(() => {
    if (!target) return 0
    if (pc) {
      return characterSaveBonus(pc.sheet.abilities[ability], Boolean(pc.sheet.savingThrowProf[ability]), proficiencyBonus(pc.sheet.level))
    }
    return saveBonusForCombatant(target, ability, monster)
  }, [ability, monster, pc, target])

  if (!target) return null

  function resolve() {
    const roll = Number(d20)
    const dcN = Number(dc)
    try {
      if (!Number.isInteger(dcN) || dcN < 1) {
        setMsg('Enter a DC.')
        return
      }
      const r = resolveSavingThrow({ d20: roll, modifier, dc: dcN })
      setMsg(r.message)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not resolve')
    }
  }

  return (
    <div className={compact ? 'border-t border-line bg-panel px-3 py-2' : 'mt-3 rounded-lg border border-line/70 p-2'}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-muted">Save</span>
        <span className="text-xs text-ink">{target.name}</span>
        <select
          className="h-8 rounded-md border border-line bg-bg px-2 text-xs"
          value={ability}
          onChange={(e) => setAbility(e.target.value as Ability)}
        >
          {ABILITIES.map((ab) => (
            <option key={ab} value={ab}>
              {ABILITY_LABELS[ab]}
            </option>
          ))}
        </select>
        <Input className="h-8 w-16" inputMode="numeric" placeholder="DC" value={dc} onChange={(e) => setDc(e.target.value)} aria-label="Save DC" />
        <Input className="h-8 w-16" inputMode="numeric" placeholder="d20" value={d20} onChange={(e) => setD20(e.target.value)} aria-label="Save d20" />
        <Button size="sm" onClick={resolve}>
          Resolve
        </Button>
        <span className="text-xs text-muted">mod {modifier >= 0 ? `+${modifier}` : modifier}</span>
      </div>
      {msg && <p className="mt-1 text-sm text-gold">{msg}</p>}
    </div>
  )
}
