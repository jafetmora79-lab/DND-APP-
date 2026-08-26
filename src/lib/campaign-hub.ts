import type {
  CampaignHub,
  CampaignNpc,
  CampaignQuest,
  EncounterBrief,
  EncounterTemplate,
  PartyLoot,
  QuestStatus,
  SessionBeat,
  SessionBeatKind,
  SessionBeatStatus,
} from './types.ts'

export function emptyBrief(): EncounterBrief {
  return { notes: '', objective: '', difficulty: '', xpAward: 0, lootNotes: '', sortOrder: 0 }
}

export function parseBrief(raw: unknown): EncounterBrief {
  const base = emptyBrief()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  return {
    notes: String(o.notes ?? ''),
    objective: String(o.objective ?? ''),
    difficulty: String(o.difficulty ?? ''),
    xpAward: Number.isFinite(Number(o.xpAward)) ? Math.max(0, Math.round(Number(o.xpAward))) : 0,
    lootNotes: String(o.lootNotes ?? ''),
    sortOrder: Number.isFinite(Number(o.sortOrder)) ? Number(o.sortOrder) : 0,
  }
}

export function briefFromTemplate(t: Partial<EncounterTemplate>): EncounterBrief {
  return parseBrief({
    notes: t.notes,
    objective: t.objective,
    difficulty: t.difficulty,
    xpAward: t.xpAward,
    lootNotes: t.lootNotes,
    sortOrder: t.sortOrder,
  })
}

export function emptyHub(): CampaignHub {
  return {
    recap: '',
    sessionTitle: '',
    sessionNotes: '',
    beats: [],
    quests: [],
    npcs: [],
    loot: [],
  }
}

function asKind(raw: unknown): SessionBeatKind {
  const v = String(raw ?? '')
  if (v === 'combat' || v === 'social' || v === 'travel' || v === 'other') return v
  return 'other'
}

function asBeatStatus(raw: unknown): SessionBeatStatus {
  const v = String(raw ?? '')
  if (v === 'active' || v === 'done') return v
  return 'upcoming'
}

function asQuestStatus(raw: unknown): QuestStatus {
  const v = String(raw ?? '')
  if (v === 'complete' || v === 'failed') return v
  return 'open'
}

function asBeat(raw: unknown, i: number): SessionBeat | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const title = String(o.title ?? '').trim()
  if (!title && !o.id) return null
  return {
    id: String(o.id ?? `beat-${i}`),
    kind: asKind(o.kind),
    title: title || 'Beat',
    notes: String(o.notes ?? ''),
    templateId: String(o.templateId ?? ''),
    status: asBeatStatus(o.status),
  }
}

function asQuest(raw: unknown, i: number): CampaignQuest | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const name = String(o.name ?? '').trim()
  if (!name && !o.id) return null
  return {
    id: String(o.id ?? `quest-${i}`),
    name: name || 'Quest',
    status: asQuestStatus(o.status),
    notes: String(o.notes ?? ''),
    npcIds: Array.isArray(o.npcIds) ? o.npcIds.map((x) => String(x)) : [],
  }
}

function asNpc(raw: unknown, i: number): CampaignNpc | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const name = String(o.name ?? '').trim()
  if (!name && !o.id) return null
  return {
    id: String(o.id ?? `npc-${i}`),
    name: name || 'NPC',
    role: String(o.role ?? ''),
    notes: String(o.notes ?? ''),
  }
}

function asLoot(raw: unknown, i: number): PartyLoot | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const name = String(o.name ?? '').trim()
  if (!name && !o.id) return null
  return {
    id: String(o.id ?? `loot-${i}`),
    name: name || 'Item',
    qty: Number.isFinite(Number(o.qty)) ? Math.max(1, Math.round(Number(o.qty))) : 1,
    notes: String(o.notes ?? ''),
    holder: String(o.holder ?? ''),
  }
}

export function parseHub(raw: unknown): CampaignHub {
  const base = emptyHub()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  return {
    recap: String(o.recap ?? ''),
    sessionTitle: String(o.sessionTitle ?? ''),
    sessionNotes: String(o.sessionNotes ?? ''),
    beats: Array.isArray(o.beats) ? o.beats.map(asBeat).filter((x): x is SessionBeat => Boolean(x)) : [],
    quests: Array.isArray(o.quests) ? o.quests.map(asQuest).filter((x): x is CampaignQuest => Boolean(x)) : [],
    npcs: Array.isArray(o.npcs) ? o.npcs.map(asNpc).filter((x): x is CampaignNpc => Boolean(x)) : [],
    loot: Array.isArray(o.loot) ? o.loot.map(asLoot).filter((x): x is PartyLoot => Boolean(x)) : [],
  }
}

export function markBeatForTemplate(hub: CampaignHub, templateId: string, status: SessionBeatStatus) {
  const next = parseHub(hub)
  return {
    ...next,
    beats: next.beats.map((b) => (b.templateId === templateId ? { ...b, status } : b)),
  }
}

export function sortTemplates<T extends { sortOrder?: number; name: string }>(list: T[]) {
  return [...list].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name))
}

export function applyEncounterRewards(opts: {
  hub: CampaignHub
  outcome: 'won' | 'lost'
  encounterName: string
  templateId: string | null
  brief: EncounterBrief
}) {
  const hub = parseHub(opts.hub)
  const xp = opts.outcome === 'won' ? Math.max(0, opts.brief.xpAward) : 0
  const lootLine = opts.outcome === 'won' ? opts.brief.lootNotes.trim() : ''
  const loot = hub.loot.slice()
  if (lootLine) {
    loot.push({
      id: `loot-${Date.now().toString(36)}`,
      name: lootLine,
      qty: 1,
      notes: `From ${opts.encounterName}`,
      holder: '',
    })
  }
  const beats = hub.beats.map((b) => {
    if (opts.templateId && b.templateId === opts.templateId) return { ...b, status: 'done' as const }
    return b
  })
  const line = `${opts.encounterName}: ${opts.outcome === 'won' ? 'victory' : 'defeat'}${xp ? ` · ${xp} XP` : ''}${lootLine ? ` · ${lootLine}` : ''}`
  const recap = hub.recap.trim() ? `${hub.recap.trim()}\n${line}` : line
  return { hub: { ...hub, beats, loot, recap }, xp }
}
