import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Check, Copy, Eye, EyeOff, Flag, Pause, Play, Sword, Trophy } from 'lucide-react'
import { AttackBar } from '@/components/AttackBar'
import { SaveBar } from '@/components/SaveBar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CharacterSheet } from '@/components/CharacterSheet'
import { EncounterOutcomeOverlay } from '@/components/EncounterOutcome'
import { MapBoard } from '@/components/map/MapBoard'
import { StatBlock } from '@/components/StatBlock'
import { TableHub } from '@/components/TableHub'
import { Tracker } from '@/components/Tracker'
import { api } from '@/lib/api'
import { attacksFromMonster, canTakeAttacks, decorateTokens, effectiveRollMode, inRangeCombatantIds } from '@/lib/combat'
import { useLive } from '@/lib/realtime'
import { showCombatStage, showOutcome } from '@/lib/session'
import type { Attack, EncounterInstance, EncounterSnapshot, EncounterTemplate, FogState, Monster, RollMode } from '@/lib/types'
import { cn } from '@/lib/utils'
import { copyText } from '@/lib/copy'
import { markBeatForTemplate, parseHub, sortTemplates } from '@/lib/campaign-hub'

export function Live() {
  const { campaignId } = useParams()
  const [snap, setSnap] = useState<EncounterSnapshot | null>(null)
  const [templates, setTemplates] = useState<EncounterTemplate[]>([])
  const [instances, setInstances] = useState<EncounterInstance[]>([])
  const [monsters, setMonsters] = useState<Monster[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [sheetId, setSheetId] = useState<string | null>(null)
  const [panel, setPanel] = useState<'tracker' | 'sheet' | 'stat'>('tracker')
  const [tool, setTool] = useState<'select' | 'reveal' | 'hide'>('select')
  const [addQ, setAddQ] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copiedJoin, setCopiedJoin] = useState(false)
  const [pending, setPending] = useState<{ attack: Attack; index: number } | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [d20, setD20] = useState('')
  const [d20b, setD20b] = useState('')
  const [rollMode, setRollMode] = useState<RollMode>('normal')
  const [damage, setDamage] = useState('')
  const [attackMsg, setAttackMsg] = useState('')
  const [attackBusy, setAttackBusy] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [finalizeOpen, setFinalizeOpen] = useState(false)
  const captionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    if (!campaignId) return
    let live = await api.live(campaignId)
    if (!live.session) {
      await api.ensureSession(campaignId)
      live = await api.live(campaignId)
    }
    const [t, i, b] = await Promise.all([api.templates(campaignId), api.instances(campaignId), api.bestiary()])
    setSnap(live)
    setTemplates(t.templates)
    setInstances(i.instances)
    setMonsters(b.monsters)
    setSheetId((cur) => cur ?? live.characters[0]?.id ?? null)
  }, [campaignId])

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [load])

  useLive(campaignId, setSnap)

  const instance = snap?.instance
  const selectedCombatant = snap?.combatants.find((c) => c.id === selected)
  const selectedCharacter = selectedCombatant?.source === 'character' ? snap?.characters.find((c) => c.id === selectedCombatant.sourceId) : snap?.characters.find((c) => c.id === selected)
  const selectedMonster = useMemo(() => {
    if (!selectedCombatant || selectedCombatant.source !== 'bestiary') return null
    return monsters.find((m) => m.id === selectedCombatant.sourceId) ?? null
  }, [monsters, selectedCombatant])
  const attackerAttacks = useMemo<Attack[]>(() => {
    if (!selectedCombatant) return []
    if (selectedCombatant.source === 'character') {
      const ch = snap?.characters.find((c) => c.id === selectedCombatant.sourceId)
      return ch?.sheet.attacks ?? []
    }
    if (selectedMonster) return attacksFromMonster(selectedMonster)
    return [{ name: 'Strike', bonus: '+0', damage: '', range: '5 ft.' }]
  }, [selectedCombatant, selectedMonster, snap?.characters])
  const highlightIds = useMemo(() => {
    if (!snap?.map || !pending || !selectedCombatant) return []
    return inRangeCombatantIds(snap.map, snap.tokens, snap.combatants, selectedCombatant.id, pending.attack)
  }, [snap, pending, selectedCombatant])
  const attackTarget = snap?.combatants.find((c) => c.id === targetId)

  function pickAttack(attack: Attack, index: number) {
    setPending({ attack, index })
    setTargetId(null)
    setD20('')
    setD20b('')
    setDamage('')
    setAttackMsg('')
    setTool('select')
  }

  async function submitAttack() {
    if (!instance || !pending || !targetId || !selectedCombatant) return
    const hasAdv = selectedCombatant.advantageAgainst?.includes(targetId)
    const mode = effectiveRollMode(rollMode, Boolean(hasAdv))
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
    setAttackBusy(true)
    try {
      const r = await api.playerAttack(instance.id, {
        attackerId: selectedCombatant.id,
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
      setAttackBusy(false)
    }
  }

  async function startFrom(templateId: string) {
    if (!campaignId) return
    setBusy(true)
    setError('')
    try {
      if (instance && instance.status === 'active') {
        await api.setStatus(instance.id, 'completed')
      }
      const r = await api.startInstance(campaignId, templateId)
      await api.openSession(campaignId, r.instanceId)
      const hub = parseHub(snap?.campaign.hub)
      if (hub.beats.some((b) => b.templateId === templateId)) {
        await api.patchCampaign(campaignId, { hub: markBeatForTemplate(hub, templateId, 'active') })
      }
      setPickerOpen(false)
      setFinalizeOpen(false)
      setPending(null)
      setTargetId(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  async function addPlayer(characterId: string, name: string) {
    if (!instance) return
    const already = snap?.combatants.find((c) => c.source === 'character' && c.sourceId === characterId)
    if (already) {
      setSelected(already.id)
      setError(`${name} is already in this fight.`)
      return
    }
    setBusy(true)
    setError('')
    try {
      await api.addCombatant(instance.id, { characterId })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not add ${name} to the fight.`)
    } finally {
      setBusy(false)
    }
  }

  async function addMonster(bestiaryMonsterId: string) {
    if (!instance) return
    setBusy(true)
    setError('')
    try {
      await api.addCombatant(instance.id, { bestiaryMonsterId })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that monster.')
    } finally {
      setBusy(false)
    }
  }

  async function resume(id: string) {
    if (!campaignId) return
    setBusy(true)
    setError('')
    try {
      await api.setStatus(id, 'active')
      await api.openSession(campaignId, id)
      setPickerOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  async function pause() {
    if (!instance) return
    await api.setStatus(instance.id, 'paused')
    await load()
  }

  async function leaveToTable() {
    if (!campaignId) return
    setBusy(true)
    try {
      if (instance && instance.status === 'active') await api.setStatus(instance.id, 'paused')
      await api.returnToTable(campaignId)
      setPickerOpen(false)
      setFinalizeOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  async function finish(outcome: 'won' | 'lost') {
    if (!campaignId) return
    setBusy(true)
    try {
      await api.finishEncounter(campaignId, outcome)
      setFinalizeOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  async function backToTable() {
    if (!campaignId) return
    setBusy(true)
    try {
      await api.returnToTable(campaignId)
      setPickerOpen(false)
      setFinalizeOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  function onCaption(value: string) {
    if (!campaignId) return
    setSnap((s) => (s?.session ? { ...s, session: { ...s.session, ambianceCaption: value } } : s))
    if (captionTimer.current) clearTimeout(captionTimer.current)
    captionTimer.current = setTimeout(() => {
      api.patchSession(campaignId, { ambianceCaption: value }).catch((e) => setError(e.message))
    }, 400)
  }

  async function onUploadScene(file: File) {
    if (!campaignId) return
    setBusy(true)
    try {
      await api.uploadAmbiance(campaignId, file)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function onClearScene() {
    if (!campaignId) return
    await api.patchSession(campaignId, { ambianceImageUrl: null })
    await load()
  }

  const fogTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function onFog(fog: FogState) {
    if (!instance) return
    setSnap((s) => (s && s.instance ? { ...s, instance: { ...s.instance, fogState: fog } } : s))
    if (fogTimer.current) clearTimeout(fogTimer.current)
    fogTimer.current = setTimeout(() => {
      api.setFog(instance.id, fog).catch(() => undefined)
    }, 80)
  }

  const paused = instances.filter((i) => i.status === 'paused')
  const combat = showCombatStage(snap?.session ?? null, instance ?? null, snap?.map ?? null)
  const outcome = showOutcome(snap?.session ?? null)
  const hubCharacter = snap?.characters.find((c) => c.id === sheetId) ?? snap?.characters[0]

  if (!snap) {
    return <div className="p-8 text-muted">{error || 'Loading the table…'}</div>
  }

  const joinActions = (
    <>
      <div className="rounded-md border border-gold/40 bg-panel px-3 py-1 font-mono text-sm tracking-[0.2em] text-gold-2">
        {snap.session?.joinCode ?? '—'}
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={!snap.session?.joinCode}
        onClick={async () => {
          if (!snap.session?.joinCode) return
          const ok = await copyText(snap.session.joinCode)
          if (!ok) return
          setCopiedJoin(true)
          window.setTimeout(() => setCopiedJoin(false), 1600)
        }}
      >
        {copiedJoin ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copiedJoin ? 'Copied' : 'Copy code'}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => api.openSession(campaignId!, instance?.id ?? null, { rotateJoinCode: true }).then(load)}
      >
        New join code
      </Button>
    </>
  )

  if (!combat || !instance || !snap.map) {
    return (
      <div className="flex h-dvh flex-col bg-bg">
        <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <Link to={`/dm/${campaignId}`} className="font-display text-gold">
            {snap.campaign.name}
          </Link>
          <span className="text-muted">/</span>
          <span>At the table</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">{joinActions}</div>
        </header>
        {error && <p className="border-b border-line px-3 py-2 text-sm text-blood">{error}</p>}
        <TableHub
          campaignName={snap.campaign.name}
          imageUrl={snap.session?.ambianceImageUrl ?? null}
          caption={snap.session?.ambianceCaption ?? ''}
          lastOutcome={snap.session?.lastOutcome ?? null}
          hub={snap.campaign.hub}
          characters={snap.characters}
          selectedId={hubCharacter?.id ?? null}
          onSelectCharacter={setSheetId}
          sheet={
            hubCharacter ? (
              <CharacterSheet character={hubCharacter} canEdit isDm onChange={(patch) => api.patchCharacter(hubCharacter.id, patch)} />
            ) : (
              <p className="text-sm text-muted">Add characters in prep so their sheets sit on this table between fights.</p>
            )
          }
          dm={{
            caption: snap.session?.ambianceCaption ?? '',
            onCaption,
            onUpload: onUploadScene,
            onClearImage: onClearScene,
            hasImage: Boolean(snap.session?.ambianceImageUrl),
            templates,
            paused,
            onStart: startFrom,
            onResume: resume,
            busy,
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <Link to={`/dm/${campaignId}`} className="font-display text-gold">
          {snap.campaign.name}
        </Link>
        <span className="text-muted">/</span>
        <span>{instance.name}</span>
        <span className={cn('rounded-full px-2 py-0.5 text-xs uppercase', instance.status === 'active' ? 'bg-moss/20 text-moss' : 'bg-gold/20 text-gold')}>
          {instance.status}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {joinActions}
          <Button size="sm" variant="outline" disabled={busy} onClick={leaveToTable}>
            Table
          </Button>
          <Button size="sm" variant="outline" disabled={busy || Boolean(outcome)} onClick={() => setPickerOpen(true)}>
            Next encounter
          </Button>
          <Button size="sm" variant="ember" disabled={busy || Boolean(outcome)} onClick={() => setFinalizeOpen(true)}>
            <Trophy className="h-4 w-4" /> Finalize
          </Button>
          {instance.status === 'active' ? (
            <Button size="sm" variant="outline" onClick={pause}>
              <Pause className="h-4 w-4" /> Pause
            </Button>
          ) : (
            <Button size="sm" onClick={() => resume(instance.id)}>
              <Play className="h-4 w-4" /> Resume
            </Button>
          )}
        </div>
      </header>
      {error && <p className="border-b border-line px-3 py-2 text-sm text-blood">{error}</p>}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="w-full shrink-0 border-b border-line p-3 lg:w-80 lg:border-b-0 lg:border-r">
          <Tracker
            combatants={snap.combatants}
            current={instance.currentTurnPosition}
            round={instance.roundNumber}
            isDm
            selectedId={selected}
            onSelect={(id) => {
              setSelected(id)
              const c = snap.combatants.find((x) => x.id === id)
              setPanel(c?.source === 'character' ? 'sheet' : 'stat')
            }}
            onPatch={(id, body) => {
              if (body.turnEconomy) void api.setTurnEconomy(id, body.turnEconomy as { action: boolean; bonus: boolean; reaction: boolean; movement: boolean })
              else void api.patchCombatant(id, body)
            }}
            onNext={() => api.nextTurn(instance.id)}
            onSort={() => api.sortInit(instance.id)}
            onDeathSave={(id, d20v) => {
              void api.deathSave(id, { d20: d20v }).then((r) => {
                setAttackMsg(r.message)
                void load()
              }).catch((e) => setError(e instanceof Error ? e.message : 'Death save failed'))
            }}
            onResetDeath={(id) => {
              void api.resetDeath(id).then(() => load())
            }}
            onReorder={(dir, id) => {
              const ordered = [...snap.combatants].sort((a, b) => a.turnOrderPosition - b.turnOrderPosition)
              const i = ordered.findIndex((c) => c.id === id)
              const j = i + dir
              if (j < 0 || j >= ordered.length) return
              const ids = ordered.map((c) => c.id)
              ;[ids[i], ids[j]] = [ids[j], ids[i]]
              api.reorder(instance.id, ids)
            }}
          />
          <div className="mt-3 flex gap-2">
            <Input
              placeholder="Add monster…"
              value={addQ}
              onChange={(e) => setAddQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                const hit = monsters.find((m) => m.name.toLowerCase().includes(addQ.toLowerCase()))
                if (hit) {
                  void addMonster(hit.id)
                  setAddQ('')
                }
              }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {snap.characters.map((ch) => {
              const onMap = snap.combatants.some((c) => c.source === 'character' && c.sourceId === ch.id)
              return (
                <Button
                  key={ch.id}
                  size="sm"
                  variant={onMap ? 'outline' : 'ghost'}
                  disabled={busy || onMap}
                  onClick={() => void addPlayer(ch.id, ch.name)}
                >
                  {onMap ? `${ch.name} on map` : `+ ${ch.name}`}
                </Button>
              )
            })}
          </div>
        </aside>

        <main className="relative min-h-[45vh] flex-1">
          <MapBoard
            map={snap.map}
            tokens={decorateTokens(snap.tokens, snap.combatants)}
            fog={instance.fogState}
            isDm
            selectedId={targetId ?? selected}
            highlightIds={highlightIds}
            tool={tool}
            onSelect={(id) => {
              if (pending) {
                if (!id) {
                  setTargetId(null)
                  return
                }
                if (!highlightIds.includes(id)) {
                  setAttackMsg('That creature is out of range for this attack.')
                  return
                }
                setTargetId(id)
                setAttackMsg('')
                return
              }
              setSelected(id)
            }}
            onMove={async (id, x, y) => {
              try {
                await api.moveToken(id, { x, y })
                setError('')
              } catch (e) {
                const msg = e instanceof Error ? e.message : 'Could not move'
                setError(msg)
                throw e instanceof Error ? e : new Error(msg)
              }
            }}
            onFog={onFog}
          />
          <div className="absolute left-3 top-3 flex gap-1">
            <Button size="sm" variant={tool === 'select' ? 'default' : 'outline'} onClick={() => setTool('select')}>
              <Sword className="h-4 w-4" /> Move
            </Button>
            <Button
              size="sm"
              variant={tool === 'reveal' ? 'default' : 'outline'}
              onClick={() => {
                if (!instance.fogState.enabled) onFog({ ...instance.fogState, enabled: true, revealed: instance.fogState.revealed.map(() => 0) })
                setTool('reveal')
              }}
            >
              <Eye className="h-4 w-4" /> Reveal
            </Button>
            <Button
              size="sm"
              variant={tool === 'hide' ? 'default' : 'outline'}
              onClick={() => {
                if (!instance.fogState.enabled) onFog({ ...instance.fogState, enabled: true })
                setTool('hide')
              }}
            >
              <EyeOff className="h-4 w-4" /> Hide
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                onFog({
                  ...instance.fogState,
                  enabled: !instance.fogState.enabled,
                })
              }
            >
              Fog {instance.fogState.enabled ? 'on' : 'off'}
            </Button>
          </div>
        </main>

        <aside className="w-full shrink-0 overflow-y-auto border-t border-line p-3 lg:w-[26rem] lg:border-l lg:border-t-0">
          <div className="mb-3 flex gap-1">
            {(['tracker', 'sheet', 'stat'] as const).map((p) => (
              <button
                key={p}
                type="button"
                className={cn('rounded px-2 py-1 text-xs uppercase', panel === p ? 'bg-gold text-bg' : 'text-muted')}
                onClick={() => setPanel(p)}
              >
                {p}
              </button>
            ))}
          </div>
          {panel === 'sheet' && selectedCharacter && (
            <CharacterSheet
              character={selectedCharacter}
              canEdit
              isDm
              onChange={(patch) => api.patchCharacter(selectedCharacter.id, patch)}
            />
          )}
          {panel === 'sheet' && !selectedCharacter && (
            <p className="text-sm text-muted">Select a player token or combatant to open their sheet. Every sheet is visible to the table.</p>
          )}
          {panel === 'stat' && selectedMonster && <StatBlock monster={selectedMonster} />}
          {panel === 'stat' && !selectedMonster && <p className="text-sm text-muted">Select a monster token to open its stat block.</p>}
          {panel === 'tracker' && (
            <p className="text-sm text-muted">
              HP, conditions, and turn order persist with this encounter instance. Pause whenever you want — next session resumes the same fight.
              Condition colors on the tracker match the rings around tokens. Attacks must roll higher than Armor Class; a natural 1 gives the target advantage against the attacker next turn.
            </p>
          )}
        </aside>
      </div>
      {selectedCombatant && (
        <>
          <AttackBar
            attacks={attackerAttacks}
            pendingIndex={pending?.index ?? null}
            onPick={pickAttack}
            onCancel={() => {
              setPending(null)
              setTargetId(null)
              setAttackMsg('')
            }}
            targetName={attackTarget?.name}
            targetAc={attackTarget?.ac}
            hasAdvantage={Boolean(targetId && selectedCombatant.advantageAgainst?.includes(targetId))}
            disabled={!canTakeAttacks(selectedCombatant)}
            disabledReason={
              !canTakeAttacks(selectedCombatant)
                ? selectedCombatant.deathState === 'dead'
                  ? `${selectedCombatant.name} is dead.`
                  : `${selectedCombatant.name} cannot take a normal attack (${selectedCombatant.deathState === 'ok' ? selectedCombatant.conditions.join(', ') || 'incapacitated' : selectedCombatant.deathState}).`
                : undefined
            }
            rollMode={
              targetId && selectedCombatant.advantageAgainst?.includes(targetId) && rollMode === 'normal'
                ? 'advantage'
                : rollMode
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
            busy={attackBusy}
            message={attackMsg}
          />
          <SaveBar combatants={snap.combatants} selectedId={selected} characters={snap.characters} monster={selectedMonster} compact />
        </>
      )}
      {outcome && (
        <EncounterOutcomeOverlay
          outcome={outcome}
          encounterName={instance.name}
          isDm
          busy={busy}
          onReturnToTable={backToTable}
          onNextEncounter={() => setPickerOpen(true)}
        />
      )}
      {finalizeOpen && !outcome && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-label="Finalize encounter">
          <div className="w-full max-w-md rounded-xl border border-line bg-panel p-6 text-center">
            <h2 className="font-display text-2xl text-gold-2">How did it go?</h2>
            <p className="mt-2 text-sm text-muted">
              Players see a victory or defeat on their phones, then you bring everyone back to the table — same join code.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button disabled={busy} onClick={() => finish('won')}>
                <Trophy className="h-4 w-4" /> Won
              </Button>
              <Button disabled={busy} variant="danger" onClick={() => finish('lost')}>
                <Flag className="h-4 w-4" /> Lost
              </Button>
              <Button disabled={busy} variant="ghost" onClick={() => setFinalizeOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-label="Next encounter">
          <div className="max-h-[80dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-panel p-6">
            <h2 className="font-display text-2xl text-gold-2">Next encounter</h2>
            <p className="mt-2 text-sm text-muted">The join code stays. This fight is left behind; the new map opens for everyone at the table.</p>
            {paused.length > 0 && (
              <section className="mt-4">
                <h3 className="text-xs uppercase tracking-wider text-muted">Paused</h3>
                <ul className="mt-2 space-y-2">
                  {paused.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-bg px-3 py-2">
                      <span className="truncate">{i.name}</span>
                      <Button size="sm" disabled={busy} onClick={() => resume(i.id)}>
                        Resume
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <ul className="mt-4 space-y-2">
              {sortTemplates(templates).map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-bg px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate">{t.name}</div>
                    <div className="truncate text-xs text-muted">{t.monsters.map((m) => `${m.quantity}× ${m.name}`).join(', ')}</div>
                  </div>
                  <Button size="sm" variant="ember" disabled={busy} onClick={() => startFrom(t.id)}>
                    Start
                  </Button>
                </li>
              ))}
              {templates.length === 0 && <li className="text-sm text-muted">Build a template in prep first.</li>}
            </ul>
            <div className="mt-4 text-right">
              <Button variant="ghost" onClick={() => setPickerOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
