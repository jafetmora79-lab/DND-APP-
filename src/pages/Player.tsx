import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Bell, BellOff, HeartPulse, Swords, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CharacterSheet } from '@/components/CharacterSheet'
import { EncounterOutcomeOverlay } from '@/components/EncounterOutcome'
import { InitiativePopup } from '@/components/InitiativePopup'
import { MapBoard } from '@/components/map/MapBoard'
import { PartyOverview } from '@/components/PartyOverview'
import { PlayerTurnPanel, type MapPickMode } from '@/components/PlayerTurnPanel'
import { StatBlock } from '@/components/StatBlock'
import { TableHub } from '@/components/TableHub'
import { Tracker } from '@/components/Tracker'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { decorateTokens, monsterForCombatant } from '@/lib/combat'
import { tableAmbiance } from '@/lib/campaign-hub'
import { haptic, notifyTurn, notificationPermissionAskedBefore, requestNotificationPermission, supportsNotifications } from '@/lib/haptics'
import { LanguageToggle, useT } from '@/lib/i18n'
import { ThemeToggle } from '@/lib/theme'
import { useLive } from '@/lib/realtime'
import { consumePendingJoin, rememberPlayerSession } from '@/lib/recent-sessions'
import { isFightSetup, showCombatStage, showOutcome } from '@/lib/session'
import type { Attack, EncounterSnapshot, PlayerCharacter } from '@/lib/types'
import { cn } from '@/lib/utils'

export function Player() {
  const { campaignId } = useParams()
  const { user, logout } = useAuth()
  const { t } = useT()
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
  const [initOpen, setInitOpen] = useState(true)
  const [statOpen, setStatOpen] = useState(false)
  const [notifOn, setNotifOn] = useState(false)
  const [deathOpen, setDeathOpen] = useState(false)
  const [deathD20, setDeathD20] = useState('')
  const [turnFlash, setTurnFlash] = useState(false)
  const [turnBanner, setTurnBanner] = useState(false)
  const lastTurnIdRef = useRef<string>('')
  const lastHpRef = useRef<number | null>(null)
  const sessionEnrichedRef = useRef(false)

  const load = useCallback(() => {
    if (!campaignId) return
    api.live(campaignId).then(setSnap).catch((e) => setError(e.message))
  }, [campaignId])

  useEffect(() => {
    load()
  }, [load])

  const refreshLive = useLive(campaignId, setSnap)

  useEffect(() => {
    if (!supportsNotifications()) return
    if (notificationPermissionAskedBefore()) {
      setNotifOn(Notification.permission === 'granted')
    }
  }, [])

  const me = user && user.role === 'player' ? snap?.characters.find((c) => c.id === user.characterId) : null
  const viewing: PlayerCharacter | undefined = snap?.characters.find((c) => c.id === sheetId) ?? me ?? snap?.characters[0]
  const whose = snap
    ? [...snap.combatants].sort((a, b) => a.turnOrderPosition - b.turnOrderPosition)[snap.instance?.currentTurnPosition ?? 0]
    : undefined
  const myCombatant = snap?.combatants.find((c) => c.source === 'character' && c.sourceId === me?.id)
  const saveTargetId = focusId ?? myCombatant?.id ?? null
  const myTurn = Boolean(myCombatant && whose && whose.id === myCombatant.id && !isFightSetup(snap?.session ?? null, snap?.instance ?? null))

  useEffect(() => {
    if (!snap || !me || user?.role !== 'player' || sessionEnrichedRef.current) return
    if (!snap.campaign || !snap.campaign.name || !me.name) return
    const pending = consumePendingJoin()
    sessionEnrichedRef.current = true
    if (pending && campaignId) {
      rememberPlayerSession({
        joinCode: pending.joinCode,
        personalCode: me.name,
        campaignName: snap.campaign.name,
        characterName: me.name,
        characterId: me.id,
        campaignId,
      })
    }
  }, [snap, me, user, campaignId])

  useEffect(() => {
    if (!myCombatant || !snap?.instance) return
    const prevTurn = lastTurnIdRef.current
    const nowTurn = `${snap.instance.currentTurnPosition}-${snap.instance.roundNumber}-${myCombatant.id}-${whose?.id ?? ''}`
    if (prevTurn && prevTurn !== nowTurn && myTurn) {
      haptic('turn')
      setTurnFlash(true)
      setTurnBanner(true)
      const t1 = setTimeout(() => setTurnFlash(false), 900)
      const t2 = setTimeout(() => setTurnBanner(false), 5000)
      if (notifOn && me) notifyTurn(me.name, snap.campaign?.name ?? '')
      return () => {
        clearTimeout(t1)
        clearTimeout(t2)
      }
    }
    lastTurnIdRef.current = nowTurn
  }, [myTurn, whose?.id, snap?.instance?.currentTurnPosition, snap?.instance?.roundNumber, myCombatant?.id, notifOn, me, snap?.campaign?.name])

  useEffect(() => {
    if (!myCombatant) {
      lastHpRef.current = null
      return
    }
    const nowHp = myCombatant.hpCurrent
    if (lastHpRef.current !== null && nowHp < lastHpRef.current) {
      haptic('hit')
    } else if (lastHpRef.current !== null && nowHp > lastHpRef.current) {
      haptic('success')
    }
    if (myCombatant.deathState === 'dead') {
      haptic('death')
    }
    lastHpRef.current = nowHp
  }, [myCombatant?.hpCurrent, myCombatant?.deathState])

  useEffect(() => {
    if (myCombatant?.deathState === 'dying') {
      setDeathOpen(true)
    } else {
      setDeathOpen(false)
      setDeathD20('')
    }
  }, [myCombatant?.deathState])

  const highlightIds = useMemo(() => {
    if (!myCombatant || (mapPick !== 'attack' && mapPick !== 'help')) return []
    return snap?.combatants.filter((c) => c.id !== myCombatant.id).map((c) => c.id) ?? []
  }, [snap, myCombatant, mapPick])
  const tokens = snap ? decorateTokens(snap.tokens, snap.combatants) : []
  const combat = showCombatStage(snap?.session ?? null, snap?.instance ?? null, snap?.map ?? null)
  const outcome = showOutcome(snap?.session ?? null)
  const setup = isFightSetup(snap?.session ?? null, snap?.instance ?? null)
  const focusedCombatant = snap?.combatants.find((c) => c.id === focusId)
  const focusedMonster = monsterForCombatant(focusedCombatant, snap?.monsters)

  const onUseAttack = useCallback((attack: Attack, index: number) => {
    haptic('tap')
    setLaunchAttack({ attack, index })
    setDrawer(false)
    setTab('map')
  }, [])

  async function enableNotifs() {
    if (!supportsNotifications()) return
    const p = await requestNotificationPermission()
    setNotifOn(p === 'granted')
  }

  function submitDeathSave() {
    if (!myCombatant) return
    const n = Number(deathD20)
    if (!Number.isFinite(n) || n < 1 || n > 20) {
      setNote('Enter a d20 (1–20)')
      return
    }
    haptic('tap')
    void api
      .deathSave(myCombatant.id, { d20: n })
      .then((r) => {
        setNote(r.message)
        setDeathD20('')
        setDeathOpen(false)
        refreshLive()
      })
      .catch((e) => setNote(e instanceof Error ? e.message : 'Death save failed'))
  }

  if (!snap) {
    return <div className="p-6 text-muted">{error || t('player.connecting')}</div>
  }

  if (!snap.session) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
        <h1 className="font-display text-2xl text-gold-2">{t('player.ended')}</h1>
        <p className="max-w-sm text-sm text-muted">{t('player.endedHint')}</p>
        <Button
          onClick={() => {
            logout()
            nav('/')
          }}
        >
          {t('player.leave')}
        </Button>
      </div>
    )
  }

  const sheet = viewing ? (
    <CharacterSheet
      character={viewing}
      canEdit={user?.role === 'player' && viewing.id === user.characterId}
      onChange={(patch) => api.patchCharacter(viewing.id, patch)}
      onUseAttack={user?.role === 'player' && viewing.id === user.characterId ? onUseAttack : undefined}
    />
  ) : (
    <p className="text-sm text-muted">{t('player.noSheet')}</p>
  )

  if (!combat || !snap.instance || !snap.map) {
    const stage = tableAmbiance(snap.campaign.hub, snap.session)
    return (
      <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-bg">
        <header className="flex items-center gap-3 border-b border-line bg-panel-2/30 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-sm text-gold-2">{snap.campaign.name}</div>
            <div className="truncate text-xs text-muted">{stage.caption || t('player.waiting')}</div>
          </div>
          {me && (
            <div className="stat-num text-sm">
              {me.sheet.hpCurrent}/{me.sheet.hpMax} {t('player.hp')}
            </div>
          )}
          {supportsNotifications() && (
            <button
              type="button"
              onClick={enableNotifs}
              className={cn(
                'shrink-0 rounded-md border p-2 text-xs transition',
                notifOn ? 'border-ember/40 bg-ember/10 text-ember' : 'border-line text-muted hover:border-gold/40 hover:text-gold',
              )}
              aria-label={notifOn ? 'Turn notifications on' : 'Enable turn notifications'}
              title={notifOn ? 'Turn notifications on' : 'Alert me when it’s my turn'}
            >
              {notifOn ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
            </button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs"
            onClick={() => {
              haptic('tap')
              setDrawer(true)
            }}
          >
            <Users className="h-4 w-4" /> Party
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs"
            onClick={() => {
              logout()
              nav('/')
            }}
          >
            {t('player.leave')}
          </Button>
          <LanguageToggle />
          <ThemeToggle />
        </header>
        {error && <p className="border-b border-line px-3 py-2 text-sm text-blood">{error}</p>}
        <TableHub
          campaignName={snap.campaign.name}
          imageUrl={stage.imageUrl}
          caption={stage.caption}
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

        <button
          type="button"
          onClick={() => {
            if (me) {
              haptic('tap')
              setSheetId(me.id)
              setDrawer(true)
            }
          }}
          className="fixed bottom-5 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full border border-gold/60 bg-gold text-bg shadow-[0_8px_24px_rgba(200,150,70,0.35)] transition active:scale-95"
          aria-label="Open party overview"
        >
          <Users className="h-6 w-6" />
        </button>

        {drawer && (
          <PartyOverview
            characters={snap.characters}
            selectedId={sheetId}
            onSelectCharacter={(id) => {
              haptic('tap')
              setSheetId(id)
            }}
            onClose={() => setDrawer(false)}
            canEditId={user?.role === 'player' ? user.characterId : null}
            onChange={(characterId, patch) => {
              void api.patchCharacter(characterId, patch)
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div className={cn('flex h-dvh min-h-0 flex-col overflow-hidden bg-bg', turnFlash && 'animate-turn-flash')}>
      {turnBanner && myTurn && me && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-2">
          <div className="animate-turn-bounce flex items-center gap-2 rounded-full border-2 border-ember bg-ember px-5 py-2 text-sm font-bold uppercase tracking-wider text-white shadow-[0_0_40px_rgba(200,50,40,0.55)]">
            <Swords className="h-4 w-4" />
            {me.name} — Your Turn!
          </div>
        </div>
      )}

      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-panel-2/30 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-sm text-gold-2">{snap.campaign.name}</div>
          <div className="truncate text-xs text-muted">
            {isFightSetup(snap.session, snap.instance)
              ? t('player.initHint')
              : snap.instance
                ? `${t('player.round')} ${snap.instance.roundNumber} · ${whose?.name ?? t('player.waitingName')} ${t('player.turn')}`
                : t('player.noEncounter')}
          </div>
        </div>
        {me && (
          <div className={cn(
            'stat-num text-sm',
            myCombatant && myCombatant.deathState === 'dying' && 'animate-pulse text-blood',
          )}>
            {myCombatant ? `${myCombatant.hpCurrent}/${myCombatant.hpMax}` : `${me.sheet.hpCurrent}/${me.sheet.hpMax}`} {t('player.hp')}
          </div>
        )}
        {supportsNotifications() && (
          <button
            type="button"
            onClick={enableNotifs}
            className={cn(
              'shrink-0 rounded-md border p-2 transition',
              notifOn ? 'border-ember/40 bg-ember/10 text-ember' : 'border-line text-muted hover:border-gold/40 hover:text-gold',
            )}
            aria-label={notifOn ? 'Turn notifications on' : 'Enable turn notifications'}
            title={notifOn ? 'Turn notifications on' : 'Alert me when it’s my turn'}
          >
            {notifOn ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
          </button>
        )}
        {setup && (
          <Button size="sm" variant="outline" className="h-8 px-3 text-xs" onClick={() => { haptic('tap'); setInitOpen(true) }}>
            {t('init.title')}
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-8 px-3 text-xs" onClick={() => { haptic('tap'); setDrawer(true) }}>
          <Users className="h-4 w-4" /> Party
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 px-3 text-xs"
          onClick={() => {
            logout()
            nav('/')
          }}
        >
          {t('player.leave')}
        </Button>
        <LanguageToggle />
        <ThemeToggle />
      </header>
      {error && <p className="border-b border-line px-3 py-2 text-sm text-blood">{error}</p>}

      <div className="flex shrink-0 gap-1 border-b border-line bg-panel-2/30 px-2 py-1 lg:hidden">
        <button type="button" className={cn('rounded px-3 py-1 text-sm transition-all', tab === 'map' ? 'bg-gold text-bg' : 'text-muted hover:text-ink')} onClick={() => { haptic('tap'); setTab('map') }}>
          {t('player.map')}
        </button>
        <button type="button" className={cn('rounded px-3 py-1 text-sm transition-all', tab === 'tracker' ? 'bg-gold text-bg' : 'text-muted hover:text-ink')} onClick={() => { haptic('tap'); setTab('tracker') }}>
          {t('player.tracker')}
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
            viewerCharacterId={user?.role === 'player' ? user.characterId : null}
            combatants={snap.combatants}
            onSelect={(id) => {
              haptic('tap')
              if (mapPick === 'attack' || mapPick === 'help') {
                setTargetId(id)
                if (id) setFocusId(id)
                return
              }
              setFocusId(id)
              const c = snap.combatants.find((row) => row.id === id)
              setStatOpen(Boolean(c && c.source === 'bestiary'))
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
            onSelect={(id) => { haptic('tap'); setFocusId(id) }}
            onPatch={(id, body) => {
              if (!myCombatant || id !== myCombatant.id) return
              haptic('tap')
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
              haptic('tap')
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
                  haptic('tap')
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
            map={snap.map}
            tokens={snap.tokens}
            monsters={snap.monsters}
          />
          </div>
        </>
      )}

      {myTurn && me && (
        <button
          type="button"
          onClick={() => {
            haptic('tap')
            setSheetId(me.id)
            setDrawer(true)
          }}
          className="fixed bottom-5 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full border border-gold/60 bg-gold text-bg shadow-[0_8px_24px_rgba(200,150,70,0.35)] transition active:scale-95"
          aria-label="Open party overview"
        >
          <Users className="h-6 w-6" />
        </button>
      )}

      {drawer && (
        <PartyOverview
          characters={snap.characters}
          selectedId={sheetId}
          onSelectCharacter={(id) => {
            haptic('tap')
            setSheetId(id)
          }}
          onClose={() => setDrawer(false)}
          canEditId={user?.role === 'player' ? user.characterId : null}
          onChange={(characterId, patch) => {
            void api.patchCharacter(characterId, patch)
          }}
        />
      )}

      {deathOpen && myCombatant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-2xl border-2 border-blood bg-panel p-5 shadow-[0_0_60px_rgba(200,30,30,0.5)]">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blood/20 text-blood">
                <HeartPulse className="h-6 w-6 animate-pulse" />
              </div>
              <div>
                <h3 className="font-display text-xl text-blood">Death Save</h3>
                <p className="text-xs text-muted">You are dying. Roll a d20.</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => { haptic('tap'); setDeathD20(String(n)) }}
                  className={cn(
                    'rounded-md border py-2 text-sm font-semibold transition',
                    deathD20 === String(n)
                      ? n === 1
                        ? 'border-blood bg-blood text-white'
                        : n === 20
                          ? 'border-ember bg-ember text-white'
                          : 'border-gold bg-gold text-bg'
                      : 'border-line hover:border-gold/60',
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setDeathOpen(false); setDeathD20('') }}>
                Later
              </Button>
              <Button
                variant="ember"
                className="flex-1"
                disabled={!deathD20}
                onClick={submitDeathSave}
              >
                Roll {deathD20 && `d20 = ${deathD20}`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {setup && initOpen && campaignId && (
        <InitiativePopup
          instanceId={snap.instance.id}
          campaignId={campaignId}
          combatants={snap.combatants}
          characters={snap.characters}
          isDm={false}
          myCombatantId={myCombatant?.id}
          onSettled={refreshLive}
          onClose={() => setInitOpen(false)}
        />
      )}

      {statOpen && focusedMonster && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/60 md:items-stretch md:justify-end">
          <div className="flex h-[80dvh] w-full flex-col rounded-t-2xl border border-line bg-panel p-4 md:h-full md:max-w-lg md:rounded-none">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg text-gold">Stat block</h2>
              <button type="button" onClick={() => { haptic('tap'); setStatOpen(false) }} aria-label="Close">
                <X />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pt-2">
              <StatBlock monster={focusedMonster} />
            </div>
          </div>
        </div>
      )}

      {outcome && <EncounterOutcomeOverlay outcome={outcome} encounterName={snap.instance.name} />}
    </div>
  )
}
