import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { ABILITIES, ABILITY_LABELS, SKILLS, sheetHasBio, sheetHasSkills, sheetHasSpells, type Ability, type PlayerCharacter } from '@/lib/types'
import { abilityMod, cn, proficiencyBonus, signed } from '@/lib/utils'

type Props = {
  character: PlayerCharacter
  canEdit: boolean
  isDm?: boolean
  onChange: (patch: Partial<PlayerCharacter> & { sheet?: PlayerCharacter['sheet'] }) => void
  onImportPdf?: (file: File) => void
  onRegenCode?: () => void
}

const tabs = ['Combat', 'Skills', 'Spells', 'Bio'] as const

export function CharacterSheet({ character, canEdit, isDm, onChange, onImportPdf, onRegenCode }: Props) {
  const sheet = character.sheet
  const [tab, setTab] = useState<(typeof tabs)[number]>('Combat')
  const fileRef = useRef<HTMLInputElement>(null)
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
          {isDm && (
            <p className="mt-1 font-mono text-xs text-gold">
              Personal code {character.personalCode}{' '}
              {onRegenCode && (
                <button className="underline" onClick={onRegenCode} type="button">
                  regenerate
                </button>
              )}
            </p>
          )}
        </div>
        {canEdit && onImportPdf && (
          <div>
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
              Import fillable PDF
            </Button>
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
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
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
              <Field label="Speed">
                <Input disabled={!canEdit} value={sheet.speed} onChange={(e) => patchSheet({ speed: e.target.value })} />
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
                <div key={i} className="mb-2 grid grid-cols-3 gap-2">
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
                </div>
              ))}
              {canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => patchSheet({ attacks: [...sheet.attacks, { name: '', bonus: '', damage: '' }] })}
                >
                  Add attack
                </Button>
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
                <Field key={i} label={`L${i + 1} slots`}>
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
