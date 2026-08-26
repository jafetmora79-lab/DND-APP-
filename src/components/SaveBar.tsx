import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { characterSaveBonus, saveBonusForCombatant } from '@/lib/combat'
import { resolveCheck, skillBonusForCombatant, skillByKey } from '@/lib/checks'
import { hideDcFor, resolveHideAttempt, sheetForHide, withHiding, withoutHiding } from '@/lib/stealth'
import { coverBonusAlongLine } from '@/lib/vision'
import {
  ABILITIES,
  ABILITY_LABELS,
  SKILLS,
  type Ability,
  type BattleMap,
  type Combatant,
  type MapToken,
  type Monster,
  type PlayerCharacter,
} from '@/lib/types'
import { pixelToCell, proficiencyBonus } from '@/lib/utils'

type Kind = 'save' | 'skill'

type Props = {
  combatants: Combatant[]
  selectedId: string | null
  characters: PlayerCharacter[]
  monster: Monster | null
  compact?: boolean
  instanceId?: string
  map?: BattleMap | null
  tokens?: MapToken[]
  monsters?: Monster[]
  originId?: string | null
  onSettled?: () => void
}

export function CheckBar({
  combatants,
  selectedId,
  characters,
  monster,
  compact,
  instanceId,
  map,
  tokens = [],
  monsters = [],
  originId,
  onSettled,
}: Props) {
  const target = combatants.find((c) => c.id === selectedId) ?? combatants[0]
  const [kind, setKind] = useState<Kind>('save')
  const [ability, setAbility] = useState<Ability>('dex')
  const [skillKey, setSkillKey] = useState('stealth')
  const [dc, setDc] = useState('13')
  const [d20, setD20] = useState('')
  const [asHide, setAsHide] = useState(true)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const pc = target?.source === 'character' ? characters.find((c) => c.id === target.sourceId) : undefined
  const hideDc = target ? hideDcFor(target, combatants, characters, monsters) : 13
  const skill = skillByKey(skillKey)
  const isHide = kind === 'skill' && skillKey === 'stealth' && asHide

  const cover =
    kind === 'save' && ability === 'dex' && map && target
      ? dexCover(map, tokens, target.id, originId ?? null)
      : 0

  const modifier = useMemo(() => {
    if (!target) return 0
    if (kind === 'skill') {
      return skillBonusForCombatant(target, skillKey, pc?.sheet, monster)
    }
    let n = pc
      ? characterSaveBonus(pc.sheet.abilities[ability], Boolean(pc.sheet.savingThrowProf[ability]), proficiencyBonus(pc.sheet.level))
      : saveBonusForCombatant(target, ability, monster)
    if (ability === 'dex') n += cover
    return n
  }, [ability, cover, kind, monster, pc, skillKey, target])

  if (!target) return null

  function resolve() {
    const roll = Number(d20)
    const dcN = isHide ? hideDc : Number(dc)
    try {
      if (!isHide && (!Number.isInteger(dcN) || dcN < 1)) {
        setMsg('Enter a DC.')
        return
      }
      if (isHide) {
        if (!map) {
          setMsg('Need the map to hide.')
          return
        }
        const result = resolveHideAttempt({
          hider: target,
          combatants,
          tokens,
          map,
          characters,
          monsters,
          d20: roll,
          sheet: sheetForHide(target, characters),
          monster,
        })
        if (!result.ok) {
          setMsg(result.message)
          return
        }
        setBusy(true)
        const apply = instanceId
          ? api.applyHide(instanceId, { combatantId: target.id, success: result.success, text: result.message })
          : api.patchCombatant(target.id, {
              conditions: result.success ? withHiding(target.conditions) : withoutHiding(target.conditions),
            })
        void apply
          .then(() => {
            setMsg(result.message)
            onSettled?.()
          })
          .catch((e: Error) => setMsg(e.message))
          .finally(() => setBusy(false))
        return
      }
      const label = kind === 'skill' ? skill?.name ?? 'Check' : `${ABILITY_LABELS[ability]} save`
      const r = resolveCheck({ d20: roll, modifier, dc: dcN, label: `${target.name} ${label}` })
      setMsg(cover && ability === 'dex' ? `${r.message} (cover +${cover})` : r.message)
      if (instanceId) void api.logActivity(instanceId, r.message).catch(() => undefined)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not resolve')
    }
  }

  return (
    <div className={compact ? 'border-t border-line bg-panel px-3 py-2' : 'mt-3 rounded-lg border border-line/70 p-2'}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-muted">Check</span>
        <span className="text-xs text-ink">{target.name}</span>
        <select
          className="h-8 rounded-md border border-line bg-bg px-2 text-xs"
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
          aria-label="Check kind"
        >
          <option value="save">Save</option>
          <option value="skill">Skill</option>
        </select>
        {kind === 'save' ? (
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
        ) : (
          <select
            className="h-8 rounded-md border border-line bg-bg px-2 text-xs"
            value={skillKey}
            onChange={(e) => setSkillKey(e.target.value)}
          >
            {SKILLS.map((sk) => (
              <option key={sk.key} value={sk.key}>
                {sk.name}
              </option>
            ))}
          </select>
        )}
        {isHide ? (
          <span className="text-xs text-muted">DC {hideDc} (highest passive Perception)</span>
        ) : (
          <Input className="h-8 w-16" inputMode="numeric" placeholder="DC" value={dc} onChange={(e) => setDc(e.target.value)} aria-label="Check DC" />
        )}
        <Input className="h-8 w-16" inputMode="numeric" placeholder="d20" value={d20} onChange={(e) => setD20(e.target.value)} aria-label="Check d20" />
        <Button size="sm" disabled={busy} onClick={resolve}>
          Resolve
        </Button>
        <span className="text-xs text-muted">
          mod {modifier >= 0 ? `+${modifier}` : modifier}
          {cover && ability === 'dex' && kind === 'save' ? ` · cover +${cover}` : ''}
        </span>
      </div>
      {kind === 'skill' && skillKey === 'stealth' && (
        <label className="mt-1 flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={asHide} onChange={(e) => setAsHide(e.target.checked)} />
          Apply as Hide (needs no enemy line of sight)
        </label>
      )}
      {msg && <p className="mt-1 text-sm text-gold">{msg}</p>}
    </div>
  )
}

/** @deprecated Use CheckBar. Kept so older imports still typecheck. */
export const SaveBar = CheckBar

function dexCover(map: BattleMap, tokens: MapToken[], targetId: string, originId: string | null) {
  const toTok = tokens.find((t) => t.refId === targetId)
  if (!toTok) return 0
  const to = pixelToCell(toTok.x, toTok.y, map.gridSize)
  if (!originId) {
    return coverBonusAlongLine(map.blocked, map.gridCols, map.gridRows, to, to)
  }
  const fromTok = tokens.find((t) => t.refId === originId)
  if (!fromTok) return 0
  const from = pixelToCell(fromTok.x, fromTok.y, map.gridSize)
  return coverBonusAlongLine(map.blocked, map.gridCols, map.gridRows, from, to)
}
