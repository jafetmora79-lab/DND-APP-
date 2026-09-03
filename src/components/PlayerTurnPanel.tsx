import { useEffect, useMemo, useState } from 'react'
import { Shield, Sparkles, Swords } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RollInputModal, type RollOutcome } from '@/components/RollInputModal'
import { ActionEconomyBar } from '@/components/ActionEconomyBar'
import { TurnIndicator } from '@/components/TurnIndicator'
import { api } from '@/lib/api'
import { attackOutcome, bonusDeclareKindAllowed, canTakeAttacks, characterSaveBonus, effectiveRollMode, hasHiddenAdvantage, isDodging, parseAttackBonus, pickUsedD20 } from '@/lib/combat'
import { OTHER_ACTION_LABEL_KEYS, OTHER_ACTION_LABELS } from '@/lib/combat-activity'
import { useT } from '@/lib/i18n'
import { canAttemptHide, hideDcFor } from '@/lib/stealth'
import { ABILITY_LABELS, type Ability, type Attack, type BattleMap, type CombatPrompt, type CombatSpendSlot, type Combatant, type MapToken, type Monster, type PlayerCharacter, type RollMode } from '@/lib/types'
import { cn, proficiencyBonus } from '@/lib/utils'
import { coverBonusBetween } from '@/lib/vision'

export type MapPickMode = 'select' | 'attack' | 'help'

type Menu = null | 'action' | 'bonus' | 'reaction' | 'other' | 'help' | 'attack' | 'custom' | 'hide' | 'ready' | 'contest-target' | 'spell-pick'
type AttackStep = 'pick' | 'target' | 'roll' | 'damage'
type ModalType = null | 'initiative' | 'save' | 'hide' | 'attack-d20' | 'attack-damage' | 'contest'
type ContestKind = 'grapple' | 'shove'

const DECLARE_KINDS = [
  { kind: 'attack', labelKey: 'declare.attack' },
  { kind: 'dash', labelKey: 'declare.dash' },
  { kind: 'dodge', labelKey: 'declare.dodge' },
  { kind: 'help', labelKey: 'declare.help' },
  { kind: 'disengage', labelKey: 'declare.disengage' },
  { kind: 'hide', labelKey: 'declare.hide' },
  { kind: 'ready', labelKey: 'declare.ready' },
  { kind: 'other', labelKey: 'declare.other' },
] as const

// A Reaction is always triggered by something (an enemy leaving your reach, a
// reaction spell/feature responding to a trigger) — never a free choice off a
// menu, so it only offers an Opportunity Attack or a custom note, not the
// full action list.
const REACTION_KINDS = [
  { kind: 'attack', labelKey: 'declare.opportunityAttack' },
  { kind: 'other', labelKey: 'declare.other' },
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
  const { t } = useT()
  const myTurn = Boolean(combatant && whose && whose.id === combatant.id)
  const [menu, setMenu] = useState<Menu>(null)
  const [slot, setSlot] = useState<CombatSpendSlot>('action')
  const [step, setStep] = useState<AttackStep>('pick')
  const [pending, setPending] = useState<{ attack: Attack; index: number } | null>(null)
  const [rollMode, setRollMode] = useState<RollMode>('normal')
  const [d20, setD20] = useState('')
  const [custom, setCustom] = useState('')
  const [interactText, setInteractText] = useState('')
  const [contestKind, setContestKind] = useState<ContestKind | null>(null)
  const [helpAllyId, setHelpAllyId] = useState<string | null>(null)
  const [reactionNote, setReactionNote] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [modalType, setModalType] = useState<ModalType>(null)
  const [pendingResult, setPendingResult] = useState<RollOutcome | null>(null)

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
    setCustom('')
    setInteractText('')
    setContestKind(null)
    setHelpAllyId(null)
    setRollMode('normal')
    setModalType(null)
    setPendingResult(null)
    onSelectedId(null)
  }

  function startAttack(attack: Attack, index: number) {
    setMenu('attack')
    setStep('target')
    setPending({ attack, index })
    setD20('')
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
      onSettled?.()
      if ((kind === 'hide' || kind === 'grapple' || kind === 'shove') && typeof r.success === 'boolean') {
        setPendingResult({
          tone: r.success ? 'success' : 'fail',
          heading: r.success ? t('roll.success') : t('roll.fail'),
          detail: r.text,
        })
      } else {
        resetMenus()
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('turn.errDeclare'))
    } finally {
      setBusy(false)
    }
  }

  async function castSpell(index: number) {
    const spell = character.sheet.spells[index]
    if (!spell || !spell.name.trim()) return
    setBusy(true)
    try {
      if (spell.level > 0) {
        const used = character.sheet.spellSlotsUsed[spell.level - 1] ?? 0
        const max = character.sheet.spellSlots[spell.level - 1] ?? 0
        if (used >= max) {
          setMsg(t('turn.noSpellSlots', { level: spell.level }))
          return
        }
        const spellSlotsUsed = character.sheet.spellSlotsUsed.slice()
        spellSlotsUsed[spell.level - 1] = used + 1
        await api.patchCharacter(character.id, { sheet: { spellSlotsUsed } })
      }
      await declare(spell.concentration ? 'concentrate' : 'castSpell', { other: spell.name })
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('turn.errDeclare'))
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
      setHelpAllyId(null)
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
    if (kind === 'ready') {
      setMenu('ready')
      setCustom('')
      return
    }
    void declare(kind)
  }

  const hasAdv = Boolean(target && combatant && hasHiddenAdvantage(combatant, target.id))
  const targetDodging = Boolean(target && isDodging(target))
  const mode = effectiveRollMode(rollMode, hasAdv, targetDodging)
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
    if (!Number.isInteger(roll) || roll < 1 || roll > 20) return null
    const bonus = parseAttackBonus(pending.attack.bonus)
    const dice = pickUsedD20(roll, undefined, mode)
    const outcome = attackOutcome(dice.used, bonus, previewAc)
    const total = dice.used + bonus
    return { outcome, total, bonus, used: dice.used }
  }, [pending, target, d20, mode, previewAc])

  async function submitAttack(dmg: number) {
    if (!pending || !selectedId) return
    const roll = Number(d20)
    setBusy(true)
    try {
      const r = await api.playerAttack(instanceId, {
        attackerId: combatant?.id,
        targetId: selectedId,
        attackIndex: pending.index,
        d20: roll,
        d20b: undefined,
        rollMode: mode,
        damage: dmg,
        slot,
      })
      setMsg(r.message)
      resetMenus()
      onSettled?.()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('turn.errAttack'))
    } finally {
      setBusy(false)
    }
  }

  function revealAttackRoll(value: number) {
    if (!pending || !target || !Number.isInteger(value) || value < 1 || value > 20) {
      setMsg(t('turn.errEnterD20'))
      return
    }
    setD20(String(value))
    const bonus = parseAttackBonus(pending.attack.bonus)
    const dice = pickUsedD20(value, undefined, mode)
    const outcome = attackOutcome(dice.used, bonus, previewAc)
    const total = dice.used + bonus
    setPendingResult({
      tone: outcome === 'hit' || outcome === 'crit' ? 'success' : 'fail',
      heading: t(`turn.outcome.${outcome}`),
      detail: t('roll.attackDetail', { total, ac: previewAc }),
    })
  }

  function continueFromAttackRoll() {
    const outcome = pendingResult?.tone
    setPendingResult(null)
    if (outcome === 'fail') {
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
      setMsg(e instanceof Error ? e.message : t('turn.errEndTurn'))
    } finally {
      setBusy(false)
    }
  }

  async function answerSave(d20Value: number) {
    setBusy(true)
    try {
      const r = await api.answerPrompt(instanceId, { d20: d20Value })
      setMsg(r.message || '')
      onSettled?.()
      if (typeof r.success === 'boolean') {
        setPendingResult({
          tone: r.success ? 'success' : 'fail',
          heading: r.success ? t('roll.success') : t('roll.fail'),
          detail: typeof r.total === 'number' ? t('roll.totalDetail', { total: r.total }) : r.message,
        })
      } else {
        setModalType(null)
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('turn.errSave'))
    } finally {
      setBusy(false)
    }
  }

  async function answerReaction(use: boolean) {
    setBusy(true)
    try {
      await api.answerPrompt(instanceId, { use, other: reactionNote })
      setReactionNote('')
      setMsg(use ? t('turn.reactionUsed') : t('turn.reactionDeclined'))
      onSettled?.()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('turn.errAnswer'))
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
  const declareList =
    slot === 'reaction'
      ? REACTION_KINDS
      : slot === 'bonus'
        ? DECLARE_KINDS.filter((k) => bonusDeclareKindAllowed(k.kind, character.sheet.className))
        : DECLARE_KINDS

  return (
    <div className="border-t border-line bg-panel px-3 py-2">
      <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
        <TurnIndicator current={whose} myTurn={myTurn} combatantName={combatant?.name ?? character.name} setup={setup} />
        {combatant && <ActionEconomyBar combatant={combatant} />}
      </div>

      {setup && combatant && (
        <div className="mt-2 rounded-lg border border-gold/40 bg-panel/50 px-3 py-3">
          <div className="text-xs uppercase tracking-wider text-gold font-semibold">{t('init.your')}</div>
          <p className="mt-1 text-sm text-muted">
            {t('turn.initiativeHint', { total: combatant.initiative, dex: character.sheet.initiativeBonus ?? '' })}
          </p>
          <div className="mt-3 flex justify-center">
            <Button
              size="default"
              disabled={busy}
              onClick={() => setModalType('initiative')}
            >
              {t('turn.rollInitiative')}
            </Button>
          </div>
        </div>
      )}

      {minePrompt && prompt?.kind === 'save' && (
        <div className="mt-2 rounded-lg border border-gold/50 bg-panel/50 px-3 py-3">
          <div className="text-xs uppercase tracking-wider text-gold font-semibold">{t('turn.savingThrowTitle')}</div>
          <p className="mt-1 text-sm">
            {t(`abilityName.${(prompt.ability ?? 'dex') as Ability}`)} {t('check.dc')} {prompt.dc ?? 13} · {t('check.mod')} {saveMod >= 0 ? `+${saveMod}` : saveMod}
          </p>
          <div className="mt-3 flex justify-center">
            <Button size="default" disabled={busy} onClick={() => setModalType('save')}>
              {t('turn.rollSave')}
            </Button>
          </div>
        </div>
      )}

      {minePrompt && prompt?.kind === 'reaction' && (
        <div className="mt-2 rounded-lg border border-gold/50 bg-panel/50 px-3 py-3">
          <div className="text-xs uppercase tracking-wider text-gold font-semibold">{t('turn.reactionRequested')}</div>
          <Input className="mt-2 h-10" placeholder={t('turn.reactionPlaceholder')} value={reactionNote} onChange={(e) => setReactionNote(e.target.value)} />
          <div className="mt-3 flex flex-col gap-2 sm:flex-row justify-center">
            <Button size="default" disabled={busy} onClick={() => void answerReaction(true)}>
              {t('turn.useReaction')}
            </Button>
            <Button size="default" variant="outline" disabled={busy} onClick={() => void answerReaction(false)}>
              {t('turn.decline')}
            </Button>
          </div>
        </div>
      )}

      {myTurn && combatant && !setup && (
        <>
          <div className="mt-3 flex flex-wrap gap-2 justify-center">
            <Button variant={menu === 'action' || menu === 'attack' || menu === 'hide' || menu === 'ready' || (menu === 'other' && slot === 'action') || menu === 'help' ? 'default' : 'outline'} disabled={Boolean(econ?.action)} onClick={() => openSlot('action')} size="default">
              <Swords className="h-4 w-4" /> {t('turn.action')}
            </Button>
            <Button variant={menu === 'bonus' || (menu === 'other' && slot === 'bonus') ? 'default' : 'outline'} disabled={Boolean(econ?.bonus)} onClick={() => openSlot('bonus')} size="default">
              <Sparkles className="h-4 w-4" /> {t('turn.bonusAction')}
            </Button>
            <Button variant={menu === 'reaction' || (menu === 'other' && slot === 'reaction') ? 'default' : 'outline'} disabled={Boolean(econ?.reaction)} onClick={() => openSlot('reaction')} size="default">
              <Shield className="h-4 w-4" /> {t('turn.reaction')}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void endTurn()} size="default">
              {t('turn.endTurn')}
            </Button>
            {menu && (
              <Button variant="ghost" onClick={resetMenus} size="default">
                {t('turn.cancel')}
              </Button>
            )}
          </div>

          {menu === 'reaction' && <p className="mt-2 text-center text-xs text-muted">{t('turn.reactionHint')}</p>}

          {!menu && !econ?.interact && (
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <Input
                className="h-8 w-44 text-xs"
                placeholder={t('turn.interactPlaceholder')}
                value={interactText}
                onChange={(e) => setInteractText(e.target.value)}
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !interactText.trim()}
                onClick={() => void declare('interact', { other: interactText })}
              >
                {t('turn.interactButton')}
              </Button>
            </div>
          )}

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
                  {t(k.labelKey)}
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
                    if (label === 'Grapple' || label === 'Shove') {
                      setContestKind(label === 'Grapple' ? 'grapple' : 'shove')
                      onSelectedId(null)
                      setMenu('contest-target')
                      return
                    }
                    if (label === 'Cast Spell') {
                      setMenu('spell-pick')
                      return
                    }
                    void declare('other', { other: label })
                  }}
                  size="sm"
                >
                  {t(OTHER_ACTION_LABEL_KEYS[label])}
                </Button>
              ))}
            </div>
          )}

          {menu === 'custom' && (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end justify-center">
              <Input className="h-10 flex-1 min-w-[12rem]" placeholder={t('turn.customPlaceholder')} value={custom} onChange={(e) => setCustom(e.target.value)} />
              <Button disabled={busy || !custom.trim()} onClick={() => void declare('custom', { custom })} size="default">
                {t('turn.declareAction')}
              </Button>
            </div>
          )}

          {menu === 'ready' && (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end justify-center">
              <Input className="h-10 flex-1 min-w-[12rem]" placeholder={t('turn.readyPlaceholder')} value={custom} onChange={(e) => setCustom(e.target.value)} />
              <Button disabled={busy || !custom.trim()} onClick={() => void declare('ready', { custom })} size="default">
                {t('turn.declareAction')}
              </Button>
            </div>
          )}

          {menu === 'contest-target' && contestKind && (
            <div className="mt-2">
              <p className="text-sm text-muted">{t(contestKind === 'grapple' ? 'turn.grappleTargetHint' : 'turn.shoveTargetHint')}</p>
              <div className="mt-2 flex flex-wrap gap-2 justify-center">
                {others.map((c) => (
                  <Button key={c.id} variant={selectedId === c.id ? 'default' : 'outline'} onClick={() => onSelectedId(c.id)} size="sm">
                    {c.name}
                  </Button>
                ))}
              </div>
              <Button
                className="mt-2 w-full"
                size="default"
                disabled={!selectedId}
                onClick={() => setModalType('contest')}
              >
                {t(contestKind === 'grapple' ? 'turn.grappleButton' : 'turn.shoveButton', { name: target?.name ?? '…' })}
              </Button>
            </div>
          )}

          {menu === 'spell-pick' && (
            <div className="mt-2">
              {character.sheet.spells.filter((s) => s.name.trim()).length === 0 && (
                <p className="text-xs text-muted text-center">{t('turn.noSpells')}</p>
              )}
              <div className="flex flex-col gap-1.5">
                {character.sheet.spells.map((sp, i) => {
                  if (!sp.name.trim()) return null
                  const used = character.sheet.spellSlotsUsed[sp.level - 1] ?? 0
                  const max = character.sheet.spellSlots[sp.level - 1] ?? 0
                  const outOfSlots = sp.level > 0 && used >= max
                  return (
                    <Button
                      key={i}
                      variant="outline"
                      disabled={busy || outOfSlots}
                      onClick={() => void castSpell(i)}
                      size="sm"
                      className="justify-between"
                    >
                      <span>{sp.name}</span>
                      <span className="text-xs text-muted">
                        {sp.level === 0 ? t('turn.cantrip') : t('turn.spellSlotLevel', { level: sp.level, used, max })}
                        {sp.concentration ? ` · ${t('sheet.concentration')}` : ''}
                      </span>
                    </Button>
                  )
                })}
              </div>
            </div>
          )}

          {menu === 'hide' && hideGate?.ok && (
            <div className="mt-2 rounded-lg border border-gold/40 bg-panel/50 px-3 py-3">
              <div className="text-xs uppercase tracking-wider text-gold font-semibold">{t('turn.hideTitle')}</div>
              <div className="mt-2 space-y-2">
                <p className="text-sm text-muted">
                  {hideGate && hideGate.seenBy.length > 0 ? t('turn.hideDescSeen') : t('turn.hideDescClear')}
                </p>
                <div className="rounded-md border border-line bg-bg px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted">{t('turn.stealthDc')}</span>
                    <span className="text-sm font-semibold text-gold-2">{hideDc}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{t('turn.stealthDcHint')}</p>
                </div>
                <div className="flex justify-center pt-2">
                  <Button
                    disabled={busy}
                    onClick={() => setModalType('hide')}
                    size="default"
                  >
                    {t('turn.rollStealth')}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {menu === 'hide' && hideGate && !hideGate.ok && (
            <div className="mt-2 rounded-lg border border-gold/40 bg-panel/50 px-3 py-3">
              <div className="text-xs uppercase tracking-wider text-gold font-semibold">{t('turn.hideTitle')}</div>
              <div className="mt-2">
                <p className="text-sm text-blood">
                  {hideGate.errorCode === 'not-on-map'
                    ? t('turn.hideNotOnMap')
                    : t('turn.hideSeenBy', { names: hideGate.seenBy?.map((c) => c.name).join(', ') ?? '' })}
                </p>
                {hideGate.seenBy && hideGate.seenBy.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-muted">{t('turn.seenByLabel')}</p>
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

          {menu === 'help' && !helpAllyId && (
            <div className="mt-2">
              <p className="text-xs text-muted">{t('turn.helpHint')}</p>
              <div className="mt-2 flex flex-wrap gap-2 justify-center">
                {others.map((c) => (
                  <Button key={c.id} variant={selectedId === c.id ? 'default' : 'outline'} onClick={() => onSelectedId(c.id)} size="sm">
                    {c.name}
                  </Button>
                ))}
              </div>
              <Button
                className="mt-2 w-full"
                size="default"
                disabled={!selectedId}
                onClick={() => {
                  setHelpAllyId(selectedId)
                  onSelectedId(null)
                }}
              >
                {t('turn.helpNextButton', { name: target?.name ?? '…' })}
              </Button>
            </div>
          )}

          {menu === 'help' && helpAllyId && (
            <div className="mt-2">
              <p className="text-xs text-muted">{t('turn.helpEnemyHint', { name: combatants.find((c) => c.id === helpAllyId)?.name ?? '…' })}</p>
              <div className="mt-2 flex flex-wrap gap-2 justify-center">
                {others
                  .filter((c) => c.id !== helpAllyId)
                  .map((c) => (
                    <Button key={c.id} variant={selectedId === c.id ? 'default' : 'outline'} onClick={() => onSelectedId(c.id)} size="sm">
                      {c.name}
                    </Button>
                  ))}
              </div>
              <Button
                className="mt-2 w-full"
                size="default"
                disabled={busy || !selectedId}
                onClick={() => void declare('help', { targetId: helpAllyId, other: selectedId ?? undefined })}
              >
                {t('turn.helpButton', { name: target?.name ?? '…' })}
              </Button>
            </div>
          )}

          {menu === 'attack' && step === 'pick' && (
            <div className="mt-2 flex flex-wrap gap-2 justify-center">
              {namedAttacks.length === 0 && <p className="w-full text-xs text-muted text-center">{t('turn.noAttacks')}</p>}
              {namedAttacks.map(({ atk, i }) => (
                <Button key={`${atk.name}-${i}`} variant="outline" disabled={!canAct} onClick={() => startAttack(atk, i)} size="sm">
                  {atk.name} {atk.bonus || ''}
                </Button>
              ))}
            </div>
          )}

          {menu === 'attack' && pending && step === 'target' && (
            <div className="mt-2">
              <p className="text-sm text-muted">{t('turn.targetHint', { attack: pending.attack.name })}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {others.map((c) => {
                  const isTarget = selectedId === c.id
                  const hasAdv = Boolean(combatant && hasHiddenAdvantage(combatant, c.id))
                  const dodging = isDodging(c)
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
                          {hasAdv && <span className="text-[10px] uppercase text-gold">{t('turn.advBadge')}</span>}
                          {dodging && <span className="text-[10px] uppercase text-blood">{t('turn.dodgeBadge')}</span>}
                          <span className="text-xs text-muted">{t('sheet.acShort')} {previewAc}</span>
                        </div>
                      </div>
                      <div className="mt-1.5 flex items-center gap-3 text-xs text-muted">
                        <span>{t('player.hp')}: {c.hpCurrent}/{c.hpMax}</span>
                        {targetCover > 0 && <span className="text-gold">{t('turn.coverBonus', { n: targetCover })}</span>}
                      </div>
                    </button>
                  )
                })}
              </div>
              <Button className="mt-2 w-full" size="default" disabled={!selectedId} onClick={() => {
                const adv = Boolean(selectedId && combatant && hasHiddenAdvantage(combatant, selectedId))
                const dodge = Boolean(target && isDodging(target))
                setRollMode(effectiveRollMode('normal', adv, dodge))
                setStep('roll')
                setModalType('attack-d20')
              }}>
                {t('turn.targetButton', { name: target?.name ?? '…' })}
              </Button>
            </div>
          )}

          {menu === 'attack' && pending && step === 'roll' && target && (
            <div className="mt-2 rounded-lg border border-gold/40 bg-panel/50 px-3 py-3">
              <div className="text-xs uppercase tracking-wider text-gold font-semibold">{t('turn.attackHeader', { name: pending.attack.name })}</div>
              <p className="mt-1 text-sm text-muted">
                {target.name} • {t('sheet.acShort')} {previewAc}{coverBonus ? t('turn.coverSuffix', { n: coverBonus }) : ''}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 justify-center">
                {(['normal', 'advantage', 'disadvantage'] as const).map((m) => (
                  <Button key={m} variant={rollMode === m ? 'default' : 'outline'} onClick={() => setRollMode(m)} size="sm">
                    {m === 'normal' ? t('turn.normal') : m === 'advantage' ? t('turn.advantage') : t('turn.disadvantage')}
                  </Button>
                ))}
              </div>
              {hasAdv && <p className="mt-2 text-xs text-gold text-center">{t('turn.advVsTarget')}</p>}
              {targetDodging && <p className="mt-2 text-xs text-blood text-center">{t('turn.dodgeHint')}</p>}
              {preview && (
                <div className="mt-3 rounded-lg bg-bg px-3 py-2 border border-gold/30">
                  <p className="text-sm text-center">
                    <span className="font-bold text-gold">{preview.used}</span>
                    {' + '}
                    <span className="font-bold text-gold">{preview.bonus >= 0 ? '+' : ''}{preview.bonus}</span>
                    {' = '}
                    <span className="font-bold text-gold text-lg">{preview.total}</span>
                    {' '}{t('turn.vsAc')}{' '}
                    <span className="font-bold">{previewAc}</span>
                  </p>
                  <p className="mt-2 text-center text-xs font-bold uppercase" style={{ color: preview.outcome === 'hit' ? '#d4af37' : preview.outcome === 'crit' ? '#e74c3c' : '#888' }}>
                    {t(`turn.outcome.${preview.outcome}`)}
                  </p>
                </div>
              )}
            </div>
          )}

          {menu === 'attack' && pending && step === 'damage' && target && (
            <div className="mt-2 rounded-lg border border-gold/40 bg-panel/50 px-3 py-3">
              <div className="text-xs uppercase tracking-wider text-gold font-semibold">{t('turn.damageHeader', { name: pending.attack.name })}</div>
              <p className="mt-1 text-sm text-muted">{t('turn.tookHit', { name: target.name })}</p>
              <div className="mt-3 flex justify-center">
                <Button disabled={busy} onClick={() => setModalType('attack-damage')} size="default">
                  {t('turn.enterDamage')}
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
        title={t('init.title')}
        subtitle={t('turn.currentLabel', { value: combatant?.initiative ?? 0 })}
        description={t('turn.initDescription', { dex: character.sheet.initiativeBonus ?? 0 })}
        placeholder={t('turn.d20Placeholder')}
        d20={true}
        disabled={busy}
        onSubmit={(value) => {
          setBusy(true)
          void api
            .setInitiative(combatant!.id, { d20: value })
            .then((r) => {
              setMsg(`${t('init.title')} ${r.initiative}`)
              setModalType(null)
              onSettled?.()
            })
            .catch((e) => setMsg(e instanceof Error ? e.message : t('turn.errInitiative')))
            .finally(() => setBusy(false))
        }}
        onCancel={() => setModalType(null)}
      />

      <RollInputModal
        isOpen={modalType === 'save'}
        title={t('turn.savingThrowTitle')}
        subtitle={`${ABILITY_LABELS[(prompt?.ability ?? 'dex') as Ability]} ${t('check.dc')} ${prompt?.dc ?? 13}`}
        description={t('turn.modifierLabel', { value: `${saveMod >= 0 ? '+' : ''}${saveMod}` })}
        placeholder={t('turn.d20Placeholder')}
        d20={true}
        disabled={busy}
        result={pendingResult}
        onContinue={() => {
          setPendingResult(null)
          setModalType(null)
        }}
        onSubmit={(value) => {
          void answerSave(value)
        }}
        onCancel={() => setModalType(null)}
      />

      <RollInputModal
        isOpen={modalType === 'hide'}
        title={t('turn.hideTitle')}
        subtitle={`${t('check.dc')} ${hideDc}`}
        description={t('turn.stealthDescription')}
        placeholder={t('turn.d20Placeholder')}
        d20={true}
        disabled={busy}
        result={pendingResult}
        onContinue={() => {
          setPendingResult(null)
          resetMenus()
        }}
        onSubmit={(value) => {
          void declare('hide', { d20: value })
        }}
        onCancel={() => setModalType(null)}
      />

      <RollInputModal
        isOpen={modalType === 'contest'}
        title={t(contestKind === 'shove' ? 'other.shove' : 'other.grapple')}
        subtitle={target?.name ?? '…'}
        description={t('turn.contestDescription')}
        placeholder={t('turn.d20Placeholder')}
        d20={true}
        disabled={busy}
        result={pendingResult}
        onContinue={() => {
          setPendingResult(null)
          resetMenus()
        }}
        onSubmit={(value) => {
          if (contestKind) void declare(contestKind, { targetId: selectedId ?? undefined, d20: value })
        }}
        onCancel={() => setModalType(null)}
      />

      <RollInputModal
        isOpen={modalType === 'attack-d20'}
        title={t('turn.attackRollTitle', { attack: pending?.attack.name ?? t('declare.attack') })}
        subtitle={`${target?.name ?? '…'} • ${t('sheet.acShort')} ${previewAc}`}
        description={t('turn.attackRollDescription')}
        placeholder={t('turn.d20Placeholder')}
        d20={true}
        disabled={busy}
        result={pendingResult}
        onContinue={continueFromAttackRoll}
        onSubmit={revealAttackRoll}
        onCancel={() => {
          setModalType(null)
          setPendingResult(null)
          setStep('target')
        }}
      />

      <RollInputModal
        isOpen={modalType === 'attack-damage'}
        title={t('turn.damageRollTitle')}
        subtitle={t('turn.damageRollSubtitle', { attack: pending?.attack.name ?? t('declare.attack'), target: target?.name ?? '…' })}
        description={t('turn.damageRollDescription')}
        placeholder={t('turn.damagePlaceholder')}
        d20={false}
        disabled={busy}
        onSubmit={(value) => {
          void submitAttack(value)
          setModalType(null)
        }}
        onCancel={() => setModalType(null)}
      />
    </div>
  )
}
