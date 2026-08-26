import { useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { TokenColorPicker } from '@/components/TokenColorPicker'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { ABILITIES, ABILITY_LABELS, SKILLS, sheetHasBio, sheetHasSkills, sheetHasSpells, type Ability, type Attack, type PlayerCharacter } from '@/lib/types'
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

const tabs = ['Combat', 'Skills', 'Spells', 'Bio'] as const

export function CharacterSheet({ character, canEdit, isDm, onChange, onImportPdf, onRegenCode, onUseAttack }: Props) {
  const sheet = character.sheet
  const [tab, setTab] = useState<(typeof tabs)[number]>('Combat')
  const fileRef = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState(false)
  const pb = proficiencyBonus(sheet.level)
  const visibleTabs = tabs.filter((t) => {
    if (t === 'Combat') return true
    if (t === 'Skills') return canEdit || sheetHasSkills(sheet)
    if (t === 'Spells') return canEdit || sheetHasSpells(sheet)
    return canEdit || sheetHasBio(sheet)
  })

  function patchSheet(partial: Partial<PlayerCharacter['sheet']>) {
    onChange({ sheet: { ...sheet, ...partial } })
  }

  const saveMod = (ab: Ability) => abilityMod(sheet.abilities[ab]) + (sheet.savingThrowProf[ab] ? pb : 0)

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
        <div>
          {canEdit ? (
            <Input className="h-9 font-display text-lg" value={character.name} onChange={(e) => onChange({ name: e.target.value })} />
          ) : (
            <h2 className="font-display text-2xl text-gold-2">{character.name}</h2>
          )}
          <p className="mt-1 text-sm text-muted">
            {sheet.race} {sheet.className || 'Adventurer'} · played by {character.ownerDisplayName || 'unclaimed'}
          </p>
          {canEdit && (
            <div className="mt-3">
              <TokenColorPicker value={character.tokenColor} onChange={(tokenColor) => onChange({ tokenColor })} />
            </div>
          )}
          {isDm && character.personalCode && character.personalCode !== '••••••••' && (
            <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-gold">
              Personal code {character.personalCode}
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
                {copied ? 'Copied' : 'Copy'}
              </button>
              {onRegenCode && (
                <button className="underline" onClick={onRegenCode} type="button">
                  regenerate
                </button>
              )}
            </p>
          )}
        </div>
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
              Import PDF
            </Button>
            <span className="text-xs text-muted">D&amp;D Beyond character PDFs or a fillable 5e sheet.</span>
            {character.sourcePdfUrl && (
              <a
                href={character.sourcePdfUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-gold underline-offset-2 hover:underline"
              >
                Stored PDF
              </a>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 flex gap-1">
        {visibleTabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn('rounded-md px-3 py-1.5 text-sm', tab === t ? 'bg-gold text-bg' : 'text-muted hover:bg-panel-2')}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-4 flex-1 overflow-y-auto scroll-thin pr-1">
        {tab === 'Combat' && (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Field label="Class / level">
                <Input disabled={!canEdit} value={sheet.className} onChange={(e) => patchSheet({ className: e.target.value })} />
              </Field>
              <Field label="Level">
                <Input
                  type="number"
                  disabled={!canEdit}
                  value={sheet.level}
                  onChange={(e) => patchSheet({ level: Number(e.target.value) })}
                />
              </Field>
              <Field label="XP">
                <Input
                  type="number"
                  disabled={!canEdit}
                  value={sheet.xp ?? 0}
                  onChange={(e) => patchSheet({ xp: Number(e.target.value) || 0 })}
                />
              </Field>
              <Field label="Race">
                <Input disabled={!canEdit} value={sheet.race} onChange={(e) => patchSheet({ race: e.target.value })} />
              </Field>
              <Field label="Alignment">
                <Input disabled={!canEdit} value={sheet.alignment} onChange={(e) => patchSheet({ alignment: e.target.value })} />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
              {ABILITIES.map((ab) => (
                <div key={ab} className="rounded-md border border-line bg-bg p-2 text-center">
                  <div className="text-[10px] uppercase tracking-wider text-muted">{ABILITY_LABELS[ab]}</div>
                  <Input
                    disabled={!canEdit}
                    type="number"
                    className="mt-1 h-9 text-center"
                    value={sheet.abilities[ab]}
                    onChange={(e) => patchSheet({ abilities: { ...sheet.abilities, [ab]: Number(e.target.value) } })}
                  />
                  <div className="stat-num mt-1 text-gold">{signed(abilityMod(sheet.abilities[ab]))}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
              <Field label="Armor class">
                <Input type="number" disabled={!canEdit} value={sheet.ac} onChange={(e) => patchSheet({ ac: Number(e.target.value) })} />
              </Field>
              <Field label="HP current">
                <Input type="number" disabled={!canEdit} value={sheet.hpCurrent} onChange={(e) => patchSheet({ hpCurrent: Number(e.target.value) })} />
              </Field>
              <Field label="HP max">
                <Input type="number" disabled={!canEdit} value={sheet.hpMax} onChange={(e) => patchSheet({ hpMax: Number(e.target.value) })} />
              </Field>
              <Field label="Temp HP">
                <Input type="number" disabled={!canEdit} value={sheet.hpTemp} onChange={(e) => patchSheet({ hpTemp: Number(e.target.value) })} />
              </Field>
              <Field label="Hit dice">
                <Input disabled={!canEdit} value={sheet.hitDice} onChange={(e) => patchSheet({ hitDice: e.target.value })} />
              </Field>
              <Field label="Speed">
                <Input disabled={!canEdit} value={sheet.speed} onChange={(e) => patchSheet({ speed: e.target.value })} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Field label="Death successes">
                <Input type="number" min={0} max={3} disabled={!canEdit} value={sheet.deathSuccess} onChange={(e) => patchSheet({ deathSuccess: Math.max(0, Math.min(3, Number(e.target.value))) })} />
              </Field>
              <Field label="Death failures">
                <Input type="number" min={0} max={3} disabled={!canEdit} value={sheet.deathFail} onChange={(e) => patchSheet({ deathFail: Math.max(0, Math.min(3, Number(e.target.value))) })} />
              </Field>
            </div>
            <p className="text-sm text-muted">
              Proficiency bonus {signed(pb)} · Initiative {signed(sheet.initiativeBonus ?? abilityMod(sheet.abilities.dex))} · Passive Perception{' '}
              {10 +
                abilityMod(sheet.abilities.wis) +
                (sheet.skillProf.perception ? pb : 0) +
                (sheet.skillExpertise.perception ? pb : 0)}
            </p>
            <div>
              <div className="mb-2 text-xs uppercase tracking-wider text-muted">Saving throws</div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                {ABILITIES.map((ab) => (
                  <label key={ab} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={!canEdit}
                      checked={sheet.savingThrowProf[ab]}
                      onChange={(e) => patchSheet({ savingThrowProf: { ...sheet.savingThrowProf, [ab]: e.target.checked } })}
                    />
                    <span className="w-10">{ABILITY_LABELS[ab]}</span>
                    <span className="stat-num text-gold">{signed(saveMod(ab))}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs uppercase tracking-wider text-muted">Attacks</div>
              {sheet.attacks.map((atk, i) => (
                <div key={i} className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Input
                    disabled={!canEdit}
                    placeholder="Name"
                    value={atk.name}
                    onChange={(e) => {
                      const attacks = sheet.attacks.slice()
                      attacks[i] = { ...atk, name: e.target.value }
                      patchSheet({ attacks })
                    }}
                  />
                  <Input
                    disabled={!canEdit}
                    placeholder="Bonus"
                    value={atk.bonus}
                    onChange={(e) => {
                      const attacks = sheet.attacks.slice()
                      attacks[i] = { ...atk, bonus: e.target.value }
                      patchSheet({ attacks })
                    }}
                  />
                  <Input
                    disabled={!canEdit}
                    placeholder="Damage"
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
                      placeholder="Range"
                      value={atk.range ?? '5 ft.'}
                      onChange={(e) => {
                        const attacks = sheet.attacks.slice()
                        attacks[i] = { ...atk, range: e.target.value }
                        patchSheet({ attacks })
                      }}
                    />
                    {onUseAttack && atk.name.trim() && (
                      <Button size="sm" variant="ember" type="button" onClick={() => onUseAttack(atk, i)}>
                        Use
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => patchSheet({ attacks: [...sheet.attacks, { name: '', bonus: '', damage: '', range: '5 ft.' }] })}
                >
                  Add attack
                </Button>
              )}
            </div>
            <div>
              <div className="mb-2 text-xs uppercase tracking-wider text-muted">Resources</div>
              <p className="mb-2 text-xs text-muted">Spell slots, Second Wind, Rage, or anything with uses. Short/long rest reset current to max.</p>
              {(sheet.resources ?? []).map((res, i) => (
                <div key={i} className="mb-2 grid grid-cols-2 gap-1 sm:grid-cols-[1fr_3.5rem_3.5rem_6rem_auto] sm:items-center">
                  <Input
                    disabled={!canEdit}
                    placeholder="Name"
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
                    aria-label="Current"
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
                    aria-label="Max"
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
                    <option value="short">Short rest</option>
                    <option value="long">Long rest</option>
                    <option value="manual">Manual</option>
                  </select>
                  {canEdit && (
                    <button
                      type="button"
                      className="text-blood"
                      onClick={() => patchSheet({ resources: (sheet.resources ?? []).filter((_, j) => j !== i) })}
                    >
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
                    onClick={() =>
                      patchSheet({ resources: [...(sheet.resources ?? []), { name: '', current: 1, max: 1, reset: 'long' }] })
                    }
                  >
                    Add resource
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      patchSheet({
                        resources: (sheet.resources ?? []).map((r) =>
                          r.reset === 'short' || r.reset === 'long' ? { ...r, current: r.max } : r,
                        ),
                      })
                    }
                  >
                    Short rest
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      patchSheet({
                        resources: (sheet.resources ?? []).map((r) => (r.reset === 'manual' ? r : { ...r, current: r.max })),
                      })
                    }
                  >
                    Long rest
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'Skills' && (
          <div className="grid gap-2">
            {SKILLS.map((sk) => {
              const bonus =
                abilityMod(sheet.abilities[sk.ability]) + (sheet.skillProf[sk.key] ? pb : 0) + (sheet.skillExpertise[sk.key] ? pb : 0)
              return (
                <div key={sk.key} className="flex items-center gap-3 rounded-md border border-line/60 px-2 py-1.5">
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={Boolean(sheet.skillProf[sk.key])}
                    onChange={(e) => patchSheet({ skillProf: { ...sheet.skillProf, [sk.key]: e.target.checked } })}
                  />
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    title="Expertise"
                    checked={Boolean(sheet.skillExpertise[sk.key])}
                    onChange={(e) => patchSheet({ skillExpertise: { ...sheet.skillExpertise, [sk.key]: e.target.checked } })}
                  />
                  <span className="flex-1 text-sm">
                    {sk.name} <span className="text-muted">({sk.ability})</span>
                  </span>
                  <span className="stat-num text-gold">{signed(bonus)}</span>
                </div>
              )
            })}
            <p className="text-xs text-muted">Second checkbox is expertise.</p>
          </div>
        )}

        {tab === 'Spells' && (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Spellcasting ability">
                <select
                  disabled={!canEdit}
                  className="h-10 rounded-md border border-line bg-bg px-3 text-sm"
                  value={sheet.spellcastingAbility}
                  onChange={(e) => patchSheet({ spellcastingAbility: e.target.value as Ability | '' })}
                >
                  <option value="">—</option>
                  {ABILITIES.map((ab) => (
                    <option key={ab} value={ab}>
                      {ABILITY_LABELS[ab]}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="text-sm text-muted">
                {sheet.spellcastingAbility ? (
                  <>
                    Save DC {8 + pb + abilityMod(sheet.abilities[sheet.spellcastingAbility])} · Attack{' '}
                    {signed(pb + abilityMod(sheet.abilities[sheet.spellcastingAbility]))}
                  </>
                ) : (
                  'Set an ability to compute DC and attack bonus.'
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
                      aria-label={`Level ${i + 1} used`}
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
                      aria-label={`Level ${i + 1} max`}
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
                  prep
                </label>
              </div>
            ))}
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={() => patchSheet({ spells: [...sheet.spells, { name: '', level: 1, prepared: true }] })}>
                Add spell
              </Button>
            )}
          </div>
        )}

        {tab === 'Bio' && (
          <div className="grid gap-3">
            <Field label="Player name">
              <Input disabled={!canEdit} value={character.ownerDisplayName} onChange={(e) => onChange({ ownerDisplayName: e.target.value })} />
            </Field>
            <Field label="Personality">
              <Textarea disabled={!canEdit} value={sheet.personality} onChange={(e) => patchSheet({ personality: e.target.value })} />
            </Field>
            <Field label="Ideals">
              <Textarea disabled={!canEdit} value={sheet.ideals} onChange={(e) => patchSheet({ ideals: e.target.value })} />
            </Field>
            <Field label="Bonds">
              <Textarea disabled={!canEdit} value={sheet.bonds} onChange={(e) => patchSheet({ bonds: e.target.value })} />
            </Field>
            <Field label="Flaws">
              <Textarea disabled={!canEdit} value={sheet.flaws} onChange={(e) => patchSheet({ flaws: e.target.value })} />
            </Field>
            <Field label="Features">
              <Textarea disabled={!canEdit} value={sheet.features} onChange={(e) => patchSheet({ features: e.target.value })} />
            </Field>
            <Field label="Equipment">
              <Textarea disabled={!canEdit} value={sheet.equipment} onChange={(e) => patchSheet({ equipment: e.target.value })} />
            </Field>
            <Field label="Notes">
              <Textarea disabled={!canEdit} value={sheet.notes} onChange={(e) => patchSheet({ notes: e.target.value })} />
            </Field>
          </div>
        )}
      </div>
    </div>
  )
}
