import { useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { TokenColorPicker } from '@/components/TokenColorPicker'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { useT } from '@/lib/i18n'
import { ABILITIES, SKILLS, sheetHasBio, sheetHasSpells, type Ability, type Attack, type PlayerCharacter } from '@/lib/types'
import { abilityMod, cn, proficiencyBonus, signed } from '@/lib/utils'
import { copyText } from '@/lib/copy'

type Props = {
  character: PlayerCharacter
  canEdit: boolean
  isDm?: boolean
  onChange: (patch: Partial<PlayerCharacter> & { sheet?: PlayerCharacter['sheet'] }) => void
  onImportPdf?: (file: File) => void
  onRegenCode?: () => void
  onUseAttack?: (attack: Attack, index: number) => void
}

type Tab = 'sheet' | 'spells' | 'notes'

function DeathPips({
  label,
  value,
  canEdit,
  filled,
  onChange,
}: {
  label: string
  value: number
  canEdit: boolean
  filled: string
  onChange: (n: number) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-16 text-[10px] uppercase tracking-wider text-muted">{label}</span>
      {[0, 1, 2].map((i) => (
        <button
          key={i}
          type="button"
          disabled={!canEdit}
          aria-label={`${label} ${i + 1}`}
          className={cn('h-3.5 w-3.5 rounded-full border', i < value ? filled : 'border-line bg-transparent')}
          onClick={() => onChange(i + 1 === value ? i : i + 1)}
        />
      ))}
    </div>
  )
}

export function CharacterSheet({ character, canEdit, isDm, onChange, onImportPdf, onRegenCode, onUseAttack }: Props) {
  const { t } = useT()
  const sheet = character.sheet
  const [tab, setTab] = useState<Tab>('sheet')
  const fileRef = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState(false)
  const pb = proficiencyBonus(sheet.level)
  const tabs: { id: Tab; show: boolean }[] = [
    { id: 'sheet', show: true },
    { id: 'spells', show: canEdit || sheetHasSpells(sheet) },
    { id: 'notes', show: canEdit || sheetHasBio(sheet) },
  ]
  const visibleTabs = tabs.filter((x) => x.show)
  const saveMod = (ab: Ability) => abilityMod(sheet.abilities[ab]) + (sheet.savingThrowProf[ab] ? pb : 0)
  const passive =
    10 +
    abilityMod(sheet.abilities.wis) +
    (sheet.skillProf.perception ? pb : 0) +
    (sheet.skillExpertise.perception ? pb : 0)
  const init = sheet.initiativeBonus ?? abilityMod(sheet.abilities.dex)

  function patchSheet(partial: Partial<PlayerCharacter['sheet']>) {
    onChange({ sheet: { ...sheet, ...partial } })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex items-center gap-1">
        {visibleTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn('rounded-md px-3 py-1.5 text-sm', tab === item.id ? 'bg-gold text-bg' : 'text-muted hover:bg-panel-2')}
          >
            {t(`sheet.tab.${item.id}`)}
          </button>
        ))}
        {canEdit && (
          <div className="ml-auto">
            <TokenColorPicker
              value={character.tokenColor}
              onChange={(tokenColor) => onChange({ tokenColor })}
              label={t('sheet.tokenColor')}
              title={t('sheet.tokenColorTitle')}
            />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin pr-1">
        {tab === 'sheet' && (
          <div className="dnd-sheet grid gap-3">
            <div className="grid gap-3 border-b border-line pb-3 lg:grid-cols-[1fr_auto]">
              <div>
                {canEdit ? (
                  <Input
                    className="h-10 font-display text-lg"
                    aria-label={t('sheet.characterName')}
                    value={character.name}
                    onChange={(e) => onChange({ name: e.target.value })}
                  />
                ) : (
                  <h2 className="font-display text-2xl text-gold-2">{character.name}</h2>
                )}
                <p className="mt-1 text-xs text-muted">
                  {sheet.race || t('sheet.race')} · {sheet.className || t('sheet.adventurer')} {sheet.level} · {t('sheet.playedBy')}{' '}
                  {character.ownerDisplayName || t('sheet.unclaimed')}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
                  <Field label={t('sheet.classLevel')}>
                    <Input disabled={!canEdit} value={sheet.className} onChange={(e) => patchSheet({ className: e.target.value })} />
                  </Field>
                  <Field label={t('sheet.level')}>
                    <Input type="number" disabled={!canEdit} value={sheet.level} onChange={(e) => patchSheet({ level: Number(e.target.value) })} />
                  </Field>
                  <Field label={t('sheet.race')}>
                    <Input disabled={!canEdit} value={sheet.race} onChange={(e) => patchSheet({ race: e.target.value })} />
                  </Field>
                  <Field label={t('sheet.background')}>
                    <Input disabled={!canEdit} value={sheet.background} onChange={(e) => patchSheet({ background: e.target.value })} />
                  </Field>
                  <Field label={t('sheet.alignment')}>
                    <Input disabled={!canEdit} value={sheet.alignment} onChange={(e) => patchSheet({ alignment: e.target.value })} />
                  </Field>
                </div>
              </div>
              <div className="flex flex-col items-start gap-2 lg:items-end">
                {canEdit && onImportPdf && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) onImportPdf(f)
                      }}
                    />
                    <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                      {t('sheet.importPdf')}
                    </Button>
                    {character.sourcePdfUrl && (
                      <a href={character.sourcePdfUrl} target="_blank" rel="noreferrer" className="text-xs text-gold underline-offset-2 hover:underline">
                        {t('sheet.storedPdf')}
                      </a>
                    )}
                  </div>
                )}
                {isDm && character.personalCode && character.personalCode !== '••••••••' && (
                  <p className="flex flex-wrap items-center gap-2 font-mono text-xs text-gold">
                    {t('sheet.personalCode')} {character.personalCode}
                    <button
                      className="inline-flex items-center gap-1 text-gold underline"
                      type="button"
                      onClick={async () => {
                        const ok = await copyText(character.personalCode)
                        if (!ok) return
                        setCopied(true)
                        window.setTimeout(() => setCopied(false), 1600)
                      }}
                    >
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? t('sheet.copied') : t('sheet.copy')}
                    </button>
                    {onRegenCode && (
                      <button className="underline" onClick={onRegenCode} type="button">
                        {t('sheet.regenerate')}
                      </button>
                    )}
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[9.5rem_1fr]">
              <div className="grid grid-cols-3 gap-2 lg:grid-cols-1">
                {ABILITIES.map((ab) => (
                  <div key={ab} className="dnd-stat-box px-1 py-2 text-center">
                    <div className="text-[10px] font-semibold tracking-[0.18em] text-muted">{t(`ability.${ab}`)}</div>
                    <div className="stat-num mt-0.5 text-2xl leading-none text-gold">{signed(abilityMod(sheet.abilities[ab]))}</div>
                    <Input
                      disabled={!canEdit}
                      type="number"
                      className="mx-auto mt-1 h-7 w-12 px-1 text-center text-xs"
                      value={sheet.abilities[ab]}
                      aria-label={t(`abilityName.${ab}`)}
                      onChange={(e) => patchSheet({ abilities: { ...sheet.abilities, [ab]: Number(e.target.value) } })}
                    />
                  </div>
                ))}
              </div>

              <div className="grid gap-3">
                <div className="grid grid-cols-3 gap-2">
                  <div className="dnd-bubble dnd-bubble-ac">
                    <span className="text-[9px] uppercase tracking-wider text-muted">{t('sheet.ac')}</span>
                    <Input
                      type="number"
                      disabled={!canEdit}
                      className="h-8 w-14 border-0 bg-transparent px-0 text-center text-xl"
                      value={sheet.ac}
                      onChange={(e) => patchSheet({ ac: Number(e.target.value) })}
                    />
                  </div>
                  <div className="dnd-bubble">
                    <span className="text-[9px] uppercase tracking-wider text-muted">{t('sheet.initiative')}</span>
                    <div className="stat-num text-xl text-gold">{signed(init)}</div>
                  </div>
                  <div className="dnd-bubble">
                    <span className="text-[9px] uppercase tracking-wider text-muted">{t('sheet.speed')}</span>
                    <Input
                      disabled={!canEdit}
                      className="h-8 w-[4.5rem] border-0 bg-transparent px-0 text-center text-sm"
                      value={sheet.speed}
                      onChange={(e) => patchSheet({ speed: e.target.value })}
                    />
                  </div>
                </div>

                <div className="dnd-panel">
                  <div className="dnd-panel-label">{t('sheet.hp')}</div>
                  <div className="grid grid-cols-3 gap-2">
                    <Field label={t('sheet.hpMax')}>
                      <Input type="number" disabled={!canEdit} value={sheet.hpMax} onChange={(e) => patchSheet({ hpMax: Number(e.target.value) })} />
                    </Field>
                    <Field label={t('sheet.hpCurrent')}>
                      <Input type="number" disabled={!canEdit} value={sheet.hpCurrent} onChange={(e) => patchSheet({ hpCurrent: Number(e.target.value) })} />
                    </Field>
                    <Field label={t('sheet.hpTemp')}>
                      <Input type="number" disabled={!canEdit} value={sheet.hpTemp} onChange={(e) => patchSheet({ hpTemp: Number(e.target.value) })} />
                    </Field>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <Field label={t('sheet.hitDice')}>
                      <Input disabled={!canEdit} value={sheet.hitDice} onChange={(e) => patchSheet({ hitDice: e.target.value })} />
                    </Field>
                    <div>
                      <div className="mb-1 text-xs uppercase tracking-wider text-muted">{t('sheet.deathSaves')}</div>
                      <DeathPips
                        label={t('sheet.successes')}
                        value={sheet.deathSuccess}
                        canEdit={canEdit}
                        filled="border-moss bg-moss"
                        onChange={(n) => patchSheet({ deathSuccess: n })}
                      />
                      <div className="mt-1">
                        <DeathPips
                          label={t('sheet.failures')}
                          value={sheet.deathFail}
                          canEdit={canEdit}
                          filled="border-blood bg-blood"
                          onChange={(n) => patchSheet({ deathFail: n })}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                  <div className="dnd-stat-box px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-muted">{t('sheet.proficiency')}</div>
                    <div className="stat-num text-gold">{signed(pb)}</div>
                  </div>
                  <div className="dnd-stat-box px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-muted">{t('sheet.passivePerception')}</div>
                    <div className="stat-num text-gold">{passive}</div>
                  </div>
                  <div className="dnd-stat-box px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-muted">{t('sheet.xp')}</div>
                    <Input type="number" disabled={!canEdit} className="h-7 px-1 text-sm" value={sheet.xp ?? 0} onChange={(e) => patchSheet({ xp: Number(e.target.value) || 0 })} />
                  </div>
                  <Field label={t('sheet.darkvision')}>
                    <Input
                      type="number"
                      min={0}
                      disabled={!canEdit}
                      placeholder={t('sheet.auto')}
                      value={sheet.darkvisionFt ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value
                        if (raw === '') patchSheet({ darkvisionFt: null })
                        else patchSheet({ darkvisionFt: Math.max(0, Number(raw) || 0) })
                      }}
                    />
                  </Field>
                </div>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="dnd-panel">
                <div className="dnd-panel-label">{t('sheet.saves')}</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {ABILITIES.map((ab) => (
                    <label key={ab} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        disabled={!canEdit}
                        checked={sheet.savingThrowProf[ab]}
                        onChange={(e) => patchSheet({ savingThrowProf: { ...sheet.savingThrowProf, [ab]: e.target.checked } })}
                      />
                      <span className="w-9 text-[11px]">{t(`ability.${ab}`)}</span>
                      <span className="stat-num text-gold">{signed(saveMod(ab))}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="dnd-panel">
                <div className="dnd-panel-label">{t('sheet.skills')}</div>
                <p className="mb-1 text-[10px] text-muted">{t('sheet.expertise')}</p>
                <div className="grid max-h-56 gap-0.5 overflow-y-auto scroll-thin sm:grid-cols-2">
                  {SKILLS.map((sk) => {
                    const bonus =
                      abilityMod(sheet.abilities[sk.ability]) + (sheet.skillProf[sk.key] ? pb : 0) + (sheet.skillExpertise[sk.key] ? pb : 0)
                    return (
                      <div key={sk.key} className="flex items-center gap-1.5 py-0.5 text-sm">
                        <input
                          type="checkbox"
                          disabled={!canEdit}
                          checked={Boolean(sheet.skillProf[sk.key])}
                          onChange={(e) => patchSheet({ skillProf: { ...sheet.skillProf, [sk.key]: e.target.checked } })}
                          aria-label={t(`skill.${sk.key}`)}
                        />
                        <input
                          type="checkbox"
                          disabled={!canEdit}
                          title={t('sheet.expertise')}
                          checked={Boolean(sheet.skillExpertise[sk.key])}
                          onChange={(e) => patchSheet({ skillExpertise: { ...sheet.skillExpertise, [sk.key]: e.target.checked } })}
                          aria-label={`${t(`skill.${sk.key}`)} ${t('sheet.expertise')}`}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {t(`skill.${sk.key}`)} <span className="text-[10px] text-muted">{t(`ability.${sk.ability}`)}</span>
                        </span>
                        <span className="stat-num text-gold">{signed(bonus)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="dnd-panel">
              <div className="dnd-panel-label">{t('sheet.attacks')}</div>
              <div className="hidden text-[10px] uppercase tracking-wider text-muted md:grid md:grid-cols-4 md:gap-2">
                <span>{t('sheet.attackName')}</span>
                <span>{t('sheet.attackBonus')}</span>
                <span>{t('sheet.attackDamage')}</span>
                <span>{t('sheet.attackRange')}</span>
              </div>
              {sheet.attacks.map((atk, i) => (
                <div key={i} className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Input
                    disabled={!canEdit}
                    placeholder={t('sheet.attackName')}
                    value={atk.name}
                    onChange={(e) => {
                      const attacks = sheet.attacks.slice()
                      attacks[i] = { ...atk, name: e.target.value }
                      patchSheet({ attacks })
                    }}
                  />
                  <Input
                    disabled={!canEdit}
                    placeholder={t('sheet.attackBonus')}
                    value={atk.bonus}
                    onChange={(e) => {
                      const attacks = sheet.attacks.slice()
                      attacks[i] = { ...atk, bonus: e.target.value }
                      patchSheet({ attacks })
                    }}
                  />
                  <Input
                    disabled={!canEdit}
                    placeholder={t('sheet.attackDamage')}
                    value={atk.damage}
                    onChange={(e) => {
                      const attacks = sheet.attacks.slice()
                      attacks[i] = { ...atk, damage: e.target.value }
                      patchSheet({ attacks })
                    }}
                  />
                  <div className="flex gap-1">
                    <Input
                      disabled={!canEdit}
                      placeholder={t('sheet.attackRange')}
                      value={atk.range ?? '5 ft.'}
                      onChange={(e) => {
                        const attacks = sheet.attacks.slice()
                        attacks[i] = { ...atk, range: e.target.value }
                        patchSheet({ attacks })
                      }}
                    />
                    {onUseAttack && atk.name.trim() && (
                      <Button size="sm" variant="ember" type="button" onClick={() => onUseAttack(atk, i)}>
                        {t('sheet.use')}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {canEdit && (
                <Button variant="ghost" size="sm" onClick={() => patchSheet({ attacks: [...sheet.attacks, { name: '', bonus: '', damage: '', range: '5 ft.' }] })}>
                  {t('sheet.addAttack')}
                </Button>
              )}
            </div>

            <div className="dnd-panel">
              <div className="dnd-panel-label">{t('sheet.resources')}</div>
              <p className="mb-2 text-xs text-muted">{t('sheet.resourcesHint')}</p>
              {(sheet.resources ?? []).map((res, i) => (
                <div key={i} className="mb-2 grid grid-cols-2 gap-1 sm:grid-cols-[1fr_3.5rem_3.5rem_6.5rem_auto] sm:items-center">
                  <Input
                    disabled={!canEdit}
                    placeholder={t('sheet.attackName')}
                    value={res.name}
                    onChange={(e) => {
                      const resources = (sheet.resources ?? []).slice()
                      resources[i] = { ...res, name: e.target.value }
                      patchSheet({ resources })
                    }}
                  />
                  <Input
                    type="number"
                    disabled={!canEdit}
                    value={res.current}
                    onChange={(e) => {
                      const resources = (sheet.resources ?? []).slice()
                      resources[i] = { ...res, current: Number(e.target.value) }
                      patchSheet({ resources })
                    }}
                  />
                  <Input
                    type="number"
                    disabled={!canEdit}
                    value={res.max}
                    onChange={(e) => {
                      const resources = (sheet.resources ?? []).slice()
                      resources[i] = { ...res, max: Number(e.target.value) }
                      patchSheet({ resources })
                    }}
                  />
                  <select
                    className="h-10 rounded-md border border-line bg-bg px-1 text-xs"
                    disabled={!canEdit}
                    value={res.reset}
                    onChange={(e) => {
                      const resources = (sheet.resources ?? []).slice()
                      resources[i] = { ...res, reset: e.target.value as typeof res.reset }
                      patchSheet({ resources })
                    }}
                  >
                    <option value="short">{t('sheet.reset.short')}</option>
                    <option value="long">{t('sheet.reset.long')}</option>
                    <option value="manual">{t('sheet.reset.manual')}</option>
                  </select>
                  {canEdit && (
                    <button type="button" className="text-blood" onClick={() => patchSheet({ resources: (sheet.resources ?? []).filter((_, j) => j !== i) })}>
                      ×
                    </button>
                  )}
                </div>
              ))}
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => patchSheet({ resources: [...(sheet.resources ?? []), { name: '', current: 1, max: 1, reset: 'long' }] })}
                  >
                    {t('sheet.addResource')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      patchSheet({
                        resources: (sheet.resources ?? []).map((r) => (r.reset === 'short' || r.reset === 'long' ? { ...r, current: r.max } : r)),
                      })
                    }
                  >
                    {t('sheet.shortRest')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => patchSheet({ resources: (sheet.resources ?? []).map((r) => (r.reset === 'manual' ? r : { ...r, current: r.max })) })}
                  >
                    {t('sheet.longRest')}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'spells' && (
          <div className="dnd-sheet grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('sheet.spellcasting')}>
                <select
                  disabled={!canEdit}
                  className="h-10 rounded-md border border-line bg-bg px-3 text-sm"
                  value={sheet.spellcastingAbility}
                  onChange={(e) => patchSheet({ spellcastingAbility: e.target.value as Ability | '' })}
                >
                  <option value="">—</option>
                  {ABILITIES.map((ab) => (
                    <option key={ab} value={ab}>
                      {t(`abilityName.${ab}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="text-sm text-muted">
                {sheet.spellcastingAbility ? (
                  <>
                    {t('sheet.spellDc')} {8 + pb + abilityMod(sheet.abilities[sheet.spellcastingAbility])} · {t('sheet.spellAttack')}{' '}
                    {signed(pb + abilityMod(sheet.abilities[sheet.spellcastingAbility]))}
                  </>
                ) : (
                  t('sheet.setAbility')
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 md:grid-cols-9">
              {sheet.spellSlots.map((max, i) => (
                <Field key={i} label={`L${i + 1}`}>
                  <div className="flex gap-1">
                    <Input
                      type="number"
                      disabled={!canEdit}
                      value={sheet.spellSlotsUsed[i] ?? 0}
                      onChange={(e) => {
                        const spellSlotsUsed = sheet.spellSlotsUsed.slice()
                        spellSlotsUsed[i] = Number(e.target.value)
                        patchSheet({ spellSlotsUsed })
                      }}
                    />
                    <Input
                      type="number"
                      disabled={!canEdit}
                      value={max}
                      onChange={(e) => {
                        const spellSlots = sheet.spellSlots.slice()
                        spellSlots[i] = Number(e.target.value)
                        patchSheet({ spellSlots })
                      }}
                    />
                  </div>
                </Field>
              ))}
            </div>
            {sheet.spells.map((sp, i) => (
              <div key={i} className="grid grid-cols-[2rem_1fr_4rem] items-center gap-2">
                <Input
                  type="number"
                  disabled={!canEdit}
                  value={sp.level}
                  onChange={(e) => {
                    const spells = sheet.spells.slice()
                    spells[i] = { ...sp, level: Number(e.target.value) }
                    patchSheet({ spells })
                  }}
                />
                <Input
                  disabled={!canEdit}
                  value={sp.name}
                  onChange={(e) => {
                    const spells = sheet.spells.slice()
                    spells[i] = { ...sp, name: e.target.value }
                    patchSheet({ spells })
                  }}
                />
                <label className="text-xs text-muted">
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={sp.prepared}
                    onChange={(e) => {
                      const spells = sheet.spells.slice()
                      spells[i] = { ...sp, prepared: e.target.checked }
                      patchSheet({ spells })
                    }}
                  />{' '}
                  {t('sheet.prepared')}
                </label>
              </div>
            ))}
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={() => patchSheet({ spells: [...sheet.spells, { name: '', level: 1, prepared: true }] })}>
                {t('sheet.addSpell')}
              </Button>
            )}
          </div>
        )}

        {tab === 'notes' && (
          <div className="dnd-sheet grid gap-3">
            <Field label={t('sheet.playerName')}>
              <Input disabled={!canEdit} value={character.ownerDisplayName} onChange={(e) => onChange({ ownerDisplayName: e.target.value })} />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t('sheet.personality')}>
                <Textarea disabled={!canEdit} value={sheet.personality} onChange={(e) => patchSheet({ personality: e.target.value })} />
              </Field>
              <Field label={t('sheet.ideals')}>
                <Textarea disabled={!canEdit} value={sheet.ideals} onChange={(e) => patchSheet({ ideals: e.target.value })} />
              </Field>
              <Field label={t('sheet.bonds')}>
                <Textarea disabled={!canEdit} value={sheet.bonds} onChange={(e) => patchSheet({ bonds: e.target.value })} />
              </Field>
              <Field label={t('sheet.flaws')}>
                <Textarea disabled={!canEdit} value={sheet.flaws} onChange={(e) => patchSheet({ flaws: e.target.value })} />
              </Field>
            </div>
            <Field label={t('sheet.features')}>
              <Textarea disabled={!canEdit} value={sheet.features} onChange={(e) => patchSheet({ features: e.target.value })} />
            </Field>
            <Field label={t('sheet.equipment')}>
              <Textarea disabled={!canEdit} value={sheet.equipment} onChange={(e) => patchSheet({ equipment: e.target.value })} />
            </Field>
            <Field label={t('sheet.notes')}>
              <Textarea disabled={!canEdit} value={sheet.notes} onChange={(e) => patchSheet({ notes: e.target.value })} />
            </Field>
          </div>
        )}
      </div>
    </div>
  )
}
