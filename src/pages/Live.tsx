import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Check, Copy, Eye, EyeOff, Flag, Home, Moon, Pause, Play, Sun, Sword, Trophy } from 'lucide-react'
import { AttackBar } from '@/components/AttackBar'
import { CombatActivityFeed } from '@/components/CombatActivityFeed'
import { InitiativePopup } from '@/components/InitiativePopup'
import { SaveBar } from '@/components/SaveBar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CharacterSheet } from '@/components/CharacterSheet'
import { EncounterOutcomeOverlay } from '@/components/EncounterOutcome'
import { MapBoard } from '@/components/map/MapBoard'
import { StatBlock } from '@/components/StatBlock'
import { StartFightDialog } from '@/components/StartFightDialog'
import { TableHub } from '@/components/TableHub'
import { Tracker } from '@/components/Tracker'
import { api } from '@/lib/api'
import { attacksFromMonster, canTakeAttacks, decorateTokens, effectiveRollMode, hasHiddenAdvantage, inRangeCombatantIds } from '@/lib/combat'
import { LanguageToggle, useT } from '@/lib/i18n'
import { useLive } from '@/lib/realtime'
import { isFightSetup, showCombatStage, showOutcome } from '@/lib/session'
import { ABILITIES, conditionLabelKey, type Ability, type Attack, type EncounterInstance, type EncounterSnapshot, type EncounterTemplate, type FogState, type Monster, type RollMode } from '@/lib/types'
import { cn } from '@/lib/utils'
import { copyText } from '@/lib/copy'
import { adjacentBeat, ambianceFromBeat, emptyBeat, ensureCombatBeatForTemplate, markBeatActive, markBeatForTemplate, markOpeningActive, openingSceneBeat, parseHub, sortTemplates, tableAmbiance } from '@/lib/campaign-hub'
import { asCombatantLike, standingEnemies, type StartFightOpts } from '@/lib/turn-flow'
import { applyLightingFog, coverBonusBetween, fogWithLighting, parseLighting, type Lighting } from '@/lib/vision'

export function Live() {
  const { campaignId } = useParams()
  const { t } = useT()
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
  const [pickerTpl, setPickerTpl] = useState<EncounterTemplate | null>(null)
  const [finalizeOpen, setFinalizeOpen] = useState(false)
  const [lootHolder, setLootHolder] = useState('')
  const [hudTab, setHudTab] = useState<'map' | 'tracker' | 'sheet'>('map')
  const [saveAbility, setSaveAbility] = useState<Ability>('dex')
  const [saveDc, setSaveDc] = useState('13')
  const [initOpen, setInitOpen] = useState(true)
  const captionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hubTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    if (!campaignId) return
    const live = await api.live(campaignId)
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

  const refreshLive = useLive(campaignId, setSnap)

  const instance = snap?.instance
  const selectedCombatant = snap?.combatants.find((c) => c.id === selected)
  const selectedCharacter = selectedCombatant?.source === 'character' ? snap?.characters.find((c) => c.id === selectedCombatant.sourceId) : snap?.characters.find((c) => c.id === selected)
  const selectedMonster = useMemo(() => {
    if (!selectedCombatant || selectedCombatant.source !== 'bestiary') return null
    return snap?.monsters?.find((m) => m.id === selectedCombatant.sourceId) ?? monsters.find((m) => m.id === selectedCombatant.sourceId) ?? null
  }, [monsters, selectedCombatant, snap?.monsters])
  const attackerAttacks = useMemo<Attack[]>(() => {
    if (!selectedCombatant) return []
    if (selectedCombatant.source === 'character') {
      const ch = snap?.characters.find((c) => c.id === selectedCombatant.sourceId)
      return ch?.sheet.attacks ?? []
    }
    if (selectedMonster) return attacksFromMonster(selectedMonster)
    return [{ name: t('live.defaultAttackName'), bonus: '+0', damage: '', range: t('live.defaultAttackRange') }]
  }, [selectedCombatant, selectedMonster, snap?.characters, t])
  const highlightIds = useMemo(() => {
    if (!snap?.map || !pending || !selectedCombatant) return []
    return inRangeCombatantIds(snap.map, snap.tokens, snap.combatants, selectedCombatant.id, pending.attack)
  }, [snap, pending, selectedCombatant])
  const attackTarget = snap?.combatants.find((c) => c.id === targetId)
  const whose = snap?.combatants.find((c) => c.turnOrderPosition === instance?.currentTurnPosition)
  const attackCover =
    snap?.map && selectedCombatant && attackTarget
      ? coverBonusBetween(
          snap.map,
          snap.tokens.find((t) => t.refId === selectedCombatant.id),
          snap.tokens.find((t) => t.refId === attackTarget.id),
        )
      : 0
  const attackHasAdv = Boolean(selectedCombatant && targetId && hasHiddenAdvantage(selectedCombatant, targetId))

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
    const hasAdv = hasHiddenAdvantage(selectedCombatant, targetId)
    const mode = effectiveRollMode(rollMode, Boolean(hasAdv))
    const roll = Number(d20)
    const rollb = Number(d20b)
    const dmg = Number(damage)
    if (!Number.isInteger(roll) || roll < 1 || roll > 20) {
      setAttackMsg(t('playerTurn.enterTableD20Range'))
      return
    }
    if (mode !== 'normal' && (!Number.isInteger(rollb) || rollb < 1 || rollb > 20)) {
      setAttackMsg(t('live.enterBothD20s'))
      return
    }
    if (!Number.isFinite(dmg) || dmg < 0) {
      setAttackMsg(t('live.enterRolledDamage'))
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
      refreshLive()
      if (r.hit) {
        setPending(null)
        setTargetId(null)
        setD20('')
        setD20b('')
        setDamage('')
      }
    } catch (e) {
      setAttackMsg(e instanceof Error ? e.message : t('playerTurn.error.attackFailed'))
    } finally {
      setAttackBusy(false)
    }
  }

  async function startFrom(templateId: string, opts?: StartFightOpts) {
    if (!campaignId) return
    if (instance && instance.status === 'active' && !showOutcome(snap?.session ?? null)) {
      setError(t('live.pauseOrFinalizeBeforeAnother'))
      setPickerOpen(false)
      setPickerTpl(null)
      return
    }
    setBusy(true)
    setError('')
    try {
      const r = await api.startInstance(campaignId, templateId, opts)
      await api.openSession(campaignId, r.instanceId, { tablePhase: 'setup' })
      const hub = parseHub(snap?.campaign.hub)
      const named = templates.find((x) => x.id === templateId)
      const nextHub = markBeatForTemplate(
        ensureCombatBeatForTemplate(hub, { id: templateId, name: named?.name ?? t('outcome.encounter') }),
        templateId,
        'active',
      )
      await api.patchCampaign(campaignId, { hub: nextHub })
      setPickerOpen(false)
      setPickerTpl(null)
      setFinalizeOpen(false)
      setPending(null)
      setTargetId(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('live.failed'))
    } finally {
      setBusy(false)
    }
  }

  async function addPlayer(characterId: string, name: string) {
    if (!instance) return
    const already = snap?.combatants.find((c) => c.source === 'character' && c.sourceId === characterId)
    if (already) {
      setSelected(already.id)
      setError(t('live.characterAlreadyInFight', { name }))
      return
    }
    setBusy(true)
    setError('')
    try {
      await api.addCombatant(instance.id, { characterId })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('live.couldNotAddCharacterToFight', { name }))
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
      setError(e instanceof Error ? e.message : t('live.couldNotAddMonster'))
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
      const pausedInst = instances.find((i) => i.id === id)
      await api.openSession(campaignId, id, {
        tablePhase: pausedInst && pausedInst.roundNumber === 0 ? 'setup' : 'combat',
      })
      setPickerOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('live.failed'))
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
      setError(e instanceof Error ? e.message : t('live.failed'))
    } finally {
      setBusy(false)
    }
  }

  async function finish(outcome: 'won' | 'lost') {
    if (!campaignId) return
    setBusy(true)
    try {
      await api.finishEncounter(campaignId, outcome, { lootHolder: outcome === 'won' ? lootHolder : undefined })
      setFinalizeOpen(false)
      setLootHolder('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('live.failed'))
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
      setError(e instanceof Error ? e.message : t('live.failed'))
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
      setError(e instanceof Error ? e.message : t('campaignHub.uploadFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function onCommitScene(scene: {
    file: File
    name: string
    caption: string
    insertAfterBeatId: string
    saveToCampaign: boolean
  }) {
    if (!campaignId) return
    setBusy(true)
    setError('')
    try {
      const uploaded = await api.uploadStageImage(campaignId, scene.file)
      await api.patchSession(campaignId, {
        ambianceImageUrl: uploaded.imageUrl,
        ambianceCaption: scene.caption,
      })
      if (scene.saveToCampaign) {
        const hub = parseHub(snap?.campaign.hub)
        const beat = emptyBeat({
          id: crypto.randomUUID().slice(0, 8),
          kind: 'social',
          title: scene.name,
          caption: scene.caption,
          imageUrl: uploaded.imageUrl,
          status: 'active',
        })
        const beats = hub.beats.slice()
        if (!scene.insertAfterBeatId) beats.unshift(beat)
        else {
          const idx = beats.findIndex((b) => b.id === scene.insertAfterBeatId)
          if (idx >= 0) beats.splice(idx + 1, 0, beat)
          else beats.push(beat)
        }
        await api.patchCampaign(campaignId, { hub: markBeatActive({ ...hub, beats }, beat.id) })
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('campaignHub.uploadFailed'))
    } finally {
      setBusy(false)
    }
  }

  function onHubChange(next: ReturnType<typeof parseHub>) {
    if (!campaignId) return
    const prevScene = tableAmbiance(parseHub(snap?.campaign.hub), snap?.session)
    const nextScene = tableAmbiance(next, snap?.session)
    setSnap((s) => (s ? { ...s, campaign: { ...s.campaign, hub: next } } : s))
    if (hubTimer.current) clearTimeout(hubTimer.current)
    hubTimer.current = setTimeout(() => {
      api.patchCampaign(campaignId, { hub: next }).catch((e) => setError(e.message))
      if (prevScene.imageUrl !== nextScene.imageUrl || prevScene.caption !== nextScene.caption) {
        api
          .patchSession(campaignId, {
            ambianceImageUrl: nextScene.imageUrl,
            ambianceCaption: nextScene.caption,
          })
          .catch((e) => setError(e.message))
      }
    }, 400)
  }

  async function onClearScene() {
    if (!campaignId) return
    await api.patchSession(campaignId, { ambianceImageUrl: null })
    await load()
  }

  async function onSelectScene(beatId: string) {
    if (!campaignId || !beatId) return
    const hub = markBeatActive(parseHub(snap?.campaign.hub), beatId)
    const beat = hub.beats.find((s) => s.id === beatId)
    if (!beat) return
    const ambiance = ambianceFromBeat(beat)
    setBusy(true)
    try {
      await api.patchCampaign(campaignId, { hub })
      if (ambiance) {
        await api.patchSession(campaignId, {
          ambianceImageUrl: ambiance.imageUrl,
          ambianceCaption: ambiance.caption,
        })
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('live.couldNotSetScene'))
    } finally {
      setBusy(false)
    }
  }

  async function onStepScene(direction: -1 | 1) {
    if (!campaignId) return
    const current = parseHub(snap?.campaign.hub)
    const beat = adjacentBeat(current, direction)
    if (!beat) return
    await onSelectScene(beat.id)
  }

  async function onStartCampaign() {
    if (!campaignId) return
    setBusy(true)
    try {
      await api.ensureSession(campaignId)
      const hub = markOpeningActive(parseHub(snap?.campaign.hub))
      const ambiance = ambianceFromBeat(openingSceneBeat(hub))
      await api.patchCampaign(campaignId, { hub })
      if (ambiance) {
        await api.patchSession(campaignId, {
          ambianceImageUrl: ambiance.imageUrl,
          ambianceCaption: ambiance.caption,
        })
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('live.couldNotStartCampaign'))
    } finally {
      setBusy(false)
    }
  }

  async function onEndCampaign() {
    if (!campaignId) return
    if (!window.confirm(t('live.endTonightTableConfirm'))) return
    setBusy(true)
    try {
      await api.endSession(campaignId)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('live.couldNotEndCampaign'))
    } finally {
      setBusy(false)
    }
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
  const setup = isFightSetup(snap?.session ?? null, instance ?? null)
  const hubCharacter = snap?.characters.find((c) => c.id === sheetId) ?? snap?.characters[0]
  const displayFog = snap ? applyLightingFog(snap) ?? instance?.fogState : instance?.fogState
  const lighting = parseLighting(instance?.fogState.lighting)

  function onLighting(next: Lighting) {
    if (!instance) return
    onFog(fogWithLighting(instance.fogState, next))
  }

  function instanceStatusLabel(status: EncounterInstance['status']) {
    switch (status) {
      case 'active':
        return t('campaignHub.status.active')
      case 'paused':
        return t('live.paused')
      case 'completed':
        return t('campaignHub.status.done')
      default:
        return status
    }
  }

  function deathStateLabel(state: string) {
    switch (state) {
      case 'dead':
        return t('tracker.dead').toLowerCase()
      case 'dying':
        return t('tracker.dying').toLowerCase()
      case 'stable':
        return t('tracker.stable').toLowerCase()
      case 'down':
        return t('tracker.down').toLowerCase()
      default:
        return state
    }
  }

  if (!snap) {
    return <div className="p-8 text-muted">{error || t('live.loadingTable')}</div>
  }

  const stage = tableAmbiance(snap.campaign.hub, snap.session)

  if (!snap.session) {
    return (
      <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-bg">
        <header className="flex items-center gap-2 border-b border-line px-3 py-2">
          <Link to={`/dm/${campaignId}`} className="min-w-0 truncate font-display text-gold">
            {snap.campaign.name}
          </Link>
          <span className="hidden text-muted sm:inline">/</span>
          <span className="hidden truncate sm:inline">{t('live.tableClosed')}</span>
          <LanguageToggle />
        </header>
        {error && <p className="border-b border-line px-3 py-2 text-sm text-blood">{error}</p>}
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <h1 className="font-display text-3xl text-gold-2">{t('live.tonightsTableClosed')}</h1>
          <p className="max-w-md text-sm text-muted">
            {t('live.closedTableBlurb')}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button disabled={busy} onClick={() => void onStartCampaign()}>
              {t('prep.openLive')}
            </Button>
            <Button variant="outline" asChild>
              <Link to={`/dm/${campaignId}`}>{t('live.backToPrep')}</Link>
            </Button>
          </div>
        </div>
      </div>
    )
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
        {copiedJoin ? t('sheet.copied') : t('live.copyCode')}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => api.openSession(campaignId!, instance?.id ?? null, { rotateJoinCode: true }).then(load)}
      >
        {t('live.newJoinCode')}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onEndCampaign()}>
        {t('prep.endLive')}
      </Button>
    </>
  )

  if (!combat || !instance || !snap.map) {
    return (
      <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-bg">
        <header className="shrink-0 border-b border-line">
          <div className="flex items-center gap-2 px-3 py-2">
            <Link to={`/dm/${campaignId}`} className="min-w-0 truncate font-display text-gold">
              {snap.campaign.name}
            </Link>
            <span className="hidden text-muted sm:inline">/</span>
            <span className="hidden truncate sm:inline">{stage.caption || t('campaignHub.atTheTable')}</span>
            <div className="ml-auto hidden items-center gap-2 lg:flex">{joinActions}</div>
          </div>
          <div className="flex gap-2 overflow-x-auto px-3 pb-2 lg:hidden">{joinActions}</div>
        </header>
        {error && <p className="border-b border-line px-3 py-2 text-sm text-blood">{error}</p>}
        <TableHub
          campaignName={snap.campaign.name}
          imageUrl={stage.imageUrl}
          caption={stage.caption}
          lastOutcome={snap.session?.lastOutcome ?? null}
          hub={snap.campaign.hub}
          characters={snap.characters}
          selectedId={hubCharacter?.id ?? null}
          onSelectCharacter={setSheetId}
          sheet={
            hubCharacter ? (
              <CharacterSheet character={hubCharacter} canEdit isDm onChange={(patch) => api.patchCharacter(hubCharacter.id, patch)} />
            ) : (
              <p className="text-sm text-muted">{t('live.addCharactersInPrep')}</p>
            )
          }
          dm={{
            caption: snap.session?.ambianceCaption ?? stage.caption,
            onCaption,
            onUpload: onUploadScene,
            onCommitScene,
            onClearImage: onClearScene,
            hasImage: Boolean(stage.imageUrl),
            templates,
            paused,
            onStart: startFrom,
            onResume: resume,
            busy,
            activeFight: Boolean(instance && instance.status === 'active'),
            onSelectScene,
            onStepScene,
            onStartCampaign,
            onHubChange,
            onUploadStage: async (file) => {
              const r = await api.uploadStageImage(campaignId!, file)
              return r.imageUrl
            },
          }}
          onShortRest={(characterId, hpCurrent) => {
            const ch = snap.characters.find((c) => c.id === characterId)
            if (!ch) return
            void api.patchCharacter(characterId, { sheet: { ...ch.sheet, hpCurrent } }).then(load)
          }}
        />
      </div>
    )
  }

  const tableActions = (
    <>
      <Button size="sm" variant="outline" disabled={busy} onClick={leaveToTable} title={t('live.pauseReturnHubTitle')}>
        {t('live.table')}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy || Boolean(outcome) || (instance.status === 'active' && !outcome)}
        title={instance.status === 'active' ? t('live.pauseOrFinalizeFirstTitle') : t('live.startNextTemplateTitle')}
        onClick={() => setPickerOpen(true)}
      >
        {t('outcome.nextEncounter')}
      </Button>
      <Button size="sm" variant="ember" disabled={busy || Boolean(outcome)} onClick={() => setFinalizeOpen(true)}>
        <Trophy className="h-4 w-4" /> {t('live.finalize')}
      </Button>
      {instance.status === 'active' ? (
        <Button size="sm" variant="outline" onClick={pause}>
          <Pause className="h-4 w-4" /> {t('live.pause')}
        </Button>
      ) : (
        <Button size="sm" onClick={() => resume(instance.id)}>
          <Play className="h-4 w-4" /> {t('tableHub.resume')}
        </Button>
      )}
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onEndCampaign()}>
        {t('prep.endLive')}
      </Button>
    </>
  )

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-bg">
      <header className="shrink-0 border-b border-line bg-panel-2/30">
        <div className="flex items-center gap-3 px-4 py-3">
          <Link to={`/dm/${campaignId}`} className="min-w-0 truncate font-display text-gold-2 text-sm">
            {snap.campaign.name}
          </Link>
          <span className="hidden text-muted sm:inline">/</span>
          <span className="hidden min-w-0 truncate sm:inline text-sm">{instance.name}</span>
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs uppercase font-medium', setup ? 'bg-gold/20 text-gold' : instance.status === 'active' ? 'bg-moss/20 text-moss' : 'bg-gold/20 text-gold')}>
            {setup ? t('live.setup') : instanceStatusLabel(instance.status)}
          </span>
          <div className="ml-auto hidden items-center gap-2 lg:flex">
            <LanguageToggle />
            {joinActions}
            {tableActions}
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto px-4 pb-3 lg:hidden">
          <LanguageToggle />
          {joinActions}
          {tableActions}
        </div>
      </header>
      {error && <p className="shrink-0 border-b border-line bg-blood/10 px-4 py-2 text-sm text-blood">{error}</p>}
      {setup && !outcome && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-gold/5 px-4 py-2.5 text-sm">
          <span className="flex-1 text-muted">{t('live.rollInitiativeBanner')}</span>
          <Button size="sm" variant="outline" onClick={() => setInitOpen(true)} className="h-8 px-3 text-xs">
            {t('init.open')}
          </Button>
        </div>
      )}
      {!setup && !outcome && standingEnemies((snap.combatants ?? []).map(asCombatantLike)).length === 0 && snap.combatants.some((c) => c.source === 'bestiary') && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-gold/5 px-4 py-2.5 text-sm">
          <span className="text-muted">{t('live.noStandingEnemies')}</span>
          <Button size="sm" variant="ember" disabled={busy} onClick={() => setFinalizeOpen(true)} className="h-8 px-3 text-xs">
            {t('live.finalize')}
          </Button>
        </div>
      )}

      <div className="flex shrink-0 gap-1 border-b border-line bg-panel-2/30 px-3 py-2 lg:hidden">
        {(['map', 'tracker', 'sheet'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            className={cn('min-h-9 rounded-lg px-3 py-1.5 text-xs capitalize font-medium transition-colors', hudTab === tab ? 'bg-gold text-bg' : 'text-muted hover:text-ink')}
            onClick={() => setHudTab(tab)}
          >
            {tab === 'map' ? t('player.map') : tab === 'tracker' ? t('player.tracker') : t('live.sheet')}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside
          className={cn(
            'min-h-0 w-full flex-col overflow-y-auto border-line bg-panel/30 lg:flex lg:w-80 lg:shrink-0 lg:flex-none lg:overflow-hidden lg:border-r',
            hudTab === 'tracker' ? 'flex min-h-0 flex-1' : 'hidden lg:flex',
          )}
        >
          <div className="min-h-0 lg:flex-1 lg:overflow-hidden">
          <Tracker
            combatants={snap.combatants}
            current={instance.currentTurnPosition}
            round={instance.roundNumber}
            isDm
            setup={setup}
            selectedId={selected}
            onSelect={(id) => {
              setSelected(id)
              const c = snap.combatants.find((x) => x.id === id)
              setPanel(c?.source === 'character' ? 'sheet' : 'stat')
            }}
            onPatch={(id, body) => {
              setSnap((s) =>
                s
                  ? {
                      ...s,
                      combatants: s.combatants.map((c) => (c.id === id ? { ...c, ...body } : c)),
                    }
                  : s,
              )
              const done = () => refreshLive()
              if (body.turnEconomy) void api.setTurnEconomy(id, body.turnEconomy as { action: boolean; bonus: boolean; reaction: boolean; movement: boolean }).then(done)
              else void api.patchCombatant(id, body).then(done)
            }}
            onNext={() => {
              void api.nextTurn(instance.id, { expectedTurnPosition: instance.currentTurnPosition }).then(() => refreshLive())
            }}
            onSkip={() => {
              void api.nextTurn(instance.id, { expectedTurnPosition: instance.currentTurnPosition }).then(() => refreshLive())
            }}
            onBeginRound={() => {
              if (!campaignId) return
              void api.beginRound(campaignId).then(() => refreshLive()).catch((e) => setError(e instanceof Error ? e.message : t('live.couldNotBegin')))
            }}
            onSort={() => {
              void api.sortInit(instance.id, { keepCurrent: !setup }).then(() => refreshLive())
            }}
            onRemove={(id) => {
              void api.removeCombatant(id).then(() => refreshLive()).catch((e) => setError(e instanceof Error ? e.message : t('live.couldNotRemove')))
            }}
            onDeathSave={(id, d20v) => {
              void api.deathSave(id, { d20: d20v }).then((r) => {
                setAttackMsg(r.message)
                refreshLive()
              }).catch((e) => setError(e instanceof Error ? e.message : t('player.deathSaveFailed')))
            }}
            onResetDeath={(id) => {
              void api.resetDeath(id).then(() => refreshLive())
            }}
            onReorder={(dir, id) => {
              const ordered = [...snap.combatants].sort((a, b) => a.turnOrderPosition - b.turnOrderPosition)
              const i = ordered.findIndex((c) => c.id === id)
              const j = i + dir
              if (j < 0 || j >= ordered.length) return
              const ids = ordered.map((c) => c.id)
              ;[ids[i], ids[j]] = [ids[j], ids[i]]
              api.reorder(instance.id, ids).then(() => refreshLive())
            }}
          />
          </div>
          <div className="shrink-0 lg:max-h-[42%] lg:overflow-y-auto">
          {selectedCombatant?.source === 'character' && (
            <div className="mt-3 space-y-2 rounded-lg border border-line bg-panel/50 p-2.5">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  void api
                    .setPrompt(instance.id, { kind: 'reaction', combatantId: selectedCombatant.id })
                    .then(() => refreshLive())
                    .catch((e) => setError(e instanceof Error ? e.message : t('live.couldNotRequestReaction')))
                }}
                className="h-8 px-3 text-xs"
              >
                {t('live.requestReaction')}
              </Button>
              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  className="h-8 rounded-lg border border-line bg-bg px-2 text-xs focus:border-gold focus:outline-none"
                  value={saveAbility}
                  onChange={(e) => setSaveAbility(e.target.value as Ability)}
                  aria-label={t('live.saveAbility')}
                >
                  {ABILITIES.map((ab) => (
                    <option key={ab} value={ab}>
                      {t(`ability.${ab}`)}
                    </option>
                  ))}
                </select>
                <Input className="h-8 w-16" inputMode="numeric" placeholder={t('check.dc')} value={saveDc} onChange={(e) => setSaveDc(e.target.value)} aria-label={t('sheet.spellDc')} />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    const dc = Number(saveDc)
                    if (!Number.isInteger(dc) || dc < 1) {
                      setError(t('live.enterDc'))
                      return
                    }
                    void api
                      .setPrompt(instance.id, { kind: 'save', combatantId: selectedCombatant.id, ability: saveAbility, dc })
                      .then(() => refreshLive())
                      .catch((e) => setError(e instanceof Error ? e.message : t('live.couldNotRequestSave')))
                  }}
                  className="h-8 px-3 text-xs"
                >
                  {t('live.requestSave')}
                </Button>
              </div>
            </div>
          )}
          <CombatActivityFeed items={instance.activity ?? []} />
          {(() => {
            const tpl = templates.find((t) => t.id === instance.encounterTemplateId)
            const brief = [tpl?.difficulty, tpl?.objective, tpl?.notes].filter(Boolean).join(' · ')
            if (!brief) return null
            return <p className="mt-2.5 text-xs text-muted">{brief}</p>
          })()}
          <div className="mt-3 flex gap-2">
            <Input
              placeholder={t('live.addMonster')}
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
              className="h-8"
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
                  {onMap ? t('live.characterOnMap', { name: ch.name }) : t('live.addCharacter', { name: ch.name })}
                </Button>
              )
            })}
          </div>
          </div>
        </aside>

        <main className={cn('relative min-h-0 flex-1', hudTab === 'map' ? 'block' : 'hidden lg:block')}>
          <MapBoard
            map={snap.map}
            tokens={decorateTokens(snap.tokens, snap.combatants)}
            fog={displayFog ?? instance.fogState}
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
                  setAttackMsg(t('live.attackTargetOutOfRange'))
                  return
                }
                setTargetId(id)
                setAttackMsg('')
                return
              }
              setSelected(id)
            }}
            onMove={async (id, x, y) => {
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
                const msg = e instanceof Error ? e.message : t('player.couldNotMove')
                setError(msg)
                throw e instanceof Error ? e : new Error(msg)
              }
            }}
            onFog={onFog}
          />
          <div className="absolute left-2 top-2 z-10 flex max-w-[calc(100%-3.5rem)] flex-wrap gap-1">
            <Button size="sm" variant={tool === 'select' ? 'default' : 'outline'} onClick={() => setTool('select')}>
              <Sword className="h-4 w-4" /> {t('map.move')}
            </Button>
            <Button
              size="sm"
              variant={lighting === 'day' ? 'default' : 'outline'}
              onClick={() => onLighting('day')}
            >
              <Sun className="h-4 w-4" /> {t('map.day')}
            </Button>
            <Button
              size="sm"
              variant={lighting === 'night' ? 'default' : 'outline'}
              onClick={() => onLighting('night')}
            >
              <Moon className="h-4 w-4" /> {t('map.night')}
            </Button>
            <Button
              size="sm"
              variant={lighting === 'interior' ? 'default' : 'outline'}
              onClick={() => onLighting('interior')}
            >
              <Home className="h-4 w-4" /> {t('map.interior')}
            </Button>
            <Button
              size="sm"
              variant={tool === 'reveal' ? 'default' : 'outline'}
              onClick={() => {
                if (!instance.fogState.enabled) onFog({ ...instance.fogState, enabled: true, revealed: instance.fogState.revealed.map(() => 0) })
                setTool('reveal')
              }}
            >
              <Eye className="h-4 w-4" /> {t('map.reveal')}
            </Button>
            <Button
              size="sm"
              variant={tool === 'hide' ? 'default' : 'outline'}
              onClick={() => {
                if (!instance.fogState.enabled) onFog({ ...instance.fogState, enabled: true })
                setTool('hide')
              }}
            >
              <EyeOff className="h-4 w-4" /> {t('map.hide')}
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
              {instance.fogState.enabled ? t('map.fogOn') : t('map.fogOff')}
            </Button>
          </div>
        </main>

        <aside
          className={cn(
            'min-h-0 min-w-0 w-full overflow-y-auto overflow-x-hidden border-line p-3 lg:block lg:w-[26rem] lg:shrink-0 lg:flex-none lg:border-l',
            hudTab === 'sheet' ? 'block min-h-0 flex-1' : 'hidden lg:block',
          )}
        >
          <div className="mb-3 flex gap-1">
            {(['tracker', 'sheet', 'stat'] as const).map((p) => (
              <button
                key={p}
                type="button"
                className={cn('rounded px-2 py-1 text-xs uppercase', panel === p ? 'bg-gold text-bg' : 'text-muted')}
                onClick={() => setPanel(p)}
              >
                {t(`live.${p}`)}
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
            <p className="text-sm text-muted">{t('live.selectSheet')}</p>
          )}
          {panel === 'stat' && selectedMonster && <StatBlock monster={selectedMonster} />}
          {panel === 'stat' && !selectedMonster && <p className="text-sm text-muted">{t('live.selectStat')}</p>}
          {panel === 'tracker' && (
            <p className="text-sm text-muted">{t('live.trackerHint')}</p>
          )}
        </aside>
      </div>
      {selectedCombatant && (
        <div className="max-h-[38vh] shrink-0 overflow-y-auto pb-[env(safe-area-inset-bottom)] lg:max-h-[28vh]">
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
            targetAc={attackTarget ? attackTarget.ac + attackCover : undefined}
            coverBonus={attackCover}
            hasAdvantage={attackHasAdv}
            disabled={!canTakeAttacks(selectedCombatant)}
            disabledReason={
              !canTakeAttacks(selectedCombatant)
                ? selectedCombatant.deathState === 'dead'
                  ? t('live.combatantDead', { name: selectedCombatant.name })
                  : t('live.cannotTakeNormalAttack', {
                      name: selectedCombatant.name,
                      reason: selectedCombatant.deathState === 'ok' ? selectedCombatant.conditions.map((c) => t(conditionLabelKey(c))).join(', ') || t('live.incapacitated') : deathStateLabel(selectedCombatant.deathState),
                    })
                : undefined
            }
            rollMode={
              attackHasAdv && rollMode === 'normal'
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
          <SaveBar
            combatants={snap.combatants}
            selectedId={selected}
            characters={snap.characters}
            monster={selectedMonster}
            compact
            instanceId={instance.id}
            map={snap.map}
            tokens={snap.tokens}
            monsters={snap.monsters ?? monsters}
            originId={whose?.id ?? selected}
            onSettled={refreshLive}
          />
        </div>
      )}
      {setup && initOpen && campaignId && (
        <InitiativePopup
          instanceId={instance.id}
          campaignId={campaignId}
          combatants={snap.combatants}
          characters={snap.characters}
          isDm
          onSettled={refreshLive}
          onClose={() => setInitOpen(false)}
        />
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
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-label={t('live.finalizeEncounter')}>
          <div className="w-full max-w-md rounded-xl border border-line bg-panel p-6 text-center">
            <h2 className="font-display text-2xl text-gold-2">{t('live.howDidItGo')}</h2>
            <p className="mt-2 text-sm text-muted">
              {t('live.finalizeBlurb')}
            </p>
            {snap.characters.length > 0 && (
              <label className="mt-4 block text-left text-sm">
                {t('live.lootHolderOptional')}
                <select
                  className="mt-1 h-9 w-full rounded-md border border-line bg-bg px-2"
                  value={lootHolder}
                  onChange={(e) => setLootHolder(e.target.value)}
                >
                  <option value="">{t('live.partyUnassigned')}</option>
                  {snap.characters.map((ch) => (
                    <option key={ch.id} value={ch.name}>
                      {ch.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button disabled={busy} onClick={() => finish('won')}>
                <Trophy className="h-4 w-4" /> {t('outcome.victory')}
              </Button>
              <Button disabled={busy} variant="danger" onClick={() => finish('lost')}>
                <Flag className="h-4 w-4" /> {t('outcome.defeat')}
              </Button>
              <Button disabled={busy} variant="ghost" onClick={() => setFinalizeOpen(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        </div>
      )}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-label={t('outcome.nextEncounter')}>
          <div className="max-h-[80dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-panel p-6">
            <h2 className="font-display text-2xl text-gold-2">{t('outcome.nextEncounter')}</h2>
            <p className="mt-2 text-sm text-muted">
              {t('live.nextEncounterBlurb')}
            </p>
            {paused.length > 0 && (
              <section className="mt-4">
                <h3 className="text-xs uppercase tracking-wider text-muted">{t('live.paused')}</h3>
                <ul className="mt-2 space-y-2">
                  {paused.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-bg px-3 py-2">
                      <span className="truncate">{i.name}</span>
                      <Button size="sm" disabled={busy} onClick={() => resume(i.id)}>
                        {t('tableHub.resume')}
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <ul className="mt-4 space-y-2">
              {sortTemplates(templates).map((tpl) => (
                <li key={tpl.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-bg px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate">{tpl.name}</div>
                    <div className="truncate text-xs text-muted">{tpl.monsters.map((m) => `${m.quantity}× ${m.name}`).join(', ')}</div>
                  </div>
                  <Button size="sm" variant="ember" disabled={busy} onClick={() => setPickerTpl(tpl)}>
                    {t('landing.start')}
                  </Button>
                </li>
              ))}
              {templates.length === 0 && <li className="text-sm text-muted">{t('live.buildTemplateInPrep')}</li>}
            </ul>
            <div className="mt-4 text-right">
              <Button variant="ghost" onClick={() => setPickerOpen(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        </div>
      )}
      {pickerTpl && (
        <StartFightDialog
          template={pickerTpl}
          characters={snap.characters}
          busy={busy}
          warnActiveFight={instance.status === 'active' && !outcome}
          onCancel={() => setPickerTpl(null)}
          onConfirm={(opts) => {
            void startFrom(pickerTpl.id, opts)
          }}
        />
      )}
    </div>
  )
}
