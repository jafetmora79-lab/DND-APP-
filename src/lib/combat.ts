import {
  ABILITY_LABELS,
  type Ability,
  type Attack,
  type BattleMap,
  type CharacterSheetData,
  type Combatant,
  type CombatantStats,
  type DeathState,
  type EncounterSnapshot,
  type FogState,
  type MapToken,
  type Monster,
  type RollMode,
  type TemplateMonster,
  type TurnEconomy,
} from './types.ts'
import { hubForPlayer } from './campaign-hub.ts'
import { monsterTokenLook, playerTokenLook } from './token-look.ts'
import {
  abilityMod,
  chebyshevPath,
  FEET_PER_SQUARE,
  pixelToCell,
  spreadCells,
  tokenOccupiedCells,
  terrainAt,
  terrainEnterCostFeet,
  tokenOccupiesBlocked,
} from './utils.ts'
import { applyLightingFog } from './vision.ts'
import { isHiding } from './stealth.ts'

export function parseAttackBonus(bonus: string | undefined) {
  const m = String(bonus ?? '').match(/([+-]?\d+)/)
  return m ? Number(m[1]) : 0
}

export function parseRangeFeet(range: string | undefined) {
  const m = String(range || '5').match(/(\d+)/)
  const n = m ? Number(m[1]) : 5
  return n > 0 ? n : 5
}

export function chebyshevSquares(a: { col: number; row: number }, b: { col: number; row: number }) {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row))
}

/** First number in a speed string ("30 ft.", "25 ft., fly 60 ft."). Default 30. */
export function parseSpeedFeet(raw: unknown) {
  const m = String(raw ?? '').match(/(\d+)/)
  const n = m ? Number(m[1]) : 30
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 30
}

export function movementCostFeet(
  from: { col: number; row: number },
  to: { col: number; row: number },
  blocked?: number[],
  cols?: number,
  rows?: number,
) {
  const path = chebyshevPath(from, to)
  if (!blocked || cols == null || rows == null) return path.length * FEET_PER_SQUARE
  let cost = 0
  for (const cell of path) {
    const step = terrainEnterCostFeet(terrainAt(blocked, cell.col, cell.row, cols, rows))
    if (!Number.isFinite(step)) return Infinity
    cost += step
  }
  return cost
}

export function rollD20() {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    return (buf[0] % 20) + 1
  }
  return Math.floor(Math.random() * 20) + 1
}

export function initiativeBonusFor(
  combatant: Pick<Combatant, 'source' | 'stats'>,
  sheet?: CharacterSheetData | null,
) {
  if (combatant.source === 'character' && sheet) {
    return sheet.initiativeBonus ?? abilityMod(sheet.abilities.dex)
  }
  return abilityMod(Number(combatant.stats?.dex ?? 10))
}

export function spendMovement(remaining: number, cost: number) {
  const left = Math.max(0, Math.round(Number(remaining) || 0))
  const need = Math.max(0, Math.round(Number(cost) || 0))
  if (need === 0) return { ok: true as const, remaining: left }
  if (need > left) {
    return {
      ok: false as const,
      remaining: left,
      error: `Not enough movement (${left} ft left, need ${need} ft).`,
    }
  }
  return { ok: true as const, remaining: left - need }
}

export function clampMovementRemaining(raw: unknown) {
  const n = Math.round(Number(raw))
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

export function minTokenDistanceSquares(
  a: { col: number; row: number; size?: number },
  b: { col: number; row: number; size?: number },
) {
  const as = Math.max(1, a.size ?? 1)
  const bs = Math.max(1, b.size ?? 1)
  let min = Infinity
  for (let r = 0; r < as; r++) {
    for (let c = 0; c < as; c++) {
      for (let r2 = 0; r2 < bs; r2++) {
        for (let c2 = 0; c2 < bs; c2++) {
          min = Math.min(min, chebyshevSquares({ col: a.col + c, row: a.row + r }, { col: b.col + c2, row: b.row + r2 }))
        }
      }
    }
  }
  return min
}

export function tokenCell(token: { x: number; y: number }, gridSize: number) {
  return pixelToCell(token.x, token.y, gridSize)
}

export function isAttackInRange(
  from: { col: number; row: number; size?: number },
  to: { col: number; row: number; size?: number },
  rangeFeet: number,
) {
  return minTokenDistanceSquares(from, to) * FEET_PER_SQUARE <= Math.max(0, rangeFeet)
}

export function attackOutcome(d20: number, bonus: number, ac: number): 'crit' | 'hit' | 'fumble' | 'miss' {
  if (d20 <= 1) return 'fumble'
  if (d20 >= 20) return 'crit'
  // House rule (keep): total must be strictly higher than AC. Equal to AC misses.
  return d20 + bonus > ac ? 'hit' : 'miss'
}

export function emptyTurnEconomy(): TurnEconomy {
  return { action: false, bonus: false, reaction: false, movement: false, interact: false }
}

export function parseTurnEconomy(raw: unknown): TurnEconomy {
  const base = emptyTurnEconomy()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  return {
    action: Boolean(o.action),
    bonus: Boolean(o.bonus),
    reaction: Boolean(o.reaction),
    movement: Boolean(o.movement),
    interact: Boolean(o.interact),
  }
}

export function parseDeathState(raw: unknown): DeathState {
  const v = String(raw ?? 'ok')
  if (v === 'dying' || v === 'stable' || v === 'dead') return v
  return 'ok'
}

export function parseRollMode(raw: unknown): RollMode {
  const v = String(raw ?? 'normal')
  if (v === 'advantage' || v === 'disadvantage') return v
  return 'normal'
}

/**
 * Combines a requested mode with any advantage/disadvantage already in play (stored
 * advantage from hiding/cover, or disadvantage imposed on attackers by a Dodging target).
 * Matching advantage and disadvantage cancel out to a normal roll (5e RAW).
 */
export function effectiveRollMode(requested: RollMode, hadStoredAdvantage: boolean, imposedDisadvantage = false): RollMode {
  const adv = hadStoredAdvantage || requested === 'advantage'
  const dis = imposedDisadvantage || requested === 'disadvantage'
  if (adv && dis) return 'normal'
  if (adv) return 'advantage'
  if (dis) return 'disadvantage'
  return 'normal'
}

export function isDodging(c: Pick<Combatant, 'conditions'>) {
  return c.conditions.includes('Dodging')
}

/**
 * Dash/Disengage/Hide only become Bonus Actions via a class feature (Rogue's
 * Cunning Action; Monk's Step of the Wind covers Dash/Disengage only).
 * Dodge and Help are never Bonus Actions, and Ready always costs the Action.
 */
export function bonusDeclareKindAllowed(kind: string, className: string): boolean {
  const cls = className.toLowerCase()
  const rogue = cls.includes('rogue')
  const monk = cls.includes('monk')
  if (kind === 'dodge' || kind === 'help' || kind === 'ready') return false
  if (kind === 'hide') return rogue
  if (kind === 'dash' || kind === 'disengage') return rogue || monk
  return true
}

export function pickUsedD20(d20: number, d20b: number | undefined, mode: RollMode) {
  if (mode === 'normal' || d20b == null) {
    return { used: d20, a: d20, b: null as number | null }
  }
  const used = mode === 'advantage' ? Math.max(d20, d20b) : Math.min(d20, d20b)
  return { used, a: d20, b: d20b }
}

export function formatDiceUsed(a: number, b: number | null, used: number) {
  if (b == null) return `${used}`
  return `${a} / ${b} → ${used} used`
}

export function canTakeAttacks(c: Pick<Combatant, 'conditions' | 'deathState'>) {
  if (c.deathState === 'dying' || c.deathState === 'stable' || c.deathState === 'dead') return false
  const block = ['Unconscious', 'Paralyzed', 'Stunned', 'Incapacitated', 'Petrified']
  return !c.conditions.some((x) => block.includes(x))
}

export function characterSaveBonus(abilityScore: number, proficient: boolean, proficiencyBonus: number) {
  return abilityMod(abilityScore) + (proficient ? proficiencyBonus : 0)
}

export function monsterSaveBonus(savingThrows: string, ability: Ability, abilityScore: number) {
  const label = ABILITY_LABELS[ability]
  const m = String(savingThrows ?? '').match(new RegExp(`${label}\\s*([+-]\\d+)`, 'i'))
  if (m) return Number(m[1])
  return abilityMod(abilityScore)
}

function abilityScore(raw: unknown, fallback = 10) {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback
}

/** Copy the minimum save math off a bestiary row or Monster (camel or snake case). */
export function combatantStatsFromSheet(abilities: {
  str?: unknown
  dex?: unknown
  con?: unknown
  int?: unknown
  wis?: unknown
  cha?: unknown
} | null | undefined): CombatantStats {
  return combatantStatsFromMonster({ ...abilities, savingThrows: '' })
}

export function combatantStatsFromMonster(src: {
  str?: unknown
  dex?: unknown
  con?: unknown
  int?: unknown
  wis?: unknown
  cha?: unknown
  savingThrows?: unknown
  saving_throws?: unknown
} | null | undefined): CombatantStats {
  const row = src ?? {}
  return {
    str: abilityScore(row.str),
    dex: abilityScore(row.dex),
    con: abilityScore(row.con),
    int: abilityScore(row.int),
    wis: abilityScore(row.wis),
    cha: abilityScore(row.cha),
    savingThrows: String(row.savingThrows ?? row.saving_throws ?? ''),
  }
}

export function parseCombatantStats(raw: unknown): CombatantStats | null {
  if (raw == null || raw === '') return null
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object') return null
  const o = value as Record<string, unknown>
  if (
    o.str == null &&
    o.dex == null &&
    o.con == null &&
    o.int == null &&
    o.wis == null &&
    o.cha == null &&
    o.savingThrows == null &&
    o.saving_throws == null
  ) {
    return null
  }
  return combatantStatsFromMonster(o)
}

export function statsForLiveCombatant(
  row: { stats_json?: unknown; source?: unknown },
  bestiary?: Parameters<typeof combatantStatsFromMonster>[0] | null,
): CombatantStats | null {
  const stored = parseCombatantStats(row.stats_json)
  if (stored) return stored
  if (row.source === 'bestiary' && bestiary) return combatantStatsFromMonster(bestiary)
  return null
}

export function saveBonusForCombatant(
  combatant: Pick<Combatant, 'stats' | 'constitution' | 'source'>,
  ability: Ability,
  monster?: Parameters<typeof combatantStatsFromMonster>[0] | null,
): number {
  const stats =
    combatant.stats ??
    (monster && combatant.source === 'bestiary' ? combatantStatsFromMonster(monster) : null)
  const score = stats ? stats[ability] : ability === 'con' ? Number(combatant.constitution ?? 10) : 10
  return monsterSaveBonus(stats?.savingThrows ?? '', ability, score)
}

export function resolveSavingThrow(opts: { d20: number; modifier: number; dc: number }) {
  const { d20, modifier, dc } = opts
  if (!Number.isInteger(d20) || d20 < 1 || d20 > 20) throw new Error('d20 must be between 1 and 20')
  const total = d20 + modifier
  const success = total >= dc
  return {
    d20,
    modifier,
    total,
    dc,
    success,
    message: `${d20} ${modifier >= 0 ? '+' : '−'}${Math.abs(modifier)} = ${total} vs DC ${dc} — ${success ? 'success' : 'failure'}`,
  }
}

export function afterHpChange(opts: {
  source: 'character' | 'bestiary'
  prevHp: number
  nextHp: number
  conditions: string[]
  deathState: DeathState
  deathSuccess: number
  deathFail: number
  extraDeathFails?: number
}) {
  const conditions = opts.conditions.slice()
  let { deathState, deathSuccess, deathFail } = opts
  const addUnconscious = () => {
    if (!conditions.includes('Unconscious')) conditions.push('Unconscious')
  }
  const dropUnconscious = () => {
    const i = conditions.indexOf('Unconscious')
    if (i >= 0) conditions.splice(i, 1)
  }
  if (opts.nextHp > 0) {
    dropUnconscious()
    if (deathState !== 'ok') {
      deathState = 'ok'
      deathSuccess = 0
      deathFail = 0
    }
    return { conditions, deathState, deathSuccess, deathFail }
  }
  addUnconscious()
  if (opts.source !== 'character' || deathState === 'dead') {
    return { conditions, deathState: deathState === 'dead' ? 'dead' : deathState, deathSuccess, deathFail }
  }
  if (opts.prevHp > 0 && deathState === 'ok') {
    deathState = 'dying'
    deathSuccess = 0
    deathFail = 0
  } else if (deathState === 'dying') {
    deathFail = Math.min(3, deathFail + Math.max(1, opts.extraDeathFails ?? 1))
    if (deathFail >= 3) deathState = 'dead'
  } else if (deathState === 'stable') {
    deathState = 'dying'
    deathSuccess = 0
    deathFail = Math.min(3, Math.max(1, opts.extraDeathFails ?? 1))
  }
  return { conditions, deathState, deathSuccess, deathFail }
}

export function resolveDeathSave(d20: number, current: { deathSuccess: number; deathFail: number; deathState: DeathState }) {
  if (!Number.isInteger(d20) || d20 < 1 || d20 > 20) throw new Error('d20 must be between 1 and 20')
  let { deathSuccess, deathFail, deathState } = current
  if (deathState === 'dead') {
    return { deathSuccess, deathFail, deathState, hpCurrent: 0, message: 'Already dead.', revived: false }
  }
  if (deathState !== 'dying') {
    deathState = 'dying'
  }
  let revived = false
  let hpCurrent = 0
  let message: string
  if (d20 >= 20) {
    hpCurrent = 1
    deathState = 'ok'
    deathSuccess = 0
    deathFail = 0
    revived = true
    message = 'Natural 20 — regain 1 HP and wake.'
  } else if (d20 <= 1) {
    deathFail = Math.min(3, deathFail + 2)
    message = 'Natural 1 — two death-save failures.'
  } else if (d20 >= 10) {
    deathSuccess = Math.min(3, deathSuccess + 1)
    message = `${d20} — death save success (${deathSuccess}/3).`
  } else {
    deathFail = Math.min(3, deathFail + 1)
    message = `${d20} — death save failure (${deathFail}/3).`
  }
  if (!revived && deathFail >= 3) {
    deathState = 'dead'
    message = `${message} Dead.`
  } else if (!revived && deathSuccess >= 3) {
    deathState = 'stable'
    message = `${message} Stabilized.`
  }
  return { deathSuccess, deathFail, deathState, hpCurrent, message, revived }
}

export function grantAdvantage(list: string[] | undefined, vsId: string) {
  const cur = list ?? []
  return cur.includes(vsId) ? cur : [...cur, vsId]
}

export function consumeAdvantage(list: string[] | undefined, vsId: string) {
  return (list ?? []).filter((id) => id !== vsId)
}

const MULTIATTACK_NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
}
const MULTIATTACK_NUMBER_ALT = Object.keys(MULTIATTACK_NUMBER_WORDS).join('|')

/**
 * Best-effort read of how many attacks a Multiattack action grants, from its
 * description text (e.g. "The owlbear makes two attacks..."). Returns 1 when
 * there's no Multiattack entry, or 2 (the most common case) when one exists
 * but the count can't be parsed. Always DM-editable via Monster.attacksPerAction.
 */
export function attacksPerActionFromActions(actions: { name: string; desc: string }[] | undefined): number {
  const multi = (actions ?? []).find((a) => a.name.trim().toLowerCase() === 'multiattack')
  if (!multi) return 1
  const desc = multi.desc.toLowerCase()
  if (/\btwice\b/.test(desc)) return 2
  const times = desc.match(new RegExp(`\\b(${MULTIATTACK_NUMBER_ALT})\\s+times?\\b`))
  if (times) return MULTIATTACK_NUMBER_WORDS[times[1]]
  const attacks = desc.match(new RegExp(`makes?\\s+(?:either\\s+)?(\\d+|${MULTIATTACK_NUMBER_ALT})\\s+[a-z\\s]*?attacks?\\b`))
  if (attacks) {
    const raw = attacks[1]
    const n = Number(raw)
    return MULTIATTACK_NUMBER_WORDS[raw] ?? (Number.isFinite(n) && n > 0 ? n : 2)
  }
  return 2
}

export function attacksFromMonster(monster: { actions?: { name: string; desc: string }[] }): Attack[] {
  const parsed = (monster.actions ?? [])
    .filter((a) => a.name.trim().toLowerCase() !== 'multiattack')
    .map((a) => {
      const bonus = a.desc.match(/([+-]\d+)\s*to hit/i)?.[1] ?? '+0'
      // 5e writes "range 80/320 ft." — take the normal (first) number, not melee default.
      const rangeN = a.desc.match(/(?:reach|range)\s+(\d+)(?:\s*\/\s*\d+)?\s*ft/i)?.[1]
      const dmg = a.desc.match(/Hit:\s*([^.]*)/i)?.[1]?.trim() ?? ''
      return { name: a.name, bonus, damage: dmg, range: rangeN ? `${rangeN} ft.` : '5 ft.' } satisfies Attack
    })
    .filter((a) => a.name.trim())
  return parsed.length ? parsed : [{ name: 'Strike', bonus: '+0', damage: '', range: '5 ft.' }]
}

function tokenBelongsToViewer(
  token: Pick<MapToken, 'refId'> & { refType?: MapToken['refType'] },
  opts?: { viewerCharacterId?: string | null; combatants?: Combatant[] },
) {
  const viewer = opts?.viewerCharacterId
  if (!viewer) return false
  if (token.refType === 'character' && token.refId === viewer) return true
  const owner = opts?.combatants?.find((c) => c.id === token.refId)
  return Boolean(owner && owner.source === 'character' && owner.sourceId === viewer)
}

/** Player map: hide tokens the DM marked invisible, that sit in unrevealed fog, or that are Hidden from this viewer. Never hide the viewer's own token. */
export function tokenHiddenFromPlayers(
  token: Pick<MapToken, 'x' | 'y' | 'visibleToPlayers' | 'refId'> & { refType?: MapToken['refType']; sizeSquares?: number },
  fog: FogState | null | undefined,
  gridSize: number,
  isDm: boolean,
  opts?: { viewerCharacterId?: string | null; combatants?: Combatant[] },
) {
  if (isDm) return false
  if (tokenBelongsToViewer(token, opts)) return false
  if (!token.visibleToPlayers) return true
  const owner = opts?.combatants?.find((c) => c.id === token.refId)
  if (owner && isHiding(owner)) return true
  if (!fog?.enabled) return false
  const cols = fog.cols
  const rows = fog.rows
  const cells = tokenOccupiedCells(token, gridSize, cols, rows)
  if (cells.length === 0) return true
  return cells.every((cell) => !fog.revealed[cell.row * cols + cell.col])
}

/** Same payload GET /live already sent to players — also used for WebSocket pushes. */
export function snapshotForPlayer(snap: EncounterSnapshot, characterId?: string | null): EncounterSnapshot {
  const gridSize = snap.map?.gridSize ?? 70
  const fog = applyLightingFog(snap, characterId) ?? snap.instance?.fogState
  const tokens = snap.tokens.filter((t) =>
    !tokenHiddenFromPlayers(t, fog, gridSize, false, { viewerCharacterId: characterId, combatants: snap.combatants }),
  )
  const visibleMonsterIds = new Set<string>()
  for (const t of tokens) {
    const c = snap.combatants.find((row) => row.id === t.refId)
    if (c?.source === 'bestiary' && c.sourceId) visibleMonsterIds.add(c.sourceId)
  }
  return {
    ...snap,
    campaign: snap.campaign ? { ...snap.campaign, hub: hubForPlayer(snap.campaign.hub) } : snap.campaign,
    instance: snap.instance ? { ...snap.instance, fogState: fog ?? snap.instance.fogState } : null,
    characters: snap.characters.map((c) => (c.id === characterId ? c : { ...c, personalCode: '••••••••' })),
    tokens,
    monsters: (snap.monsters ?? []).filter((m) => visibleMonsterIds.has(m.id)),
  }
}

export function hasHiddenAdvantage(attacker: Pick<Combatant, 'conditions' | 'advantageAgainst'>, targetId: string) {
  return Boolean(attacker.advantageAgainst?.includes(targetId) || isHiding(attacker))
}

export function monsterForCombatant(
  combatant: Pick<Combatant, 'source' | 'sourceId'> | null | undefined,
  monsters: Monster[] | undefined,
) {
  if (!combatant || combatant.source !== 'bestiary') return null
  return monsters?.find((m) => m.id === combatant.sourceId) ?? null
}

export function applyDamage(hpCurrent: number, hpTemp: number, damage: number) {
  let temp = Math.max(0, hpTemp)
  let dmg = Math.max(0, Math.floor(damage))
  const fromTemp = Math.min(temp, dmg)
  temp -= fromTemp
  dmg -= fromTemp
  return { hpCurrent: Math.max(0, hpCurrent - dmg), hpTemp: temp }
}

export function specCopyCell(spec: TemplateMonster, copyIndex: number, placed: number) {
  const p = spec.positions?.[copyIndex]
  if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return { col: p.x, row: p.y }
  const hasStart = Number.isFinite(spec.startX) && Number.isFinite(spec.startY)
  const baseCol = hasStart ? Number(spec.startX) : 2 + (placed % 8)
  const baseRow = hasStart ? Number(spec.startY) : 2 + Math.floor(placed / 8)
  return { col: baseCol + (copyIndex % 4), row: baseRow + Math.floor(copyIndex / 4) }
}

export function monsterCopyCells(
  spec: TemplateMonster,
  map: Pick<BattleMap, 'gridCols' | 'gridRows' | 'blocked'>,
  occupied: Set<string>,
) {
  const qty = Math.max(1, Math.round(Number(spec.quantity)) || 1)
  const out: { col: number; row: number }[] = []
  for (let i = 0; i < qty; i++) {
    const stored = spec.positions?.[i]
    let cell =
      stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)
        ? { col: Number(stored.x), row: Number(stored.y) }
        : i === 0 && Number.isFinite(spec.startX) && Number.isFinite(spec.startY)
          ? { col: Number(spec.startX), row: Number(spec.startY) }
          : null
    if (!cell || occupied.has(`${cell.col},${cell.row}`) || tokenOccupiesBlocked(map.blocked, cell.col, cell.row, map.gridCols, map.gridRows)) {
      const origin = cell ?? { col: Number(spec.startX) || 2, row: Number(spec.startY) || 2 }
      cell = spreadCells(origin, 1, map.gridCols, map.gridRows, map.blocked, occupied)[0]
    }
    const placed = cell
    occupied.add(`${placed.col},${placed.row}`)
    out.push(placed)
  }
  return out
}

export function decorateTokens(tokens: MapToken[], combatants: Combatant[]): MapToken[] {
  return tokens.map((t) => {
    const c = combatants.find((x) => x.id === t.refId)
    if (!c) return t
    const look = c.source === 'character' ? playerTokenLook(c.color) : monsterTokenLook(c.name)
    return {
      ...t,
      label: c.name || t.label,
      color: look.from,
      color2: look.to,
      hpCurrent: c.hpCurrent,
      hpMax: c.hpMax,
      hpTemp: c.hpTemp,
      ac: c.ac,
      conditions: c.conditions,
      statusLabel:
        c.deathState === 'dead'
          ? 'Dead'
          : c.deathState === 'dying'
            ? 'Dying'
            : c.deathState === 'stable'
              ? 'Stable'
              : c.conditions.includes('Unconscious')
                ? 'Unconscious'
                : undefined,
    }
  })
}

export function inRangeCombatantIds(
  map: BattleMap,
  tokens: MapToken[],
  combatants: Combatant[],
  attackerCombatantId: string,
  attack: Attack,
) {
  const fromTok = tokens.find((t) => t.refId === attackerCombatantId)
  if (!fromTok) return []
  const from = { ...tokenCell(fromTok, map.gridSize), size: fromTok.sizeSquares }
  const range = parseRangeFeet(attack.range)
  return combatants
    .filter((c) => c.id !== attackerCombatantId)
    .filter((c) => {
      const tok = tokens.find((t) => t.refId === c.id)
      if (!tok) return false
      return isAttackInRange(from, { ...tokenCell(tok, map.gridSize), size: tok.sizeSquares }, range)
    })
    .map((c) => c.id)
}

export type PlayerAttackResult = {
  hit: boolean
  crit: boolean
  fumble: boolean
  hadAdvantage: boolean
  rollMode: RollMode
  d20: number
  d20b: number | null
  total: number
  ac: number
  damage: number
  hpCurrent: number
  hpTemp: number
  targetName: string
  message: string
}
