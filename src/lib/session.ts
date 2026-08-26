import type { BattleMap, EncounterInstance, EncounterOutcome, LiveSession, TablePhase } from './types.ts'

export function sessionFromRow(row: Record<string, unknown>): LiveSession {
  const encounterInstanceId = row.encounter_instance_id ? String(row.encounter_instance_id) : null
  const rawPhase = String(row.table_phase ?? '')
  let tablePhase: TablePhase =
    rawPhase === 'table' || rawPhase === 'combat' || rawPhase === 'victory' || rawPhase === 'defeat'
      ? rawPhase
      : encounterInstanceId
        ? 'combat'
        : 'table'
  // Rows created before table_phase existed default to 'table' but still have a fight attached.
  if (tablePhase === 'table' && encounterInstanceId) tablePhase = 'combat'
  const last = String(row.last_outcome ?? '')
  return {
    id: String(row.id),
    joinCode: String(row.join_code),
    campaignId: String(row.campaign_id),
    encounterInstanceId,
    tablePhase,
    ambianceImageUrl: row.ambiance_image_url ? String(row.ambiance_image_url) : null,
    ambianceCaption: String(row.ambiance_caption ?? ''),
    lastOutcome: last === 'won' || last === 'lost' ? last : null,
  }
}

/** Map + tracker are on screen for an active fight and for the won/lost overlay. */
export function showCombatStage(
  session: LiveSession | null,
  instance: EncounterInstance | null,
  map: BattleMap | null,
) {
  if (!instance || !map) return false
  const phase = session?.tablePhase ?? 'combat'
  if (phase === 'victory' || phase === 'defeat') return true
  if (phase === 'table') return false
  return instance.status !== 'completed'
}

export function showOutcome(session: LiveSession | null): EncounterOutcome | null {
  if (session?.tablePhase === 'victory') return 'won'
  if (session?.tablePhase === 'defeat') return 'lost'
  return null
}
