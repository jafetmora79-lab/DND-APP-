export type RecentPlayerSession = {
  joinCode: string
  personalCode: string
  campaignName: string
  characterName: string
  characterId: string
  campaignId: string
  lastUsed: number
}

const RECENT_KEY = 'dlt-recent-sessions'
const PENDING_KEY = 'dlt-pending-join'
const MAX_RECENT = 5

export function getRecentSessions(): RecentPlayerSession[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (s): s is RecentPlayerSession =>
        s &&
        typeof s.joinCode === 'string' &&
        typeof s.personalCode === 'string' &&
        typeof s.campaignName === 'string' &&
        typeof s.characterName === 'string' &&
        typeof s.characterId === 'string' &&
        typeof s.campaignId === 'string' &&
        typeof s.lastUsed === 'number',
    )
  } catch {
    return []
  }
}

export function rememberPlayerSession(sesh: Omit<RecentPlayerSession, 'lastUsed'>) {
  const list = getRecentSessions().filter(
    (s) => !(s.campaignId === sesh.campaignId && s.characterId === sesh.characterId),
  )
  list.unshift({ ...sesh, lastUsed: Date.now() })
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)))
}

export function forgetPlayerSession(campaignId: string, characterId: string) {
  const list = getRecentSessions().filter(
    (s) => !(s.campaignId === campaignId && s.characterId === characterId),
  )
  localStorage.setItem(RECENT_KEY, JSON.stringify(list))
}

export function clearRecentSessions() {
  localStorage.removeItem(RECENT_KEY)
}

export function setPendingJoin(joinCode: string, personalCode: string) {
  localStorage.setItem(PENDING_KEY, JSON.stringify({ joinCode, personalCode, at: Date.now() }))
}

export function consumePendingJoin(): { joinCode: string; personalCode: string } | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return null
    const obj = JSON.parse(raw)
    if (!obj || typeof obj.joinCode !== 'string' || typeof obj.personalCode !== 'string') return null
    localStorage.removeItem(PENDING_KEY)
    return { joinCode: obj.joinCode, personalCode: obj.personalCode }
  } catch {
    return null
  }
}
