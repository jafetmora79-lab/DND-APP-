import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input className="h-8 w-16" inputMode="numeric" placeholder="d20" value={initD20} onChange={(e) => setInitD20(e.target.value)} aria-label="Initiative d20" />
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                const roll = Number(initD20)
                setBusy(true)
                void api
                  .setInitiative(combatant.id, { d20: roll })
                  .then((r) => {
                    setMsg(`Initiative ${r.initiative}`)
                    setInitD20('')
                    onSettled?.()
                  })
                  .catch((e) => setMsg(e instanceof Error ? e.message : 'Could not set initiative'))
                  .finally(() => setBusy(false))
              }}
              className="h-8 px-3 text-xs"
            >
              Submit
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
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input className="h-8 w-16" inputMode="numeric" placeholder="d20" value={saveD20} onChange={(e) => setSaveD20(e.target.value)} aria-label="Save d20" />
            <Button size="sm" disabled={busy} onClick={() => void answerSave()} className="h-8 px-3 text-xs">
              Submit save
            </Button>
          </div>
        </div>
      )}

      {minePrompt && prompt?.kind === 'reaction' && (
        <div className="mt-2 rounded-lg border border-gold/50 bg-panel/50 px-3 py-3">
          <div className="text-xs uppercase tracking-wider text-gold font-semibold">Reaction requested</div>
          <Input className="mt-2 h-8" placeholder="Optional note or attack name" value={reactionNote} onChange={(e) => setReactionNote(e.target.value)} />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => void answerReaction(true)} className="h-8 px-3 text-xs">
              Use reaction
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void answerReaction(false)} className="h-8 px-3 text-xs">
              Decline
            </Button>
          </div>
        </div>
      )}

      {myTurn && combatant && !setup && (
        <>
          <div className="mt-2 flex flex-wrap gap-1">
            <Button size="sm" variant={menu === 'action' || menu === 'attack' || menu === 'hide' || (menu === 'other' && slot === 'action') || menu === 'help' ? 'default' : 'outline'} disabled={Boolean(econ?.action)} onClick={() => openSlot('action')} className="h-8 px-3 text-xs">
              Action
            </Button>
            <Button size="sm" variant={menu === 'bonus' || (menu === 'other' && slot === 'bonus') ? 'default' : 'outline'} disabled={Boolean(econ?.bonus)} onClick={() => openSlot('bonus')} className="h-8 px-3 text-xs">
              Bonus action
            </Button>
            <Button size="sm" variant={menu === 'reaction' || (menu === 'other' && slot === 'reaction') ? 'default' : 'outline'} disabled={Boolean(econ?.reaction)} onClick={() => openSlot('reaction')} className="h-8 px-3 text-xs">
              Reaction
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void endTurn()} className="h-8 px-3 text-xs">
              End turn
            </Button>
            {menu && (
              <Button size="sm" variant="ghost" onClick={resetMenus} className="h-8 px-3 text-xs">
                Cancel
              </Button>
            )}
          </div>

          {(menu === 'action' || menu === 'bonus' || menu === 'reaction') && (
            <div className="mt-2 flex flex-wrap gap-1">
              {declareList.map((k) => (
                <Button
                  key={k.kind}
                  size="sm"
                  variant="outline"
                  disabled={busy || (k.kind === 'attack' && !canAct)}
                  onClick={() => onKind(k.kind)}
                  className="h-8 px-3 text-xs"
                >
                  {k.label}
                </Button>
              ))}
            </div>
          )}

          {menu === 'other' && (
            <div className="mt-2 flex flex-wrap gap-1">
              {OTHER_ACTION_LABELS.map((label) => (
                <Button
                  key={label}
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (label === 'Custom') {
                      setMenu('custom')
                      return
                    }
                    void declare('other', { other: label })
                  }}
                  className="h-8 px-3 text-xs"
                >
                  {label}
                </Button>
              ))}
            </div>
          )}

          {menu === 'custom' && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input className="h-8 min-w-[12rem] flex-1" placeholder="What do you do?" value={custom} onChange={(e) => setCustom(e.target.value)} />
              <Button size="sm" disabled={busy || !custom.trim()} onClick={() => void declare('custom', { custom })} className="h-8 px-3 text-xs">
                Declare action
              </Button>
            </div>
          )}

          {menu === 'hide' && (
            <div className="mt-2 rounded-lg border border-gold/40 bg-panel/50 px-3 py-3">
              <div className="text-xs uppercase tracking-wider text-gold font-semibold">Hide (Stealth)</div>
              {hideGate && !hideGate.ok ? (
                <div className="mt-2">
                  <p className="text-sm text-blood">{hideGate.error}</p>
                  {hideGate.seenBy && hideGate.seenBy.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs text-muted">Enemies who can see you:</p>
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
              ) : (
                <div className="mt-2 space-y-2">
                  <p className="text-sm text-muted">
                    No enemy can see you. Break line of sight before hiding.
                  </p>
                  <div className="rounded-md border border-line bg-bg px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted">Stealth DC</span>
                      <span className="text-sm font-semibold text-gold-2">{hideDc}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">Highest passive Perception among enemies</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input className="h-8 w-16" inputMode="numeric" placeholder="d20" value={d20} onChange={(e) => setD20(e.target.value)} aria-label="Hide Stealth d20" />
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        const roll = Number(d20)
                        if (!Number.isInteger(roll) || roll < 1 || roll > 20) {
                          setMsg('Enter the d20 you rolled for Stealth (1–20).')
                          return
                        }
                        void declare('hide', { d20: roll })
                      }}
                      className="h-8 px-3 text-xs"
                    >
                      Resolve Hide
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {menu === 'help' && (
            <div className="mt-2">
              <p className="text-xs text-muted">Tap an ally on the map or pick from the list.</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {others.map((c) => (
                  <Button key={c.id} size="sm" variant={selectedId === c.id ? 'default' : 'outline'} onClick={() => onSelectedId(c.id)} className="h-8 px-3 text-xs">
                    {c.name}
                  </Button>
                ))}
              </div>
              <Button className="mt-2 w-full h-8 px-3 text-xs" size="sm" disabled={busy || !selectedId} onClick={() => void declare('help', { targetId: selectedId ?? undefined })}>
                Help {target?.name ?? '…'}
              </Button>
            </div>
          )}

          {menu === 'attack' && step === 'pick' && (
            <div className="mt-2 flex flex-wrap gap-1">
              {namedAttacks.length === 0 && <p className="text-xs text-muted">No named attacks on your sheet.</p>}
              {namedAttacks.map(({ atk, i }) => (
                <Button key={`${atk.name}-${i}`} size="sm" variant="outline" disabled={!canAct} onClick={() => startAttack(atk, i)} className="h-8 px-3 text-xs">
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
                        'rounded-lg border p-2.5 text-left transition-all',
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
              <Button className="mt-2 w-full h-8 px-3 text-xs" size="sm" disabled={!selectedId} onClick={() => {
                const adv = Boolean(selectedId && combatant && hasHiddenAdvantage(combatant, selectedId))
                setRollMode(adv ? 'advantage' : 'normal')
                setStep('roll')
              }}>
                Target {target?.name ?? '…'}
              </Button>
            </div>
          )}

          {menu === 'attack' && pending && (step === 'roll' || step === 'damage') && target && (
            <div className="mt-2">
              <p className="text-sm">
                {pending.attack.name} → {target.name} (AC {previewAc}{coverBonus ? ` · cover +${coverBonus}` : ''} — must roll higher)
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {(['normal', 'advantage', 'disadvantage'] as const).map((m) => (
                  <Button key={m} size="sm" variant={rollMode === m ? 'default' : 'outline'} onClick={() => setRollMode(m)} className="h-8 px-3 text-xs">
                    {m === 'normal' ? 'Normal' : m === 'advantage' ? 'Advantage' : 'Disadvantage'}
                  </Button>
                ))}
                {hasAdv && <span className="self-center text-xs text-gold">Advantage vs this target</span>}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input className="h-8 w-16" inputMode="numeric" placeholder={mode !== 'normal' ? 'd20 a' : 'd20'} value={d20} onChange={(e) => setD20(e.target.value)} aria-label="d20 roll" />
                {mode !== 'normal' && (
                  <Input className="h-8 w-16" inputMode="numeric" placeholder="d20 b" value={d20b} onChange={(e) => setD20b(e.target.value)} aria-label="second d20" />
                )}
                {step === 'roll' && (
                  <Button size="sm" disabled={busy} onClick={continueFromRoll} className="h-8 px-3 text-xs">
                    Continue
                  </Button>
                )}
              </div>
              {preview && (
                <p className="mt-1 text-xs text-muted">
                  {preview.used} + {preview.bonus} = {preview.total} vs AC {previewAc} — {preview.outcome.toUpperCase()}
                </p>
              )}
              {step === 'damage' && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Input className="h-8 w-20" inputMode="numeric" placeholder="Damage" value={damage} onChange={(e) => setDamage(e.target.value)} aria-label="Damage rolled" />
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      const dmg = Number(damage)
                      if (!Number.isFinite(dmg) || dmg < 0) {
                        setMsg('Enter the damage you rolled (0 if you deal none).')
                        return
                      }
                      void submitAttack(dmg)
                    }}
                    className="h-8 px-3 text-xs"
                  >
                    Resolve hit
                  </Button>
                </div>
              )}
              <p className="mt-1 text-xs text-muted">
                Enter the physical dice from the table. The app never rolls for you. Bonus {parseAttackBonus(pending.attack.bonus) >= 0 ? '+' : ''}
                {parseAttackBonus(pending.attack.bonus)} is added to the used die.
              </p>
            </div>
          )}
        </>
      )}

      {msg && <p className={cn('mt-1 text-sm', /fail|wait|wrong|already|enter/i.test(msg) ? 'text-blood' : 'text-gold')}>{msg}</p>}
    </div>
  )
}
