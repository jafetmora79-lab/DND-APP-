import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BookOpen, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AttackBar } from '@/components/AttackBar'
import { SaveBar } from '@/components/SaveBar'
import { CharacterSheet } from '@/components/CharacterSheet'
import { EncounterOutcomeOverlay } from '@/components/EncounterOutcome'
import { MapBoard } from '@/components/map/MapBoard'
import { TableHub } from '@/components/TableHub'
import { Tracker } from '@/components/Tracker'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { canTakeAttacks, decorateTokens, effectiveRollMode, inRangeCombatantIds } from '@/lib/combat'
import { useLive } from '@/lib/realtime'
import { showCombatStage, showOutcome } from '@/lib/session'
import type { Attack, EncounterSnapshot, PlayerCharacter, RollMode } from '@/lib/types'
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
  const [pending, setPending] = useState<{ attack: Attack; index: number } | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [d20, setD20] = useState('')
  const [d20b, setD20b] = useState('')
  const [rollMode, setRollMode] = useState<RollMode>('normal')
  const [damage, setDamage] = useState('')
  const [attackMsg, setAttackMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!campaignId) return
    api.live(campaignId).then(setSnap).catch((e) => setError(e.message))
  }, [campaignId])

  useEffect(() => {
    load()
  }, [load])

  useLive(campaignId, setSnap)

  const me = user && user.role === 'player' ? snap?.characters.find((c) => c.id === user.characterId) : null
  const viewing: PlayerCharacter | undefined = snap?.characters.find((c) => c.id === sheetId) ?? me ?? snap?.characters[0]
  const whose = snap
    ? [...snap.combatants].sort((a, b) => a.turnOrderPosition - b.turnOrderPosition)[snap.instance?.currentTurnPosition ?? 0]
    : undefined
  const myCombatant = snap?.combatants.find((c) => c.source === 'character' && c.sourceId === me?.id)
  const saveTargetId = focusId ?? myCombatant?.id ?? null
  const highlightIds = useMemo(() => {
    if (!snap?.map || !pending || !myCombatant) return []
    return inRangeCombatantIds(snap.map, snap.tokens, snap.combatants, myCombatant.id, pending.attack)
  }, [snap, pending, myCombatant])
  const target = snap?.combatants.find((c) => c.id === targetId)
  const tokens = snap ? decorateTokens(snap.tokens, snap.combatants) : []
  const combat = showCombatStage(snap?.session ?? null, snap?.instance ?? null, snap?.map ?? null)
  const outcome = showOutcome(snap?.session ?? null)

  function pickAttack(attack: Attack, index: number) {
    setPending({ attack, index })
    setTargetId(null)
    setD20('')
    setD20b('')
    setDamage('')
    setAttackMsg('')
    setDrawer(false)
    setTab('map')
  }

  async function submitAttack() {
    if (!snap?.instance || !pending || !targetId) return
    const hasAdv = Boolean(targetId && myCombatant?.advantageAgainst?.includes(targetId))
    const mode = effectiveRollMode(rollMode, hasAdv)
    const roll = Number(d20)
    const rollb = Number(d20b)
    const dmg = Number(damage)
    if (!Number.isInteger(roll) || roll < 1 || roll > 20) {
      setAttackMsg('Enter the d20 you rolled at the table (1–20).')
      return
    }
    if (mode !== 'normal' && (!Number.isInteger(rollb) || rollb < 1 || rollb > 20)) {
      setAttackMsg('Enter both d20s for advantage or disadvantage.')
      return
    }
    if (!Number.isFinite(dmg) || dmg < 0) {
      setAttackMsg('Enter the damage you rolled (0 if you missed or deal none).')
      return
    }
    setBusy(true)
    try {
      const r = await api.playerAttack(snap.instance.id, {
        targetId,
        attackIndex: pending.index,
        d20: roll,
        d20b: mode === 'normal' ? undefined : rollb,
        rollMode: mode,
        damage: dmg,
      })
      setAttackMsg(r.message)
      if (r.hit) {
        setPending(null)
        setTargetId(null)
        setD20('')
        setD20b('')
        setDamage('')
      }
    } catch (e) {
      setAttackMsg(e instanceof Error ? e.message : 'Attack failed')
    } finally {
      setBusy(false)
    }
  }

  if (!snap) {
    return <div className="p-6 text-muted">{error || 'Connecting to the table…'}</div>
  }

  const sheet = viewing ? (
    <CharacterSheet
      character={viewing}
      canEdit={user?.role === 'player' && viewing.id === user.characterId}
      onChange={(patch) => api.patchCharacter(viewing.id, patch)}
      onUseAttack={user?.role === 'player' && viewing.id === user.characterId ? pickAttack : undefined}
    />
  ) : (
    <p className="text-sm text-muted">Your character sheet will appear here.</p>
  )

  if (!combat || !snap.instance || !snap.map) {
    return (
      <div className="flex h-dvh flex-col bg-bg">
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
        />
      </div>
    )
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

      <div className="flex gap-1 border-b border-line px-2 py-1 lg:hidden">
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
              if (!pending) {
                setFocusId(id)
                return
              }
              if (!id) {
                setTargetId(null)
                return
              }
              if (!highlightIds.includes(id)) {
                setAttackMsg('That creature is out of range for this attack.')
                return
              }
              setTargetId(id)
              setFocusId(id)
              setAttackMsg('')
            }}
            onMove={
              myCombatant
                ? async (id, x, y) => {
                    try {
                      await api.moveToken(id, { x, y })
                      setError('')
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : 'Could not move'
                      setError(msg)
                      throw e instanceof Error ? e : new Error(msg)
                    }
                  }
                : undefined
            }
          />
        </div>
        <aside className={cn('w-full overflow-y-auto border-line p-3 lg:block lg:w-72 lg:border-l', tab === 'map' ? 'hidden lg:block' : 'block')}>
          <Tracker
            combatants={snap.combatants}
            current={snap.instance.currentTurnPosition}
            round={snap.instance.roundNumber}
            isDm={false}
            selectedId={saveTargetId}
            economyId={myCombatant?.id}
            onSelect={(id) => setFocusId(id)}
            onPatch={(id, body) => {
              if (!myCombatant || id !== myCombatant.id) return
              if (body.turnEconomy) {
                void api.setTurnEconomy(id, body.turnEconomy as { action: boolean; bonus: boolean; reaction: boolean; movement: boolean })
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
                  setAttackMsg(r.message)
                  load()
                })
                .catch((e) => setAttackMsg(e instanceof Error ? e.message : 'Death save failed'))
            }}
          />
        </aside>
      </div>

      {me && (
        <>
          {!myCombatant && (
            <p className="border-t border-line bg-panel px-3 py-2 text-xs text-muted">
              You are not on the map yet. Ask the DM to place your character (or include you on the encounter template).
            </p>
          )}
          <AttackBar
            attacks={me.sheet.attacks}
            pendingIndex={pending?.index ?? null}
            onPick={pickAttack}
            onCancel={() => {
              setPending(null)
              setTargetId(null)
              setAttackMsg('')
            }}
            targetName={target?.name}
            targetAc={target?.ac}
            hasAdvantage={Boolean(targetId && myCombatant?.advantageAgainst?.includes(targetId))}
            disabled={!myCombatant || !canTakeAttacks(myCombatant)}
            disabledReason={
              !myCombatant
                ? undefined
                : !canTakeAttacks(myCombatant)
                  ? myCombatant.deathState === 'dead'
                    ? 'You are dead.'
                    : `You cannot take a normal attack (${myCombatant.deathState === 'ok' ? myCombatant.conditions.join(', ') || 'incapacitated' : myCombatant.deathState}).`
                  : undefined
            }
            rollMode={
              targetId && myCombatant?.advantageAgainst?.includes(targetId) && rollMode === 'normal' ? 'advantage' : rollMode
            }
            onRollMode={setRollMode}
            d20={d20}
            d20b={d20b}
            damage={damage}
            onD20={setD20}
            onD20b={setD20b}
            onDamage={setDamage}
            onResolve={submitAttack}
            canResolve={Boolean(targetId)}
            busy={busy}
            message={attackMsg}
          />
          <SaveBar combatants={snap.combatants} selectedId={saveTargetId} characters={snap.characters} monster={null} compact />
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
