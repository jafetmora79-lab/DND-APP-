export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const
export type Ability = (typeof ABILITIES)[number]

export const ABILITY_LABELS: Record<Ability, string> = {
  str: 'STR',
  dex: 'DEX',
  con: 'CON',
  int: 'INT',
  wis: 'WIS',
  cha: 'CHA',
}

export const SKILLS: { key: string; name: string; ability: Ability }[] = [
  { key: 'acrobatics', name: 'Acrobatics', ability: 'dex' },
  { key: 'animalHandling', name: 'Animal Handling', ability: 'wis' },
  { key: 'arcana', name: 'Arcana', ability: 'int' },
  { key: 'athletics', name: 'Athletics', ability: 'str' },
  { key: 'deception', name: 'Deception', ability: 'cha' },
  { key: 'history', name: 'History', ability: 'int' },
  { key: 'insight', name: 'Insight', ability: 'wis' },
  { key: 'intimidation', name: 'Intimidation', ability: 'cha' },
  { key: 'investigation', name: 'Investigation', ability: 'int' },
  { key: 'medicine', name: 'Medicine', ability: 'wis' },
  { key: 'nature', name: 'Nature', ability: 'int' },
  { key: 'perception', name: 'Perception', ability: 'wis' },
  { key: 'performance', name: 'Performance', ability: 'cha' },
  { key: 'persuasion', name: 'Persuasion', ability: 'cha' },
  { key: 'religion', name: 'Religion', ability: 'int' },
  { key: 'sleightOfHand', name: 'Sleight of Hand', ability: 'dex' },
  { key: 'stealth', name: 'Stealth', ability: 'dex' },
  { key: 'survival', name: 'Survival', ability: 'wis' },
]

export const CONDITIONS = [
  'Blinded',
  'Charmed',
  'Deafened',
  'Frightened',
  'Grappled',
  'Incapacitated',
  'Invisible',
  'Paralyzed',
  'Petrified',
  'Poisoned',
  'Prone',
  'Restrained',
  'Stunned',
  'Unconscious',
  'Exhaustion 1',
  'Exhaustion 2',
  'Exhaustion 3',
  'Exhaustion 4',
  'Exhaustion 5',
  'Exhaustion 6',
] as const

/** Colored rings drawn around map tokens for tracker conditions. Unconscious stands in for sleep. */
export const CONDITION_RING: Record<(typeof CONDITIONS)[number], string> = {
  Blinded: '#9ca3af',
  Charmed: '#f472b6',
  Deafened: '#78716c',
  Frightened: '#a78bfa',
  Grappled: '#fb923c',
  Incapacitated: '#64748b',
  Invisible: '#67e8f9',
  Paralyzed: '#facc15',
  Petrified: '#a8a29e',
  Poisoned: '#4ade80',
  Prone: '#b45309',
  Restrained: '#f59e0b',
  Stunned: '#38bdf8',
  Unconscious: '#818cf8',
  'Exhaustion 1': '#6b7280',
  'Exhaustion 2': '#6b7280',
  'Exhaustion 3': '#6b7280',
  'Exhaustion 4': '#6b7280',
  'Exhaustion 5': '#6b7280',
  'Exhaustion 6': '#6b7280',
}

export function conditionRingColor(name: string) {
  if (name in CONDITION_RING) return CONDITION_RING[name as (typeof CONDITIONS)[number]]
  if (name.toLowerCase().startsWith('exhaustion')) return '#6b7280'
  return '#c4453c'
}

export const TOKEN_PALETTE = [
  '#c4453c',
  '#e07030',
  '#d4b45a',
  '#4ea36a',
  '#6ea8c9',
  '#7b6cc9',
  '#c46b9a',
  '#8a6a4a',
  '#d9d0c0',
  '#3d6b5a',
]

export type NamedEntry = { name: string; desc: string }

export type Monster = {
  id: string
  dmAccountId: string
  name: string
  size: string
  creatureType: string
  alignment: string
  acValue: number
  acNote: string
  hpMax: number
  hitDiceFormula: string
  speed: string
  str: number
  dex: number
  con: number
  int: number
  wis: number
  cha: number
  savingThrows: string
  skills: string
  damageVulnerabilities: string
  damageResistances: string
  damageImmunities: string
  conditionImmunities: string
  senses: string
  languages: string
  challengeRating: number
  xp: number
  proficiencyBonus: number
  traits: NamedEntry[]
  actions: NamedEntry[]
  legendaryActions: NamedEntry[]
  reactions: NamedEntry[]
  bonusActions: NamedEntry[]
  lairActions: NamedEntry[]
  source: 'srd' | 'custom'
}

export type Attack = { name: string; bonus: string; damage: string; range?: string }

export type CharacterSheetData = {
  className: string
  level: number
  race: string
  background: string
  alignment: string
  xp: number
  ac: number
  speed: string
  initiativeBonus: number | null
  hpMax: number
  hpCurrent: number
  hpTemp: number
  hitDice: string
  deathSuccess: number
  deathFail: number
  abilities: Record<Ability, number>
  savingThrowProf: Record<Ability, boolean>
  attacks: Attack[]
  skillProf: Record<string, boolean>
  skillExpertise: Record<string, boolean>
  spellcastingAbility: Ability | ''
  spellSlots: number[]
  spellSlotsUsed: number[]
  spells: { name: string; level: number; prepared: boolean }[]
  personality: string
  ideals: string
  bonds: string
  flaws: string
  appearance: string
  backstory: string
  equipment: string
  notes: string
  features: string
}

export type PlayerCharacter = {
  id: string
  campaignId: string
  personalCode: string
  ownerDisplayName: string
  name: string
  tokenColor: string
  sourcePdfUrl: string | null
  sheet: CharacterSheetData
}

export type BattleMap = {
  id: string
  campaignId: string
  name: string
  imageUrl: string
  gridSize: number
  gridCols: number
  gridRows: number
  gridType: 'square'
  /** 1 = impassable (tokens cannot stop here), 0 = walkable. Length is cols * rows. */
  blocked: number[]
}

export type GridCell = { x: number; y: number }

export type TemplateMonster = {
  bestiaryMonsterId: string
  name: string
  quantity: number
  startX: number
  startY: number
  color: string
  /** One map cell per copy. When missing, copies cluster from startX/startY. */
  positions?: GridCell[]
}

export type TemplateCharacter = {
  characterId: string
  name: string
  startX: number
  startY: number
  color: string
}

export type EncounterTemplate = {
  id: string
  campaignId: string
  mapId: string
  name: string
  monsters: TemplateMonster[]
  characters?: TemplateCharacter[]
}

export type Campaign = {
  id: string
  dmAccountId: string
  name: string
}

export type Combatant = {
  id: string
  encounterInstanceId: string
  name: string
  source: 'bestiary' | 'character'
  sourceId: string
  initiative: number
  hpCurrent: number
  hpMax: number
  hpTemp: number
  ac: number
  conditions: string[]
  turnOrderPosition: number
  color: string
  notes: string
  constitution: number
  /** Combatant IDs this creature has advantage against on its next attack. */
  advantageAgainst: string[]
}

export type MapToken = {
  id: string
  encounterInstanceId: string
  x: number
  y: number
  refType: 'character' | 'combatant'
  refId: string
  label: string
  color: string
  sizeSquares: number
  visibleToPlayers: boolean
  hpCurrent?: number
  hpMax?: number
  hpTemp?: number
  ac?: number
  conditions?: string[]
}

export type FogState = {
  cols: number
  rows: number
  enabled: boolean
  revealed: number[]
}

export type EncounterInstance = {
  id: string
  campaignId: string
  encounterTemplateId: string | null
  name: string
  status: 'active' | 'paused' | 'completed'
  roundNumber: number
  currentTurnPosition: number
  fogState: FogState
  mapId: string | null
}

export type TablePhase = 'table' | 'combat' | 'victory' | 'defeat'
export type EncounterOutcome = 'won' | 'lost'

export type LiveSession = {
  id: string
  joinCode: string
  campaignId: string
  encounterInstanceId: string | null
  tablePhase: TablePhase
  ambianceImageUrl: string | null
  ambianceCaption: string
  lastOutcome: EncounterOutcome | null
}

export type EncounterSnapshot = {
  campaign: Campaign
  session: LiveSession | null
  instance: EncounterInstance | null
  map: BattleMap | null
  combatants: Combatant[]
  tokens: MapToken[]
  characters: PlayerCharacter[]
}

export type AuthUser =
  | { role: 'dm'; id: string; name: string }
  | { role: 'player'; id: string; characterId: string; campaignId: string; name: string }

export function emptySheet(): CharacterSheetData {
  const abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }
  const savingThrowProf = { str: false, dex: false, con: false, int: false, wis: false, cha: false }
  return {
    className: '',
    level: 1,
    race: '',
    background: '',
    alignment: '',
    xp: 0,
    ac: 10,
    speed: '30 ft.',
    initiativeBonus: null,
    hpMax: 10,
    hpCurrent: 10,
    hpTemp: 0,
    hitDice: '1d8',
    deathSuccess: 0,
    deathFail: 0,
    abilities,
    savingThrowProf,
    attacks: [{ name: '', bonus: '', damage: '', range: '5 ft.' }],
    skillProf: {},
    skillExpertise: {},
    spellcastingAbility: '',
    spellSlots: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    spellSlotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    spells: [],
    personality: '',
    ideals: '',
    bonds: '',
    flaws: '',
    appearance: '',
    backstory: '',
    equipment: '',
    notes: '',
    features: '',
  }
}

export function sheetHasSkills(sheet: CharacterSheetData) {
  return Object.values(sheet.skillProf).some(Boolean) || Object.values(sheet.skillExpertise).some(Boolean)
}

export function sheetHasSpells(sheet: CharacterSheetData) {
  return Boolean(sheet.spellcastingAbility) || sheet.spells.some((s) => s.name.trim()) || sheet.spellSlots.some((n) => n > 0)
}

export function sheetHasBio(sheet: CharacterSheetData) {
  return Boolean(
    sheet.personality ||
      sheet.ideals ||
      sheet.bonds ||
      sheet.flaws ||
      sheet.appearance ||
      sheet.backstory ||
      sheet.equipment ||
      sheet.notes ||
      sheet.features,
  )
}
