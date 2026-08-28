import type {
  CampaignHub,
  CampaignNpc,
  CampaignQuest,
  CampaignStage,
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
    stages: [],
  }
}

export function emptyBeat(partial?: Partial<SessionBeat>): SessionBeat {
  return {
    id: partial?.id ?? '',
    kind: partial?.kind ?? 'social',
    title: partial?.title ?? '',
    notes: partial?.notes ?? '',
    templateId: partial?.templateId ?? '',
    status: partial?.status ?? 'upcoming',
    imageUrl: partial?.imageUrl ?? '',
    caption: partial?.caption ?? '',
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
  const templateId = String(o.templateId ?? '')
  const kind = asKind(o.kind || (templateId ? 'combat' : 'social'))
  return {
    id: String(o.id ?? `beat-${i}`),
    kind,
    title: title || (kind === 'combat' ? 'Encounter' : 'Scene'),
    notes: String(o.notes ?? ''),
    templateId,
    status: asBeatStatus(o.status),
    imageUrl: String(o.imageUrl ?? '').trim(),
    caption: String(o.caption ?? ''),
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

function asStage(raw: unknown, i: number): CampaignStage | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const name = String(o.name ?? '').trim()
  const imageUrl = String(o.imageUrl ?? '').trim()
  const caption = String(o.caption ?? '').trim()
  if (!name && !imageUrl && !caption && !o.id) return null
  return {
    id: String(o.id ?? `stage-${i}`),
    name: name || 'Scene',
    imageUrl,
    caption: String(o.caption ?? ''),
    afterTemplateId: String(o.afterTemplateId ?? ''),
    beforeTemplateId: String(o.beforeTemplateId ?? ''),
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

export function isCombatBeat(beat: SessionBeat): boolean {
  return beat.kind === 'combat' || Boolean(beat.templateId)
}

export function beatHasScene(beat: SessionBeat | null | undefined): beat is SessionBeat {
  if (!beat) return false
  return Boolean(beat.imageUrl.trim() || beat.caption.trim() || (!isCombatBeat(beat) && beat.title.trim()))
}

function sceneFromStage(stage: CampaignStage): SessionBeat {
  return emptyBeat({
    id: stage.id.startsWith('beat-') ? stage.id : `beat-${stage.id}`,
    kind: 'social',
    title: stage.name || 'Scene',
    notes: '',
    templateId: '',
    status: 'upcoming',
    imageUrl: stage.imageUrl,
    caption: stage.caption,
  })
}

function combatStub(templateId: string): SessionBeat {
  return emptyBeat({
    id: `combat-${templateId}`,
    kind: 'combat',
    title: 'Encounter',
    templateId,
    status: 'upcoming',
  })
}

/** Merge legacy After/Before stage slots into the linear run order (beats). Idempotent once a beat has scene text. */
export function foldStagesIntoBeats(beats: SessionBeat[], stages: CampaignStage[]): SessionBeat[] {
  if (stages.length === 0) return beats
  if (beats.some((b) => b.imageUrl || b.caption.trim())) return beats

  if (beats.length === 0) {
    const out: SessionBeat[] = []
    const seen = new Set<string>()
    for (const stage of stages) {
      out.push(sceneFromStage(stage))
      const tid = stage.beforeTemplateId
      if (tid && !seen.has(tid)) {
        seen.add(tid)
        out.push(combatStub(tid))
      }
    }
    return out
  }

  const result = beats.map((b) => ({ ...b }))
  const used = new Set<string>()

  function alreadyHas(stage: CampaignStage) {
    return result.some((b) => b.id === stage.id || b.id === `beat-${stage.id}`)
  }

  function attachOrInsert(stage: CampaignStage, atIndex: number, mergePrev: boolean) {
    if (alreadyHas(stage)) {
      used.add(stage.id)
      return
    }
    if (mergePrev && atIndex > 0) {
      const prev = result[atIndex - 1]!
      if (!isCombatBeat(prev) && !prev.imageUrl && !prev.caption.trim()) {
        result[atIndex - 1] = {
          ...prev,
          imageUrl: stage.imageUrl,
          caption: stage.caption || prev.caption,
          title: prev.title || stage.name,
        }
        used.add(stage.id)
        return
      }
    }
    result.splice(atIndex, 0, sceneFromStage(stage))
    used.add(stage.id)
  }

  for (const stage of stages) {
    const beforeId = stage.beforeTemplateId || ''
    const afterId = stage.afterTemplateId || ''
    if (beforeId) {
      const combatIdx = result.findIndex((b) => b.templateId === beforeId)
      if (combatIdx >= 0) {
        attachOrInsert(stage, combatIdx, true)
        continue
      }
    }
    if (afterId && !beforeId) {
      const combatIdx = result.findIndex((b) => b.templateId === afterId)
      if (combatIdx >= 0) {
        attachOrInsert(stage, combatIdx + 1, false)
        continue
      }
    }
    if (!afterId && !beforeId) {
      attachOrInsert(stage, 0, false)
    }
  }

  for (const stage of stages) {
    if (!used.has(stage.id) && !alreadyHas(stage)) result.push(sceneFromStage(stage))
  }
  return result
}

export function parseHub(raw: unknown): CampaignHub {
  const base = emptyHub()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  const stages = Array.isArray(o.stages) ? o.stages.map(asStage).filter((x): x is CampaignStage => Boolean(x)) : []
  const beats = Array.isArray(o.beats) ? o.beats.map(asBeat).filter((x): x is SessionBeat => Boolean(x)) : []
  return {
    recap: String(o.recap ?? ''),
    sessionTitle: String(o.sessionTitle ?? ''),
    sessionNotes: String(o.sessionNotes ?? ''),
    beats: foldStagesIntoBeats(beats, stages),
    quests: Array.isArray(o.quests) ? o.quests.map(asQuest).filter((x): x is CampaignQuest => Boolean(x)) : [],
    npcs: Array.isArray(o.npcs) ? o.npcs.map(asNpc).filter((x): x is CampaignNpc => Boolean(x)) : [],
    loot: Array.isArray(o.loot) ? o.loot.map(asLoot).filter((x): x is PartyLoot => Boolean(x)) : [],
    /** Consumed into beats so edits (Remove scene) cannot be resurrected on the next parse. */
    stages: [],
  }
}

export function openingSceneBeat(hub: CampaignHub | null | undefined): SessionBeat | null {
  const beats = parseHub(hub).beats
  for (const beat of beats) {
    if (isCombatBeat(beat)) continue
    return beat
  }
  return beats.find((b) => beatHasScene(b) && !isCombatBeat(b)) ?? null
}

/** Scene currently on the table: the active scenery beat, or the opening scene if nothing is active. */
export function tableSceneBeat(hub: CampaignHub | null | undefined): SessionBeat | null {
  const beats = parseHub(hub).beats
  const active = beats.find((b) => b.status === 'active')
  if (active && !isCombatBeat(active)) return active
  if (active && isCombatBeat(active)) return null
  return openingSceneBeat(hub)
}

export function adjacentSceneBeat(hub: CampaignHub | null | undefined, direction: -1 | 1): SessionBeat | null {
  const scenes = sceneBeats(hub)
  if (scenes.length === 0) return null
  const current = tableSceneBeat(hub)
  const idx = current ? scenes.findIndex((s) => s.id === current.id) : -1
  const nextIdx = idx < 0 ? (direction > 0 ? 0 : scenes.length - 1) : idx + direction
  if (nextIdx < 0 || nextIdx >= scenes.length) return null
  return scenes[nextIdx] ?? null
}

/** Image and caption the table should show. An active scene's picture wins over a stale tavern session. */
export function tableAmbiance(
  hub: CampaignHub | null | undefined,
  session?: { ambianceImageUrl?: string | null; ambianceCaption?: string | null } | null,
): { imageUrl: string | null; caption: string } {
  const fromScene = ambianceFromBeat(tableSceneBeat(hub))
  if (fromScene?.imageUrl) {
    const sessionMatches = (session?.ambianceImageUrl ?? '').trim() === fromScene.imageUrl
    return {
      imageUrl: fromScene.imageUrl,
      caption: (sessionMatches ? session?.ambianceCaption?.trim() : '') || fromScene.caption,
    }
  }
  return {
    imageUrl: session?.ambianceImageUrl?.trim() || null,
    caption: (session?.ambianceCaption ?? '').trim() || fromScene?.caption || '',
  }
}

/** Players only receive the beat that is on the table now — never the rest of the run. */
export function hubForPlayer(hub: CampaignHub | null | undefined): CampaignHub {
  const parsed = parseHub(hub)
  return {
    ...parsed,
    sessionNotes: '',
    beats: parsed.beats
      .filter((b) => b.status === 'active')
      .map((b) => ({ ...b, notes: '' })),
  }
}

export function sceneAfterEncounter(hub: CampaignHub, templateId: string | null | undefined): SessionBeat | null {
  const key = String(templateId ?? '')
  if (!key) return openingSceneBeat(hub)
  const beats = parseHub(hub).beats
  const idx = beats.findIndex((b) => b.templateId === key)
  if (idx < 0) return null
  for (let i = idx + 1; i < beats.length; i++) {
    const beat = beats[i]!
    if (isCombatBeat(beat)) return null
    return beat
  }
  return null
}

export function sceneBeats(hub: CampaignHub | null | undefined): SessionBeat[] {
  return parseHub(hub).beats.filter((b) => !isCombatBeat(b))
}

export function nextUpcomingCombat(hub: CampaignHub): SessionBeat | null {
  return parseHub(hub).beats.find((b) => isCombatBeat(b) && b.status !== 'done') ?? null
}

export function remainingCombatBeats(hub: CampaignHub): SessionBeat[] {
  return parseHub(hub).beats.filter((b) => isCombatBeat(b) && b.status !== 'done')
}

export function currentRunPointer(hub: CampaignHub): { now: SessionBeat | null; next: SessionBeat | null } {
  const beats = parseHub(hub).beats
  if (beats.length === 0) return { now: null, next: null }
  const activeIdx = beats.findIndex((b) => b.status === 'active')
  if (activeIdx >= 0) {
    return { now: beats[activeIdx] ?? null, next: beats[activeIdx + 1] ?? null }
  }
  const upcomingIdx = beats.findIndex((b) => b.status === 'upcoming')
  const i = upcomingIdx >= 0 ? upcomingIdx : 0
  return { now: beats[i] ?? null, next: beats[i + 1] ?? null }
}

export function ambianceFromBeat(beat: SessionBeat | null | undefined): { imageUrl: string | null; caption: string } | null {
  if (!beat) return null
  const caption = beat.caption.trim() || (!isCombatBeat(beat) ? beat.title : '')
  const imageUrl = beat.imageUrl.trim() || null
  if (!imageUrl && !caption) return null
  return { imageUrl, caption }
}

export function beatToStage(beat: SessionBeat, afterTemplateId = '', beforeTemplateId = ''): CampaignStage {
  return {
    id: beat.id,
    name: beat.title,
    imageUrl: beat.imageUrl,
    caption: beat.caption,
    afterTemplateId,
    beforeTemplateId,
  }
}

export function stageAfterTemplate(hub: CampaignHub, afterTemplateId: string | null | undefined): CampaignStage | null {
  const key = String(afterTemplateId ?? '')
  const beat = key ? sceneAfterEncounter(hub, key) : openingSceneBeat(hub)
  if (!beat) return null
  if (!beat.imageUrl.trim() && !beat.caption.trim()) return null
  return beatToStage(beat, key)
}

export function stageHasContent(stage: CampaignStage | null | undefined): stage is CampaignStage {
  if (!stage) return false
  return Boolean(stage.imageUrl.trim() || stage.caption.trim())
}

export function stagePlacementLabel(
  stage: Pick<CampaignStage, 'afterTemplateId' | 'beforeTemplateId'>,
  templates: { id: string; name: string }[],
) {
  const afterName = stage.afterTemplateId ? templates.find((t) => t.id === stage.afterTemplateId)?.name : ''
  const beforeName = stage.beforeTemplateId ? templates.find((t) => t.id === stage.beforeTemplateId)?.name : ''
  if (!stage.afterTemplateId && beforeName) return `Before ${beforeName}`
  if (stage.afterTemplateId && !stage.beforeTemplateId) return afterName ? `After ${afterName}` : 'After a fight'
  if (stage.afterTemplateId && stage.beforeTemplateId) {
    return `After ${afterName || 'a fight'}, before ${beforeName || 'the next fight'}`
  }
  return 'Start of night'
}

export function markBeatForTemplate(hub: CampaignHub, templateId: string, status: SessionBeatStatus) {
  const next = parseHub(hub)
  if (status !== 'active') {
    return {
      ...next,
      beats: next.beats.map((b) => (b.templateId === templateId ? { ...b, status } : b)),
    }
  }
  const idx = next.beats.findIndex((b) => b.templateId === templateId)
  return {
    ...next,
    beats: next.beats.map((b, i) => {
      if (idx >= 0 && i < idx) return { ...b, status: 'done' as const }
      if (b.templateId === templateId) return { ...b, status: 'active' as const }
      if (b.status === 'active') return { ...b, status: 'upcoming' as const }
      return b
    }),
  }
}

export function markBeatActive(hub: CampaignHub, beatId: string) {
  const next = parseHub(hub)
  const idx = next.beats.findIndex((b) => b.id === beatId)
  if (idx < 0) return next
  return {
    ...next,
    beats: next.beats.map((b, i) => {
      if (i === idx) return { ...b, status: 'active' as const }
      if (b.status === 'active') return { ...b, status: 'upcoming' as const }
      return b
    }),
  }
}

export function markOpeningActive(hub: CampaignHub) {
  const next = parseHub(hub)
  const idx = next.beats.findIndex((b) => b.status !== 'done')
  if (idx < 0) return next
  return markBeatActive(next, next.beats[idx]!.id)
}

function advanceBeatsAfterEncounter(beats: SessionBeat[], templateId: string | null): SessionBeat[] {
  if (!templateId) return beats
  const idx = beats.findIndex((b) => b.templateId === templateId)
  if (idx < 0) return beats
  let nextScene = -1
  for (let i = idx + 1; i < beats.length; i++) {
    if (isCombatBeat(beats[i]!)) break
    nextScene = i
    break
  }
  return beats.map((b, i) => {
    if (i <= idx) return { ...b, status: 'done' as const }
    if (i === nextScene) return { ...b, status: 'active' as const }
    return b
  })
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
  lootHolder?: string
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
      holder: String(opts.lootHolder ?? '').trim(),
    })
  }
  const beats = advanceBeatsAfterEncounter(hub.beats, opts.templateId)
  const line = `${opts.encounterName}: ${opts.outcome === 'won' ? 'victory' : 'defeat'}${xp ? ` · ${xp} XP` : ''}${lootLine ? ` · ${lootLine}` : ''}`
  const recap = hub.recap.trim() ? `${hub.recap.trim()}\n${line}` : line
  return { hub: { ...hub, beats, loot, recap }, xp }
}
