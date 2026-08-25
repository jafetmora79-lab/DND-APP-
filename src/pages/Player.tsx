import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BookOpen, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CharacterSheet } from '@/components/CharacterSheet'
import { MapBoard } from '@/components/map/MapBoard'
import { Tracker } from '@/components/Tracker'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useLive } from '@/lib/realtime'
import type { EncounterSnapshot, PlayerCharacter } from '@/lib/types'
import { cn } from '@/lib/utils'

export function Player() {
  const { campaignId } = useParams()
  const { user, logout } = useAuth()
  const nav = useNavigate()
  const [snap, setSnap] = useState<EncounterSnapshot | null>(null)
  const [drawer, setDrawer] = useState(false)
  const [sheetId, setSheetId] = useState<string | null>(user && user.role === 'player' ? user.characterId : null)
  const [tab, setTab] = useState<'map' | 'tracker'>('map')
  const [error, setError] = useState('')

  const load = useCallback(() => {
    if (!campaignId) return
    api.live(campaignId).then(setSnap).catch((e) => setError(e.message))
  }, [campaignId])

  useEffect(() => {
    load()
  }, [load])

  useLive(campaignId, setSnap)

  const me = user && user.role === 'player' ? snap?.characters.find((c) => c.id === user.characterId) : null
  const viewing: PlayerCharacter | undefined = snap?.characters.find((c) => c.id === sheetId) ?? me ?? undefined
  const whose = snap
    ? [...snap.combatants].sort((a, b) => a.turnOrderPosition - b.turnOrderPosition)[snap.instance?.currentTurnPosition ?? 0]
    : undefined

  if (!snap) {
    return <div className="p-6 text-muted">{error || 'Connecting to the table…'}</div>
  }

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-gold">{snap.campaign.name}</div>
          <div className="truncate text-xs text-muted">
            {snap.instance ? `Round ${snap.instance.roundNumber} · ${whose?.name ?? 'waiting'}'s turn` : 'No encounter loaded yet'}
          </div>
        </div>
        {me && (
          <div className="stat-num text-sm">
            {me.sheet.hpCurrent}/{me.sheet.hpMax} HP
          </div>
        )}
        <Button size="sm" variant="outline" onClick={() => setDrawer(true)}>
          <BookOpen className="h-4 w-4" /> Sheets
        </Button>
      </header>

      <div className="flex gap-1 border-b border-line px-2 py-1 lg:hidden">
        <button type="button" className={cn('rounded px-3 py-1 text-sm', tab === 'map' ? 'bg-gold text-bg' : 'text-muted')} onClick={() => setTab('map')}>
          Map
        </button>
        <button type="button" className={cn('rounded px-3 py-1 text-sm', tab === 'tracker' ? 'bg-gold text-bg' : 'text-muted')} onClick={() => setTab('tracker')}>
          Tracker
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className={cn('min-h-0 flex-1', tab === 'tracker' && 'hidden lg:block')}>
          {snap.map && snap.instance ? (
            <MapBoard map={snap.map} tokens={snap.tokens} fog={snap.instance.fogState} isDm={false} />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-muted">
              The DM has not opened an encounter yet. Keep this page open — the map appears when the fight starts.
            </div>
          )}
        </div>
        <aside className={cn('w-full overflow-y-auto border-line p-3 lg:block lg:w-72 lg:border-l', tab === 'map' ? 'hidden lg:block' : 'block')}>
          {snap.instance ? (
            <Tracker
              combatants={snap.combatants}
              current={snap.instance.currentTurnPosition}
              round={snap.instance.roundNumber}
              isDm={false}
              onSelect={() => undefined}
              onPatch={() => undefined}
              onNext={() => undefined}
              onSort={() => undefined}
              onReorder={() => undefined}
            />
          ) : (
            <p className="text-sm text-muted">Initiative will appear here.</p>
          )}
        </aside>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/60 md:items-stretch md:justify-end">
          <div className="flex h-[88dvh] w-full flex-col rounded-t-2xl border border-line bg-panel p-4 md:h-full md:max-w-lg md:rounded-none">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg text-gold">Character sheets</h2>
              <button type="button" onClick={() => setDrawer(false)} aria-label="Close">
                <X />
              </button>
            </div>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
              {snap.characters.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={cn('shrink-0 rounded-full border px-3 py-1 text-sm', sheetId === c.id ? 'border-gold bg-gold text-bg' : 'border-line')}
                  onClick={() => setSheetId(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden pt-2">
              {viewing && (
                <CharacterSheet
                  character={viewing}
                  canEdit={user?.role === 'player' && viewing.id === user.characterId}
                  onChange={(patch) => api.patchCharacter(viewing.id, patch)}
                />
              )}
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        className="fixed bottom-4 right-4 rounded-full bg-ember px-4 py-3 text-sm font-medium shadow-lg lg:hidden"
        onClick={() => {
          logout()
          nav('/')
        }}
      >
        Leave table
      </button>
    </div>
  )
}
