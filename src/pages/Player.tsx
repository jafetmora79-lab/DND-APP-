import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BookOpen, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CharacterSheet } from '@/components/CharacterSheet'
import { EncounterOutcomeOverlay } from '@/components/EncounterOutcome'
import { MapBoard } from '@/components/map/MapBoard'
import { PlayerTurnPanel, type MapPickMode } from '@/components/PlayerTurnPanel'
import { TableHub } from '@/components/TableHub'
import { Tracker } from '@/components/Tracker'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { decorateTokens } from '@/lib/combat'
import { useLive } from '@/lib/realtime'
import { isFightSetup, showCombatStage, showOutcome } from '@/lib/session'
import type { Attack, EncounterSnapshot, PlayerCharacter } from '@/lib/types'
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
  const [note, setNote] = useState('')
  const [targetId, setTargetId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [mapPick, setMapPick] = useState<MapPickMode>('select')
  const [launchAttack, setLaunchAttack] = useState<{ attack: Attack; index: number } | null>(null)

  const load = useCallback(() => {
    if (!campaignId) return
    api.live(campaignId).then(setSnap).catch((e) => setError(e.message))
  }, [campaignId])

  useEffect(() => {
    load()
  }, [load])

  const refreshLive = useLive(campaignId, setSnap)

  const me = user && user.role === 'player' ? snap?.characters.find((c) => c.id === user.characterId) : null
  const viewing: PlayerCharacter | undefined = snap?.characters.find((c) => c.id === sheetId) ?? me ?? snap?.characters[0]
  const whose = snap
    ? [...snap.combatants].sort((a, b) => a.turnOrderPosition - b.turnOrderPosition)[snap.instance?.currentTurnPosition ?? 0]
    : undefined
  const myCombatant = snap?.combatants.find((c) => c.source === 'character' && c.sourceId === me?.id)
  const saveTargetId = focusId ?? myCombatant?.id ?? null
  const highlightIds = useMemo(() => {
    if (!myCombatant || (mapPick !== 'attack' && mapPick !== 'help')) return []
    return snap?.combatants.filter((c) => c.id !== myCombatant.id).map((c) => c.id) ?? []
  }, [snap, myCombatant, mapPick])
  const tokens = snap ? decorateTokens(snap.tokens, snap.combatants) : []
  const combat = showCombatStage(snap?.session ?? null, snap?.instance ?? null, snap?.map ?? null)
  const outcome = showOutcome(snap?.session ?? null)

  const onUseAttack = useCallback((attack: Attack, index: number) => {
    setLaunchAttack({ attack, index })
    setDrawer(false)
    setTab('map')
  }, [])

  if (!snap) {
    return <div className="p-6 text-muted">{error || 'Connecting to the table…'}</div>
  }

  const sheet = viewing ? (
    <CharacterSheet
      character={viewing}
      canEdit={user?.role === 'player' && viewing.id === user.characterId}
      onChange={(patch) => api.patchCharacter(viewing.id, patch)}
      onUseAttack={user?.role === 'player' && viewing.id === user.characterId ? onUseAttack : undefined}
    />
  ) : (
    <p className="text-sm text-muted">Your character sheet will appear here.</p>
  )

  if (!combat || !snap.instance || !snap.map) {
    return (
      <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-bg">
        <header className="flex items-center gap-2 border-b border-line px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-gold">{snap.campaign.name}</div>
            <div className="truncate text-xs text-muted">{snap.session?.ambianceCaption || 'At the table — waiting between encounters'}</div>
          </div>
          {me && (
            <div className="stat-num text-sm">
              {me.sheet.hpCurrent}/{me.sheet.hpMax} HP
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              logout()
              nav('/')
            }}
          >
            Leave
          </Button>
        </header>
        {error && <p className="border-b border-line px-3 py-2 text-sm text-blood">{error}</p>}
        <TableHub
          campaignName={snap.campaign.name}
          imageUrl={snap.session?.ambianceImageUrl ?? null}
          caption={snap.session?.ambianceCaption ?? ''}
          lastOutcome={snap.session?.lastOutcome ?? null}
          hub={snap.campaign.hub}
          characters={snap.characters}
          selectedId={viewing?.id ?? null}
          onSelectCharacter={setSheetId}
          sheet={sheet}
          playerView
          onShortRest={
            me
              ? (characterId, hpCurrent) => {
                  if (characterId !== me.id) return
                  void api.patchCharacter(me.id, { sheet: { ...me.sheet, hpCurrent } }).then(load)
                }
              : undefined
          }
        />
      </div>
    )
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-bg">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-gold">{snap.campaign.name}</div>
          <div className="truncate text-xs text-muted">
            {isFightSetup(snap.session, snap.instance)
              ? 'Roll initiative — enter your d20 below'
              : snap.instance
                ? `Round ${snap.instance.roundNumber} · ${whose?.name ?? 'waiting'}'s turn`
                : 'No encounter loaded yet'}
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
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            logout()
            nav('/')
          }}
        >
          Leave
        </Button>
      </header>
      {error && <p className="border-b border-line px-3 py-2 text-sm text-blood">{error}</p>}

      <div className="flex shrink-0 gap-1 border-b border-line px-2 py-1 lg:hidden">
        <button type="button" className={cn('rounded px-3 py-1 text-sm', tab === 'map' ? 'bg-gold text-bg' : 'text-muted')} onClick={() => setTab('map')}>
          Map
        </button>
        <button type="button" className={cn('rounded px-3 py-1 text-sm', tab === 'tracker' ? 'bg-gold text-bg' : 'text-muted')} onClick={() => setTab('tracker')}>
          Tracker
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className={cn('relative min-h-0 flex-1', tab === 'tracker' && 'hidden lg:block')}>
          <MapBoard
            map={snap.map}
            tokens={tokens}
            fog={snap.instance.fogState}
            isDm={false}
            selectedId={targetId ?? focusId}
            highlightIds={highlightIds}
            dragRefIds={myCombatant && whose?.id === myCombatant.id ? [myCombatant.id] : []}
            onSelect={(id) => {
              if (mapPick === 'attack' || mapPick === 'help') {
                setTargetId(id)
                if (id) setFocusId(id)
                return
              }
              setFocusId(id)
            }}
            onMove={
              myCombatant
                ? async (id, x, y) => {
                    const prev = snap.tokens.find((t) => t.id === id)
                    setSnap((s) =>
                      s ? { ...s, tokens: s.tokens.map((t) => (t.id === id ? { ...t, x, y } : t)) } : s,
                    )
                    try {
                      await api.moveToken(id, { x, y })
                      setError('')
                      refreshLive()
                    } catch (e) {
                      if (prev) {
                        setSnap((s) =>
                          s ? { ...s, tokens: s.tokens.map((t) => (t.id === id ? { ...t, x: prev.x, y: prev.y } : t)) } : s,
                        )
                      }
                      const msg = e instanceof Error ? e.message : 'Could not move'
                      setError(msg)
                      throw e instanceof Error ? e : new Error(msg)
                    }
                  }
                : undefined
            }
          />
        </div>
        <aside className={cn('min-h-0 w-full overflow-y-auto border-line p-3 lg:block lg:w-72 lg:border-l', tab === 'map' ? 'hidden lg:block' : 'block min-h-0 flex-1')}>
          <Tracker
            combatants={snap.combatants}
            current={snap.instance.currentTurnPosition}
            round={snap.instance.roundNumber}
            isDm={false}
            setup={isFightSetup(snap.session, snap.instance)}
            selectedId={saveTargetId}
            economyId={myCombatant?.id}
            onSelect={(id) => setFocusId(id)}
            onPatch={(id, body) => {
              if (!myCombatant || id !== myCombatant.id) return
              setSnap((s) =>
                s
                  ? {
                      ...s,
                      combatants: s.combatants.map((c) => (c.id === id ? { ...c, ...body } : c)),
                    }
                  : s,
              )
              if (body.turnEconomy) {
                void api
                  .setTurnEconomy(id, body.turnEconomy as { action: boolean; bonus: boolean; reaction: boolean; movement: boolean })
                  .then(() => refreshLive())
              }
            }}
            onNext={() => undefined}
            onSort={() => undefined}
            onReorder={() => undefined}
            onDeathSave={(id, d20v) => {
              if (!myCombatant || id !== myCombatant.id) return
              void api
                .deathSave(id, { d20: d20v })
                .then((r) => {
                  setNote(r.message)
                  refreshLive()
                })
                .catch((e) => setNote(e instanceof Error ? e.message : 'Death save failed'))
            }}
          />
        </aside>
      </div>

      {me && (
        <>
          {!myCombatant && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-panel px-3 py-2 text-sm">
              <span className="text-muted">You are not on the map yet.</span>
              <Button
                size="sm"
                variant="ember"
                onClick={() => {
                  void api
                    .joinFight(snap.instance!.id)
                    .then(() => {
                      setNote('You are on the map.')
                      refreshLive()
                    })
                    .catch((e) => setError(e instanceof Error ? e.message : 'Could not join the fight'))
                }}
              >
                Join this fight
              </Button>
            </div>
          )}
          {note && <p className="shrink-0 border-t border-line bg-panel px-3 py-1 text-sm text-gold">{note}</p>}
          <div className="max-h-[40vh] shrink-0 overflow-y-auto pb-[env(safe-area-inset-bottom)] lg:max-h-[30vh]">
          <PlayerTurnPanel
            instanceId={snap.instance.id}
            character={me}
            combatant={myCombatant}
            whose={whose}
            combatants={snap.combatants}
            prompt={snap.instance.prompt}
            selectedId={targetId}
            onSelectedId={setTargetId}
            onMapPick={setMapPick}
            launchAttack={launchAttack}
            onLaunchHandled={() => setLaunchAttack(null)}
            onSettled={refreshLive}
            setup={isFightSetup(snap.session, snap.instance)}
            currentTurnPosition={snap.instance.currentTurnPosition}
          />
          </div>
        </>
      )}

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
            <div className="min-h-0 flex-1 overflow-hidden pt-2">{sheet}</div>
          </div>
        </div>
      )}

      {outcome && <EncounterOutcomeOverlay outcome={outcome} encounterName={snap.instance.name} />}
    </div>
  )
}
