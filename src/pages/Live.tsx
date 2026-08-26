import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Check, Copy, Eye, EyeOff, Pause, Play, Sword } from 'lucide-react'
import { AttackBar } from '@/components/AttackBar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CharacterSheet } from '@/components/CharacterSheet'
import { MapBoard } from '@/components/map/MapBoard'
import { StatBlock } from '@/components/StatBlock'
import { Tracker } from '@/components/Tracker'
import { api } from '@/lib/api'
import { attacksFromMonster, decorateTokens, inRangeCombatantIds } from '@/lib/combat'
import { useLive } from '@/lib/realtime'
import type { Attack, EncounterInstance, EncounterSnapshot, EncounterTemplate, FogState, Monster } from '@/lib/types'
import { cn } from '@/lib/utils'
import { copyText } from '@/lib/copy'

export function Live() {
  const { campaignId } = useParams()
  const [snap, setSnap] = useState<EncounterSnapshot | null>(null)
  const [templates, setTemplates] = useState<EncounterTemplate[]>([])
  const [instances, setInstances] = useState<EncounterInstance[]>([])
  const [monsters, setMonsters] = useState<Monster[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [panel, setPanel] = useState<'tracker' | 'sheet' | 'stat'>('tracker')
  const [tool, setTool] = useState<'select' | 'reveal' | 'hide'>('select')
  const [addQ, setAddQ] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copiedJoin, setCopiedJoin] = useState(false)
  const [pending, setPending] = useState<{ attack: Attack; index: number } | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [d20, setD20] = useState('')
  const [damage, setDamage] = useState('')
  const [attackMsg, setAttackMsg] = useState('')
  const [attackBusy, setAttackBusy] = useState(false)

  const load = useCallback(async () => {
    if (!campaignId) return
    const [live, t, i, b] = await Promise.all([api.live(campaignId), api.templates(campaignId), api.instances(campaignId), api.bestiary()])
    setSnap(live)
    setTemplates(t.templates)
    setInstances(i.instances)
    setMonsters(b.monsters)
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
    setDamage('')
    setAttackMsg('')
    setTool('select')
  }

  async function submitAttack() {
    if (!instance || !pending || !targetId || !selectedCombatant) return
    const roll = Number(d20)
    const dmg = Number(damage)
    if (!Number.isInteger(roll) || roll < 1 || roll > 20) {
      setAttackMsg('Enter the d20 you rolled at the table (1–20).')
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
        damage: dmg,
      })
      setAttackMsg(r.message)
      if (r.hit) {
        setPending(null)
        setTargetId(null)
        setD20('')
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
    try {
      const r = await api.startInstance(campaignId, templateId)
      await api.openSession(campaignId, r.instanceId)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  async function resume(id: string) {
    if (!campaignId) return
    setBusy(true)
    try {
      await api.setStatus(id, 'active')
      await api.openSession(campaignId, id)
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function pause() {
    if (!instance) return
    await api.setStatus(instance.id, 'paused')
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

  if (!snap) {
    return <div className="p-8 text-muted">{error || 'Loading the table…'}</div>
  }

  if (!instance || !snap.map) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Link to={`/dm/${campaignId}`} className="text-xs uppercase tracking-[0.3em] text-gold">
          Back to prep
        </Link>
        <h1 className="mt-2 font-display text-3xl text-gold-2">Start tonight</h1>
        <p className="mt-2 text-muted">Load a fresh encounter from a template, or resume a fight you paused mid-round.</p>
        {error && <p className="mt-3 text-blood">{error}</p>}
        {paused.length > 0 && (
          <section className="mt-6">
            <h2 className="font-display text-lg text-gold">Paused fights</h2>
            <ul className="mt-2 space-y-2">
              {paused.map((i) => (
                <li key={i.id} className="flex items-center justify-between rounded-lg border border-line bg-panel px-3 py-3">
                  <div>
                    <div>{i.name}</div>
                    <div className="text-xs text-muted">Round {i.roundNumber}</div>
                  </div>
                  <Button disabled={busy} onClick={() => resume(i.id)}>
                    Resume
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="mt-8">
          <h2 className="font-display text-lg text-gold">New encounter</h2>
          <ul className="mt-2 space-y-2">
            {templates.map((t) => (
              <li key={t.id} className="flex items-center justify-between rounded-lg border border-line bg-panel px-3 py-3">
                <div>
                  <div>{t.name}</div>
                  <div className="text-xs text-muted">{t.monsters.map((m) => `${m.quantity}× ${m.name}`).join(', ')}</div>
                  {(t.characters?.length ?? 0) > 0 && (
                    <div className="text-xs text-muted">Starts: {t.characters!.map((c) => c.name).join(', ')}</div>
                  )}
                </div>
                <Button disabled={busy} variant="ember" onClick={() => startFrom(t.id)}>
                  Start
                </Button>
              </li>
            ))}
            {templates.length === 0 && <li className="text-muted">Build an encounter template in prep first.</li>}
          </ul>
        </section>
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
          <Button size="sm" variant="outline" onClick={() => api.openSession(campaignId!, instance.id).then(load)}>
            New join code
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
            onPatch={(id, body) => api.patchCombatant(id, body)}
            onNext={() => api.nextTurn(instance.id)}
            onSort={() => api.sortInit(instance.id)}
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
                  api.addCombatant(instance.id, { bestiaryMonsterId: hit.id })
                  setAddQ('')
                }
              }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {snap.characters.map((ch) => (
              <Button key={ch.id} size="sm" variant="ghost" onClick={() => api.addCombatant(instance.id, { characterId: ch.id })}>
                + {ch.name}
              </Button>
            ))}
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
            onMove={(id, x, y) => api.moveToken(id, { x, y })}
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
            <Button size="sm" variant={tool === 'hide' ? 'default' : 'outline'} onClick={() => setTool('hide')}>
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
          d20={d20}
          damage={damage}
          onD20={setD20}
          onDamage={setDamage}
          onResolve={submitAttack}
          canResolve={Boolean(targetId)}
          busy={attackBusy}
          message={attackMsg}
        />
      )}
    </div>
  )
}
