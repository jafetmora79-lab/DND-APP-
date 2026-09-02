import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RollInputModal } from '@/components/RollInputModal'
import { ActionEconomyBar } from '@/components/ActionEconomyBar'
import { TurnIndicator } from '@/components/TurnIndicator'
import { api } from '@/lib/api'
import { attackOutcome, canTakeAttacks, characterSaveBonus, effectiveRollMode, hasHiddenAdvantage, parseAttackBonus, pickUsedD20 } from '@/lib/combat'
import { OTHER_ACTION_LABELS } from '@/lib/combat-activity'
import { canAttemptHide, hideDcFor } from '@/lib/stealth'
import { ABILITY_LABELS, type Ability, type Attack, type BattleMap, type CombatPrompt, type CombatSpendSlot, type Combatant, type MapToken, type Monster, type PlayerCharacter, type RollMode } from '@/lib/types'
import { cn, proficiencyBonus } from '@/lib/utils'
import { coverBonusBetween } from '@/lib/vision'

export type MapPickMode = 'select' | 'attack' | 'help'

type Menu = null | 'action' | 'bonus' | 'reaction' | 'other' | 'help' | 'attack' | 'custom' | 'hide'
type AttackStep = 'pick' | 'target' | 'roll' | 'damage'
type ModalType = null | 'initiative' | 'save' | 'hide' | 'attack-d20' | 'attack-damage'

const DECLARE_KINDS = [
  { kind: 'attack', label: 'Attack' },
  { kind: 'dash', label: 'Dash' },
  { kind: 'dodge', label: 'Dodge' },
  { kind: 'help', label: 'Help' },
  { kind: 'disengage', label: 'Disengage' },
  { kind: 'hide', label: 'Hide' },
  { kind: 'other', label: 'Other' },
] as const

type Props = {
  instanceId: string
  character: PlayerCharacter
  combatant: Combatant | undefined
  whose: Combatant | undefined
  combatants: Combatant[]
  prompt: CombatPrompt
  selectedId: string | null
  onSelectedId: (id: string | null) => void
  onMapPick: (mode: MapPickMode) => void
  launchAttack?: { attack: Attack; index: number } | null
  onLaunchHandled?: () => void
  onSettled?: () => void
  setup?: boolean
  currentTurnPosition?: number
  map?: BattleMap | null
  tokens?: MapToken[]
  monsters?: Monster[]
}

export function PlayerTurnPanel({
  instanceId,
  character,
  combatant,
  whose,
  combatants,
  prompt,
  selectedId,
  onSelectedId,
  onMapPick,
  launchAttack,
  onLaunchHandled,
  onSettled,
  setup,
  currentTurnPosition,
  map,
  tokens = [],
  monsters = [],
}: Props) {
  const myTurn = Boolean(combatant && whose && whose.id === combatant.id)
  const [menu, setMenu] = useState<Menu>(null)
  const [slot, setSlot] = useState<CombatSpendSlot>('action')
  const [step, setStep] = useState<AttackStep>('pick')
  const [pending, setPending] = useState<{ attack: Attack; index: number } | null>(null)
  const [rollMode, setRollMode] = useState<RollMode>('normal')
  const [d20, setD20] = useState('')
  const [d20b, setD20b] = useState('')
  const [damage, setDamage] = useState('')
  const [custom, setCustom] = useState('')
  const [reactionNote, setReactionNote] = useState('')
  const [saveD20, setSaveD20] = useState('')
  const [initD20, setInitD20] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [modalType, setModalType] = useState<ModalType>(null)

  const others = combatants.filter((c) => c.id !== combatant?.id)
  const target = combatants.find((c) => c.id === selectedId)
  const namedAttacks = character.sheet.attacks.map((atk, i) => ({ atk, i })).filter(({ atk }) => atk.name.trim())
  const minePrompt = Boolean(prompt && combatant && prompt.combatantId === combatant.id)
  const econ = combatant?.turnEconomy
  const canAct = combatant ? canTakeAttacks(combatant) : false

  useEffect(() => {
    if (!launchAttack) return
    startAttack(launchAttack.attack, launchAttack.index)
    onLaunchHandled?.()
  }, [launchAttack])

  useEffect(() => {
    if (menu === 'attack' && step === 'target') onMapPick('attack')
    else if (menu === 'help') onMapPick('help')
    else onMapPick('select')
  }, [menu, step, onMapPick])

  function resetMenus() {
    setMenu(null)
    setStep('pick')
    setPending(null)
    setD20('')
    setD20b('')
    setDamage('')
    setCustom('')
    setRollMode('normal')
    setModalType(null)
    onSelectedId(null)
  }

  function startAttack(attack: Attack, index: number) {
    setSlot('action')
    setMenu('attack')
    setStep('target')
    setPending({ attack, index })
    setD20('')
    setD20b('')
    setDamage('')
    setMsg('')
    onSelectedId(null)
    const hasAdv = Boolean(selectedId && combatant && hasHiddenAdvantage(combatant, selectedId))
    setRollMode(hasAdv ? 'advantage' : 'normal')
  }

  async function declare(kind: string, extra?: { targetId?: string; other?: string; custom?: string; d20?: number }) {
    setBusy(true)
    try {
      const r = await api.declareAction(instanceId, {
        kind,
        slot,
        combatantId: combatant?.id,
        targetId: extra?.targetId,
        other: extra?.other,
        custom: extra?.custom,
        d20: extra?.d20,
      })
      setMsg(r.text)
      resetMenus()
      onSettled?.()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not declare')
    } finally {
      setBusy(false)
    }
  }

  function openSlot(next: CombatSpendSlot) {
    setSlot(next)
    setMenu(next === 'reaction' ? 'reaction' : next === 'bonus' ? 'bonus' : 'action')
    setMsg('')
  }

  function onKind(kind: string) {
    if (kind === 'attack') {
      setMenu('attack')
      setStep('pick')
      setPending(null)
      return
    }
    if (kind === 'help') {
      setMenu('help')
      onSelectedId(null)
      return
    }
    if (kind === 'other') {
      setMenu('other')
      return
    }
    if (kind === 'hide') {
      setMenu('hide')
      setD20('')
      setMsg('')
      return
    }
    void declare(kind)
  }

  const hasAdv = Boolean(target && combatant && hasHiddenAdvantage(combatant, target.id))
  const mode = effectiveRollMode(rollMode, hasAdv)
  const coverBonus =
    map && combatant && target
      ? coverBonusBetween(
          map,
          tokens.find((t) => t.refId === combatant.id),
          tokens.find((t) => t.refId === target.id),
        )
      : 0
  const previewAc = target ? target.ac + coverBonus : 0
  const preview = useMemo(() => {
    if (!pending || !target) return null
    const roll = Number(d20)
    const rollb = Number(d20b)
    if (!Number.isInteger(roll) || roll < 1 || roll > 20) return null
    if (mode !== 'normal' && (!Number.isInteger(rollb) || rollb < 1 || rollb > 20)) return null
    const bonus = parseAttackBonus(pending.attack.bonus)
    const dice = pickUsedD20(roll, mode === 'normal' ? undefined : rollb, mode)
    const outcome = attackOutcome(dice.used, bonus, previewAc)
    const total = dice.used + bonus
    return { outcome, total, bonus, used: dice.used }
  }, [pending, target, d20, d20b, mode, previewAc])

  async function submitAttack(dmg: number) {
    if (!pending || !selectedId) return
    const roll = Number(d20)
    const rollb = Number(d20b)
    setBusy(true)
    try {
      const r = await api.playerAttack(instanceId, {
        attackerId: combatant?.id,
        targetId: selectedId,
        attackIndex: pending.index,
        d20: roll,
        d20b: mode === 'normal' ? undefined : rollb,
        rollMode: mode,
        damage: dmg,
      })
      setMsg(r.message)
      resetMenus()
      onSettled?.()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Attack failed')
    } finally {
      setBusy(false)
    }
  }

  function continueFromRoll() {
    if (!preview) {
      setMsg(mode === 'normal' ? 'Enter the d20 you rolled at the table (1–20).' : 'Enter both d20s for advantage or disadvantage.')
      return
    }
    if (preview.outcome === 'miss' || preview.outcome === 'fumble') {
      void submitAttack(0)
      return
    }
    setStep('damage')
    setModalType('attack-damage')
  }

  async function endTurn() {
    setBusy(true)
    try {
      await api.nextTurn(instanceId, { expectedTurnPosition: currentTurnPosition })
      resetMenus()
      setMsg('')
      onSettled?.()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not end turn')
    } finally {
      setBusy(false)
    }
  }

  async function answerSave() {
    const roll = Number(saveD20)
    setBusy(true)
    try {
      const r = await api.answerPrompt(instanceId, { d20: roll })
      setMsg(r.message || '')
      setSaveD20('')
      setModalType(null)
      onSettled?.()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not submit save')
    } finally {
      setBusy(false)
    }
  }

  async function answerReaction(use: boolean) {
    setBusy(true)
    try {
      await api.answerPrompt(instanceId, { use, other: reactionNote })
      setReactionNote('')
      setMsg(use ? 'Reaction used.' : 'Reaction declined.')
      onSettled?.()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not answer')
    } finally {
      setBusy(false)
    }
  }

  const saveMod =
    prompt?.kind === 'save'
      ? characterSaveBonus(
          character.sheet.abilities[(prompt.ability ?? 'dex') as Ability] ?? 10,
          Boolean(character.sheet.savingThrowProf[(prompt.ability ?? 'dex') as Ability]),
          proficiencyBonus(character.sheet.level),
        )
      : 0

  const hideGate = combatant && map ? canAttemptHide(combatant, combatants, tokens, map) : null
  const hideDc = combatant ? hideDcFor(combatant, combatants, [character], monsters) : 10
  const declareList = slot === 'action' ? DECLARE_KINDS : DECLARE_KINDS.filter((k) => k.kind !== 'attack')

  return (
    <div className="border-t border-line bg-panel px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <TurnIndicator current={whose} myTurn={myTurn} combatantName={combatant?.name ?? character.name} setup={setup} />
        {combatant && <ActionEconomyBar combatant={combatant} />}
      </div>

      {setup && combatant && (
        <div className="mt-2 rounded-lg border border-gold/40 bg-panel/50 px-3 py-3">
          <div className="text-xs uppercase tracking-wider text-gold font-semibold">Your initiative</div>
          <p className="mt-1 text-sm text-muted">
            Current total {combatant.initiative}. Enter the d20 from the table; Dex {character.sheet.initiativeBonus ?? ''} is added.
          </p>
          <div className="mt-3 flex justify-center">
            <Button
              size="default"
              disabled={busy}
              onClick={() => setModalType('initiative')}
            >
              Roll Initiative
            </Button>
          </div>
        </div>
      )}

      {minePrompt && prompt?.kind === 'save' && (
        <div className="mt-2 rounded-lg border border-gold/50 bg-panel/50 px-3 py-3">
          <div className="text-xs uppercase tracking-wider text-gold font-semibold">Saving throw</div>
          <p className="mt-1 text-sm">
            {ABILITY_LABELS[(prompt.ability ?? 'dex') as Ability]} DC {prompt.dc ?? 13} · mod {saveMod >= 0 ? `+${saveMod}` : saveMod}
          </p>
          <div className="mt-3 flex justify-center">
            <Button size="default" disabled={busy} onClick={() => setModalType('save')}>
              Roll Save
            </Button>
          </div>
        </div>
      )}

      {minePrompt && prompt?.kind === 'reaction' && (
        <div className="mt-2 rounded-lg border border-gold/50 bg-panel/50 px-3 py-3">
          <div className="text-xs uppercase tracking-wider text-gold font-semibold">Reaction requested</div>
          <Input className="mt-2 h-10" placeholder="Optional note or attack name" value={reactionNote} onChange={(e) => setReactionNote(e.target.value)} />
          <div className="mt-3 flex flex-col gap-2 sm:flex-row justify-center">
            <Button size="default" disabled={busy} onClick={() => void answerReaction(true)}>
              Use reaction
            </Button>
            <Button size="default" variant="outline" disabled={busy} onClick={() => void answerReaction(false)}>
              Decline
            </Button>
          </div>
        </div>
      )}

      {myTurn && combatant && !setup && (
        <>
          <div className="mt-3 flex flex-wrap gap-2 justify-center">
            <Button variant={menu === 'action' || menu === 'attack' || menu === 'hide' || (menu === 'other' && slot === 'action') || menu === 'help' ? 'default' : 'outline'} disabled={Boolean(econ?.action)} onClick={() => openSlot('action')} size="default">
              Action
            </Button>
            <Button variant={menu === 'bonus' || (menu === 'other' && slot === 'bonus') ? 'default' : 'outline'} disabled={Boolean(econ?.bonus)} onClick={() => openSlot('bonus')} size="default">
              Bonus action
            </Button>
            <Button variant={menu === 'reaction' || (menu === 'other' && slot === 'reaction') ? 'default' : 'outline'} disabled={Boolean(econ?.reaction)} onClick={() => openSlot('reaction')} size="default">
              Reaction
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void endTurn()} size="default">
              End turn
            </Button>
            {menu && (
              <Button variant="ghost" onClick={resetMenus} size="default">
                Cancel
              </Button>
            )}
          </div>

          {(menu === 'action' || menu === 'bonus' || menu === 'reaction') && (
            <div className="mt-2 flex flex-wrap gap-2 justify-center">
              {declareList.map((k) => (
                <Button
                  key={k.kind}
                  variant="outline"
                  disabled={busy || (k.kind === 'attack' && !canAct)}
                  onClick={() => onKind(k.kind)}
                  size="sm"
                >
                  {k.label}
                </Button>
              ))}
            </div>
          )}

          {menu === 'other' && (
            <div className="mt-2 flex flex-wrap gap-2 justify-center">
              {OTHER_ACTION_LABELS.map((label) => (
                <Button
                  key={label}
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (label === 'Custom') {
                      setMenu('custom')
                      return
                    }
                    void declare('other', { other: label })
                  }}
                  size="sm"
                >
                  {label}
                </Button>
              ))}
            </div>
          )}

          {menu === 'custom' && (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end justify-center">
              <Input className="h-10 flex-1 min-w-[12rem]" placeholder="What do you do?" value={custom} onChange={(e) => setCustom(e.target.value)} />
              <Button disabled={busy || !custom.trim()} onClick={() => void declare('custom', { custom })} size="default">
                Declare action
              </Button>
            </div>
          )}

          {menu === 'hide' && hideGate?.ok && (
            <div className="mt-2 rounded-lg border border-gold/40 bg-panel/50 px-3 py-3">
              <div className="text-xs uppercase tracking-wider text-gold font-semibold">Hide (Stealth)</div>
              <div className="mt-2 space-y-2">
                <p className="text-sm text-muted">
                  {hideGate && hideGate.seenBy.length > 0
                    ? 'You are in trees or stone. Enemies can still see you, but not clearly — roll Stealth vs their passive Perception.'
                    : 'No enemy has a clear view of you. Roll Stealth vs the highest passive Perception among enemies.'}
                </p>
                <div className="rounded-md border border-line bg-bg px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted">Stealth DC</span>
                    <span className="text-sm font-semibold text-gold-2">{hideDc}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">Highest passive Perception among enemies</p>
                </div>
                <div className="flex justify-center pt-2">
                  <Button
                    disabled={busy}
                    onClick={() => setModalType('hide')}
                    size="default"
                  >
                    Roll Stealth
                  </Button>
                </div>
              </div>
            </div>
          )}

          {menu === 'hide' && hideGate && !hideGate.ok && (
            <div className="mt-2 rounded-lg border border-gold/40 bg-panel/50 px-3 py-3">
              <div className="text-xs uppercase tracking-wider text-gold font-semibold">Hide (Stealth)</div>
              <div className="mt-2">
                <p className="text-sm text-blood">{hideGate.error}</p>
                {hideGate.seenBy && hideGate.seenBy.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-muted">Enemies who can see you clearly:</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {hideGate.seenBy.map((c) => (
                        <span key={c.id} className="rounded-md px-2 py-1 text-xs bg-blood/20 text-blood">
                          {c.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {menu === 'help' && (
            <div className="mt-2">
              <p className="text-xs text-muted">Tap an ally on the map or pick from the list.</p>
              <div className="mt-2 flex flex-wrap gap-2 justify-center">
                {others.map((c) => (
                  <Button key={c.id} variant={selectedId === c.id ? 'default' : 'outline'} onClick={() => onSelectedId(c.id)} size="sm">
                    {c.name}
                  </Button>
                ))}
              </div>
              <Button className="mt-2 w-full" size="default" disabled={busy || !selectedId} onClick={() => void declare('help', { targetId: selectedId ?? undefined })}>
                Help {target?.name ?? '…'}
              </Button>
            </div>
          )}

          {menu === 'attack' && step === 'pick' && (
            <div className="mt-2 flex flex-wrap gap-2 justify-center">
              {namedAttacks.length === 0 && <p className="w-full text-xs text-muted text-center">No named attacks on your sheet.</p>}
              {namedAttacks.map(({ atk, i }) => (
                <Button key={`${atk.name}-${i}`} variant="outline" disabled={!canAct} onClick={() => startAttack(atk, i)} size="sm">
                  {atk.name} {atk.bonus || ''}
                </Button>
              ))}
            </div>
          )}

          {menu === 'attack' && pending && step === 'target' && (
            <div className="mt-2">
              <p className="text-sm text-muted">
                {pending.attack.name} — tap a creature on the map or pick a target. Range is the DM's call.
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {others.map((c) => {
                  const isTarget = selectedId === c.id
                  const hasAdv = Boolean(combatant && hasHiddenAdvantage(combatant, c.id))
                  const targetCover = map && combatant
                    ? coverBonusBetween(
                        map,
                        tokens.find((t) => t.refId === combatant.id),
                        tokens.find((t) => t.refId === c.id),
                      )
                    : 0
                  const previewAc = c.ac + targetCover

                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onSelectedId(c.id)}
                      className={cn(
                        'rounded-lg border p-3 text-left transition-all',
                        isTarget
                          ? 'border-gold bg-gold/10 shadow-sm'
                          : 'border-line bg-panel/50 hover:border-gold/50'
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{c.name}</span>
                        <div className="flex items-center gap-2">
                          {hasAdv && <span className="text-[10px] uppercase text-gold">Adv</span>}
                          <span className="text-xs text-muted">AC {previewAc}</span>
                        </div>
                      </div>
                      <div className="mt-1.5 flex items-center gap-3 text-xs text-muted">
                        <span>HP: {c.hpCurrent}/{c.hpMax}</span>
                        {targetCover > 0 && <span className="text-gold">+{targetCover} cover</span>}
                      </div>
                    </button>
                  )
                })}
              </div>
              <Button className="mt-2 w-full" size="default" disabled={!selectedId} onClick={() => {
                const adv = Boolean(selectedId && combatant && hasHiddenAdvantage(combatant, selectedId))
                setRollMode(adv ? 'advantage' : 'normal')
                setStep('roll')
                setModalType('attack-d20')
              }}>
                Target {target?.name ?? '…'}
              </Button>
            </div>
          )}

          {menu === 'attack' && pending && step === 'roll' && target && (
            <div className="mt-2 rounded-lg border border-gold/40 bg-panel/50 px-3 py-3">
              <div className="text-xs uppercase tracking-wider text-gold font-semibold">Attack: {pending.attack.name}</div>
              <p className="mt-1 text-sm text-muted">
                {target.name} • AC {previewAc}{coverBonus ? ` · cover +${coverBonus}` : ''}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 justify-center">
                {(['normal', 'advantage', 'disadvantage'] as const).map((m) => (
                  <Button key={m} variant={rollMode === m ? 'default' : 'outline'} onClick={() => setRollMode(m)} size="sm">
                    {m === 'normal' ? 'Normal' : m === 'advantage' ? 'Advantage' : 'Disadvantage'}
                  </Button>
                ))}
              </div>
              {hasAdv && <p className="mt-2 text-xs text-gold text-center">Advantage vs this target</p>}
              {preview && (
                <div className="mt-3 rounded-lg bg-bg px-3 py-2 border border-gold/30">
                  <p className="text-sm text-center">
                    <span className="font-bold text-gold">{preview.used}</span>
                    {' + '}
                    <span className="font-bold text-gold">{preview.bonus >= 0 ? '+' : ''}{preview.bonus}</span>
                    {' = '}
                    <span className="font-bold text-gold text-lg">{preview.total}</span>
                    {' vs AC '}
                    <span className="font-bold">{previewAc}</span>
                  </p>
                  <p className="mt-2 text-center text-xs font-bold uppercase" style={{ color: preview.outcome === 'hit' ? '#d4af37' : preview.outcome === 'crit' ? '#e74c3c' : '#888' }}>
                    {preview.outcome}
                  </p>
                </div>
              )}
            </div>
          )}

          {menu === 'attack' && pending && step === 'damage' && target && (
            <div className="mt-2 rounded-lg border border-gold/40 bg-panel/50 px-3 py-3">
              <div className="text-xs uppercase tracking-wider text-gold font-semibold">Damage: {pending.attack.name}</div>
              <p className="mt-1 text-sm text-muted">{target.name} took the hit</p>
              <div className="mt-3 flex justify-center">
                <Button disabled={busy} onClick={() => setModalType('attack-damage')} size="default">
                  Enter Damage
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {msg && <p className={cn('mt-2 text-sm', /fail|wait|wrong|already|enter/i.test(msg) ? 'text-blood' : 'text-gold')}>{msg}</p>}

      {/* Roll Input Modals */}
      <RollInputModal
        isOpen={modalType === 'initiative'}
        title="Initiative"
        subtitle={`Current: ${combatant?.initiative ?? 0}`}
        description={`Enter the d20 you rolled. Your Dex ${character.sheet.initiativeBonus ?? 0} will be added.`}
        placeholder="d20"
        d20={true}
        disabled={busy}
        onSubmit={(value) => {
          setInitD20(String(value))
          setBusy(true)
          void api
            .setInitiative(combatant!.id, { d20: value })
            .then((r) => {
              setMsg(`Initiative ${r.initiative}`)
              setModalType(null)
              onSettled?.()
            })
            .catch((e) => setMsg(e instanceof Error ? e.message : 'Could not set initiative'))
            .finally(() => setBusy(false))
        }}
        onCancel={() => setModalType(null)}
      />

      <RollInputModal
        isOpen={modalType === 'save'}
        title="Saving Throw"
        subtitle={`${ABILITY_LABELS[(prompt?.ability ?? 'dex') as Ability]} DC ${prompt?.dc ?? 13}`}
        description={`Modifier: ${saveMod >= 0 ? '+' : ''}${saveMod}`}
        placeholder="d20"
        d20={true}
        disabled={busy}
        onSubmit={(value) => {
          setSaveD20(String(value))
          void answerSave()
        }}
        onCancel={() => setModalType(null)}
      />

      <RollInputModal
        isOpen={modalType === 'hide'}
        title="Hide (Stealth)"
        subtitle={`DC ${hideDc}`}
        description="Enter the d20 you rolled for Stealth."
        placeholder="d20"
        d20={true}
        disabled={busy}
        onSubmit={(value) => {
          setD20(String(value))
          void declare('hide', { d20: value })
          setModalType(null)
        }}
        onCancel={() => setModalType(null)}
      />

      <RollInputModal
        isOpen={modalType === 'attack-d20'}
        title={`${pending?.attack.name ?? 'Attack'} Roll`}
        subtitle={`${target?.name ?? 'Target'} • AC ${previewAc}`}
        description={mode !== 'normal' ? 'Enter both d20 rolls (advantage or disadvantage)' : 'Enter the d20 you rolled at the table.'}
        placeholder={mode !== 'normal' ? 'd20 (first roll)' : 'd20'}
        d20={true}
        disabled={busy}
        onSubmit={(value) => {
          if (mode === 'normal') {
            setD20(String(value))
            setTimeout(() => continueFromRoll(), 50)
          } else {
            setD20(String(value))
            setModalType(null)
            setMsg('Enter the second d20 roll below.')
          }
        }}
        onCancel={() => {
          setModalType(null)
          setStep('target')
        }}
      />

      <RollInputModal
        isOpen={modalType === 'attack-damage'}
        title="Damage Roll"
        subtitle={`${pending?.attack.name ?? 'Attack'} → ${target?.name ?? 'Target'}`}
        description="Enter the total damage rolled."
        placeholder="damage"
        d20={false}
        disabled={busy}
        onSubmit={(value) => {
          setDamage(String(value))
          void submitAttack(value)
          setModalType(null)
        }}
        onCancel={() => setModalType(null)}
      />
    </div>
  )
}
