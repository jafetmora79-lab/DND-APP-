import type {
  AuthUser,
  BattleMap,
  Campaign,
  EncounterInstance,
  EncounterSnapshot,
  EncounterTemplate,
  FogState,
  Monster,
  PlayerCharacter,
} from './types'

const TOKEN_KEY = 'dlt-token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (!(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const res = await fetch(path, { ...init, headers })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data
}

export const localApi = {
  register: (name: string, passcode: string) =>
    req<{ token: string; user: AuthUser }>('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, passcode }) }),
  login: (name: string, passcode: string) =>
    req<{ token: string; user: AuthUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ name, passcode }) }),
  me: () => req<{ user: AuthUser; character?: PlayerCharacter }>('/api/me'),
  campaigns: () => req<{ campaigns: Campaign[] }>('/api/campaigns'),
  createCampaign: (name: string) => req<{ campaign: Campaign }>('/api/campaigns', { method: 'POST', body: JSON.stringify({ name }) }),
  bestiary: (q = '') => req<{ monsters: Monster[] }>(`/api/bestiary?q=${encodeURIComponent(q)}`),
  monster: (id: string) => req<{ monster: Monster }>(`/api/bestiary/${id}`),
  saveMonster: (m: Partial<Monster> & { id?: string }) =>
    m.id
      ? req(`/api/bestiary/${m.id}`, { method: 'PATCH', body: JSON.stringify(m) })
      : req<{ monster: Monster }>('/api/bestiary', { method: 'POST', body: JSON.stringify(m) }),
  deleteMonster: (id: string) => req(`/api/bestiary/${id}`, { method: 'DELETE' }),
  maps: (campaignId: string) => req<{ maps: BattleMap[] }>(`/api/campaigns/${campaignId}/maps`),
  createMap: (campaignId: string, body: { name: string; gridSize?: number; gridCols: number; gridRows: number; imageUrl?: string }) =>
    req<{ map: BattleMap }>(`/api/campaigns/${campaignId}/maps`, { method: 'POST', body: JSON.stringify(body) }),
  uploadMap: (campaignId: string, form: FormData) => req<{ map: BattleMap }>(`/api/campaigns/${campaignId}/maps`, { method: 'POST', body: form }),
  uploadMapImage: (id: string, file: File) => {
    const form = new FormData()
    form.append('image', file)
    return req<{ map: BattleMap }>(`/api/maps/${id}/image`, { method: 'POST', body: form })
  },
  patchMap: (id: string, body: Partial<BattleMap>) => req<{ map?: BattleMap }>(`/api/maps/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteMap: (id: string) => req(`/api/maps/${id}`, { method: 'DELETE' }),
  characters: (campaignId: string) => req<{ characters: PlayerCharacter[] }>(`/api/campaigns/${campaignId}/characters`),
  createCharacter: (campaignId: string, body: Record<string, unknown>) =>
    req<{ character: PlayerCharacter }>(`/api/campaigns/${campaignId}/characters`, { method: 'POST', body: JSON.stringify(body) }),
  patchCharacter: (id: string, body: Record<string, unknown>) =>
    req<{ character: PlayerCharacter }>(`/api/characters/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  regenCode: (id: string) => req<{ personalCode: string }>(`/api/characters/${id}/regenerate-code`, { method: 'POST' }),
  importPdf: (id: string, file: File) => {
    const form = new FormData()
    form.append('pdf', file)
    return req<{ character: PlayerCharacter; fieldCount: number }>(`/api/characters/${id}/import-pdf`, { method: 'POST', body: form })
  },
  templates: (campaignId: string) => req<{ templates: EncounterTemplate[] }>(`/api/campaigns/${campaignId}/templates`),
  saveTemplate: (campaignId: string, body: Partial<EncounterTemplate> & { id?: string }) =>
    body.id
      ? req(`/api/templates/${body.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      : req<{ template: EncounterTemplate }>(`/api/campaigns/${campaignId}/templates`, { method: 'POST', body: JSON.stringify(body) }),
  deleteTemplate: (id: string) => req(`/api/templates/${id}`, { method: 'DELETE' }),
  instances: (campaignId: string) => req<{ instances: EncounterInstance[] }>(`/api/campaigns/${campaignId}/instances`),
  startInstance: (campaignId: string, templateId: string, name?: string) =>
    req<{ instanceId: string }>(`/api/campaigns/${campaignId}/instances`, { method: 'POST', body: JSON.stringify({ templateId, name }) }),
  setStatus: (id: string, status: string) => req(`/api/instances/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  openSession: (campaignId: string, encounterInstanceId: string | null) =>
    req<{ session: { joinCode: string } }>(`/api/campaigns/${campaignId}/session`, {
      method: 'POST',
      body: JSON.stringify({ encounterInstanceId }),
    }),
  peekJoin: (code: string) => req<{ campaignName: string; joinCode: string }>(`/api/join/${code}`),
  join: (code: string, personalCode: string) =>
    req<{ token: string; user: AuthUser }>(`/api/join/${code}`, { method: 'POST', body: JSON.stringify({ personalCode }) }),
  live: (campaignId: string) => req<EncounterSnapshot>(`/api/campaigns/${campaignId}/live`),
  addCombatant: (instanceId: string, body: Record<string, unknown>) =>
    req(`/api/instances/${instanceId}/combatants`, { method: 'POST', body: JSON.stringify(body) }),
  patchCombatant: (id: string, body: Record<string, unknown>) => req(`/api/combatants/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  nextTurn: (id: string) => req(`/api/instances/${id}/next-turn`, { method: 'POST' }),
  sortInit: (id: string) => req(`/api/instances/${id}/sort-initiative`, { method: 'POST' }),
  reorder: (id: string, ids: string[]) => req(`/api/instances/${id}/reorder`, { method: 'POST', body: JSON.stringify({ ids }) }),
  moveToken: (id: string, body: Record<string, unknown>) => req(`/api/tokens/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  setFog: (id: string, fogState: FogState) => req(`/api/instances/${id}/fog`, { method: 'PATCH', body: JSON.stringify({ fogState }) }),
}

export type TableApi = typeof localApi
