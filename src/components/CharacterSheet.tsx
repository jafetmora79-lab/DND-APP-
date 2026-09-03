import { type ReactNode, useRef, useState } from 'react'
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
  onUseAttack?: (attack: Attack, index: number) => void
}

type Tab = 'sheet' | 'spells' | 'notes'

function SheetCell({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('sheet-cell', className)}>
      {children}
      <div className="sheet-cell-label">{label}</div>
    </div>
  )
}

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
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="min-w-0 shrink text-[10px] uppercase leading-tight tracking-wide text-muted">{label}</span>
      <span className="ml-auto flex shrink-0 gap-1">
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
      </span>
    </div>
  )
}

function TinyNum({
  value,
  disabled,
  onChange,
  ariaLabel,
}: {
  value: string | number
  disabled: boolean
  onChange: (raw: string) => void
  ariaLabel: string
}) {
  return (
    <Input
      disabled={disabled}
      aria-label={ariaLabel}
      className="h-8 border-0 bg-transparent px-0 text-center text-lg leading-none"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export function CharacterSheet({ character, canEdit, isDm, onChange, onImportPdf, onUseAttack }: Props) {
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
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="mb-2 flex min-w-0 items-center gap-1">
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

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden scroll-thin pr-1">
        {tab === 'sheet' && (
          <div className="dnd-sheet grid gap-3">
            <div className="grid min-w-0 gap-2 border-b border-line pb-3">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
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
                  <p className="mt-1 truncate text-xs text-muted">
                    {sheet.race || t('sheet.race')} · {sheet.className || t('sheet.adventurer')} · {t('sheet.playedBy')}{' '}
                    {character.ownerDisplayName || t('sheet.unclaimed')}
                  </p>
                </div>
                <div className="flex max-w-full shrink-0 flex-col items-end gap-1">
                  {canEdit && onImportPdf && (
                    <div className="flex flex-wrap items-center justify-end gap-2">
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
                  {isDm && character.name && (
                    <p className="flex max-w-full flex-wrap items-center justify-end gap-2 text-xs text-gold">
                      <span className="truncate">
                        {t('sheet.joinAs')} {character.name}
                      </span>
                      <button
                        className="inline-flex items-center gap-1 text-gold underline"
                        type="button"
                        onClick={async () => {
                          const ok = await copyText(character.name)
                          if (!ok) return
                          setCopied(true)
                          window.setTimeout(() => setCopied(false), 1600)
                        }}
                      >
                        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {copied ? t('sheet.copied') : t('sheet.copy')}
                      </button>
                    </p>
                  )}
                </div>
              </div>
              <div className="grid min-w-0 grid-cols-2 gap-2 @min-[24rem]:grid-cols-3">
                <SheetCell label={t('sheet.classLevel')}>
                  <Input
                    disabled={!canEdit}
                    className="h-8 border-0 bg-transparent px-1 text-center text-sm"
                    value={sheet.className}
                    onChange={(e) => patchSheet({ className: e.target.value })}
                  />
                </SheetCell>
                <SheetCell label={t('sheet.level')}>
                  <TinyNum
                    disabled={!canEdit}
                    ariaLabel={t('sheet.level')}
                    value={sheet.level}
                    onChange={(raw) => patchSheet({ level: Number(raw) })}
                  />
                </SheetCell>
                <SheetCell label={t('sheet.race')}>
                  <Input
                    disabled={!canEdit}
                    className="h-8 border-0 bg-transparent px-1 text-center text-sm"
                    value={sheet.race}
                    onChange={(e) => patchSheet({ race: e.target.value })}
                  />
                </SheetCell>
                <SheetCell label={t('sheet.background')}>
                  <Input
                    disabled={!canEdit}
                    className="h-8 border-0 bg-transparent px-1 text-center text-sm"
                    value={sheet.background}
                    onChange={(e) => patchSheet({ background: e.target.value })}
                  />
                </SheetCell>
                <SheetCell label={t('sheet.alignment')}>
                  <Input
                    disabled={!canEdit}
                    className="h-8 border-0 bg-transparent px-1 text-center text-sm"
                    value={sheet.alignment}
                    onChange={(e) => patchSheet({ alignment: e.target.value })}
                  />
                </SheetCell>
                <SheetCell label={t('sheet.playerName')}>
                  <Input
                    disabled={!canEdit}
                    className="h-8 border-0 bg-transparent px-1 text-center text-sm"
                    value={character.ownerDisplayName}
                    onChange={(e) => onChange({ ownerDisplayName: e.target.value })}
                  />
                </SheetCell>
              </div>
            </div>

            <div className="grid min-w-0 gap-3 @min-[36rem]:grid-cols-[7.25rem_minmax(0,1fr)]">
              <div className="grid grid-cols-3 gap-2 @min-[36rem]:grid-cols-1">
                {ABILITIES.map((ab) => (
                  <div key={ab} className="sheet-cell sheet-ability">
                    <div className="text-[10px] font-semibold tracking-[0.12em] text-muted">{t(`ability.${ab}`)}</div>
                    <div className="stat-num text-2xl leading-none text-gold">{signed(abilityMod(sheet.abilities[ab]))}</div>
                    <div className="sheet-ability-score">
                      <input
                        disabled={!canEdit}
                        type="number"
                        aria-label={t(`abilityName.${ab}`)}
                        value={sheet.abilities[ab]}
                        onChange={(e) => patchSheet({ abilities: { ...sheet.abilities, [ab]: Number(e.target.value) } })}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid min-w-0 gap-2">
                <div className="grid grid-cols-3 gap-2">
                  <SheetCell className="sheet-shield" label={t('sheet.acShort')}>
                    <TinyNum disabled={!canEdit} ariaLabel={t('sheet.ac')} value={sheet.ac} onChange={(raw) => patchSheet({ ac: Number(raw) })} />
                  </SheetCell>
                  <SheetCell className="sheet-shield" label={t('sheet.initShort')}>
                    <div className="stat-num text-xl leading-none text-gold">{signed(init)}</div>
                  </SheetCell>
                  <SheetCell className="sheet-shield" label={t('sheet.speedShort')}>
                    <Input
                      disabled={!canEdit}
                      aria-label={t('sheet.speed')}
                      className="h-8 border-0 bg-transparent px-0 text-center text-sm"
                      value={sheet.speed}
                      onChange={(e) => patchSheet({ speed: e.target.value })}
                    />
                  </SheetCell>
                </div>

                <div className="dnd-panel">
                  <div className="dnd-panel-label">{t('sheet.hp')}</div>
                  <div className="grid grid-cols-3 gap-2">
                    <SheetCell label={t('sheet.hpMaxShort')}>
                      <TinyNum disabled={!canEdit} ariaLabel={t('sheet.hpMax')} value={sheet.hpMax} onChange={(raw) => patchSheet({ hpMax: Number(raw) })} />
                    </SheetCell>
                    <SheetCell label={t('sheet.hpCurrentShort')}>
                      <TinyNum
                        disabled={!canEdit}
                        ariaLabel={t('sheet.hpCurrent')}
                        value={sheet.hpCurrent}
                        onChange={(raw) => patchSheet({ hpCurrent: Number(raw) })}
                      />
                    </SheetCell>
                    <SheetCell label={t('sheet.hpTempShort')}>
                      <TinyNum disabled={!canEdit} ariaLabel={t('sheet.hpTemp')} value={sheet.hpTemp} onChange={(raw) => patchSheet({ hpTemp: Number(raw) })} />
                    </SheetCell>
                  </div>
                  <div className="mt-2 grid min-w-0 gap-2 @min-[24rem]:grid-cols-2">
                    <SheetCell label={t('sheet.hitDice')}>
                      <Input
                        disabled={!canEdit}
                        className="h-8 border-0 bg-transparent px-1 text-center text-sm"
                        value={sheet.hitDice}
                        onChange={(e) => patchSheet({ hitDice: e.target.value })}
                      />
                    </SheetCell>
                    <div className="sheet-cell items-stretch justify-center px-2">
                      <div className="sheet-cell-label mb-1">{t('sheet.deathSaves')}</div>
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

                <div className="grid grid-cols-2 gap-2 @min-[24rem]:grid-cols-4">
                  <SheetCell label={t('sheet.profShort')}>
                    <div className="stat-num text-lg text-gold">{signed(pb)}</div>
                  </SheetCell>
                  <SheetCell label={t('sheet.ppShort')}>
                    <div className="stat-num text-lg text-gold">{passive}</div>
                  </SheetCell>
                  <SheetCell label={t('sheet.xpShort')}>
                    <TinyNum disabled={!canEdit} ariaLabel={t('sheet.xp')} value={sheet.xp ?? 0} onChange={(raw) => patchSheet({ xp: Number(raw) || 0 })} />
                  </SheetCell>
                  <SheetCell label={t('sheet.dvShort')}>
                    <Input
                      type="number"
                      min={0}
                      disabled={!canEdit}
                      aria-label={t('sheet.darkvision')}
                      placeholder={t('sheet.auto')}
                      className="h-8 border-0 bg-transparent px-0 text-center text-sm"
                      value={sheet.darkvisionFt ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value
                        if (raw === '') patchSheet({ darkvisionFt: null })
                        else patchSheet({ darkvisionFt: Math.max(0, Number(raw) || 0) })
                      }}
                    />
                  </SheetCell>
                </div>
              </div>
            </div>

            <div className="grid min-w-0 gap-3 @min-[36rem]:grid-cols-2">
              <div className="dnd-panel">
                <div className="dnd-panel-label">{t('sheet.saves')}</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {ABILITIES.map((ab) => (
                    <label key={ab} className="flex min-w-0 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        disabled={!canEdit}
                        checked={sheet.savingThrowProf[ab]}
                        onChange={(e) => patchSheet({ savingThrowProf: { ...sheet.savingThrowProf, [ab]: e.target.checked } })}
                      />
                      <span className="w-9 shrink-0 text-[11px]">{t(`ability.${ab}`)}</span>
                      <span className="stat-num text-gold">{signed(saveMod(ab))}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="dnd-panel">
                <div className="dnd-panel-label">{t('sheet.skills')}</div>
                <p className="mb-1 text-[10px] text-muted">{t('sheet.expertise')}</p>
                <div className="grid max-h-56 gap-0.5 overflow-y-auto scroll-thin @min-[24rem]:grid-cols-2">
                  {SKILLS.map((sk) => {
                    const bonus =
                      abilityMod(sheet.abilities[sk.ability]) + (sheet.skillProf[sk.key] ? pb : 0) + (sheet.skillExpertise[sk.key] ? pb : 0)
                    return (
                      <div key={sk.key} className="flex min-w-0 items-center gap-1.5 py-0.5 text-sm">
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
                        <span className="stat-num shrink-0 text-gold">{signed(bonus)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="dnd-panel">
              <div className="dnd-panel-label">{t('sheet.attacks')}</div>
              <div className="mb-2 max-w-[10rem]">
                <Field label={t('sheet.attacksPerAction')}>
                  <Input
                    disabled={!canEdit}
                    type="number"
                    min={1}
                    max={6}
                    value={sheet.attacksPerAction ?? 1}
                    onChange={(e) => patchSheet({ attacksPerAction: Math.max(1, Number(e.target.value) || 1) })}
                  />
                </Field>
                <p className="mt-1 text-[10px] text-muted">{t('sheet.attacksPerActionHint')}</p>
              </div>
              <div className="mb-1 hidden text-[10px] uppercase tracking-wider text-muted @min-[32rem]:grid @min-[32rem]:grid-cols-4 @min-[32rem]:gap-2">
                <span>{t('sheet.attackName')}</span>
                <span>{t('sheet.attackBonus')}</span>
                <span>{t('sheet.attackDamage')}</span>
                <span>{t('sheet.attackRange')}</span>
              </div>
              {sheet.attacks.map((atk, i) => (
                <div key={i} className="mb-2 grid min-w-0 grid-cols-2 gap-2 @min-[32rem]:grid-cols-4">
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
                  <div className="flex min-w-0 gap-1">
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
                <div key={i} className="mb-2 grid min-w-0 grid-cols-2 gap-1 @min-[32rem]:grid-cols-[1fr_3.5rem_3.5rem_6.5rem_auto] @min-[32rem]:items-center">
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
            <div className="grid grid-cols-3 gap-2 @min-[40rem]:grid-cols-9">
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
              <div key={i} className="grid grid-cols-[2rem_1fr_4rem_5.5rem] items-center gap-2">
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
                <label className="text-xs text-muted">
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={sp.concentration}
                    onChange={(e) => {
                      const spells = sheet.spells.slice()
                      spells[i] = { ...sp, concentration: e.target.checked }
                      patchSheet({ spells })
                    }}
                  />{' '}
                  {t('sheet.concentration')}
                </label>
              </div>
            ))}
            {canEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => patchSheet({ spells: [...sheet.spells, { name: '', level: 1, prepared: true, concentration: false }] })}
              >
                {t('sheet.addSpell')}
              </Button>
            )}
          </div>
        )}

        {tab === 'notes' && (
          <div className="dnd-sheet grid gap-3">
            <div className="grid gap-3 @min-[28rem]:grid-cols-2">
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
