import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { useT } from '@/lib/i18n'
import { formatEntries, parseEntries } from '@/lib/named-entries'
import { ABILITIES, ABILITY_LABELS, type Monster, type NamedEntry } from '@/lib/types'
import { crXp } from '@/lib/utils'

type Props = {
  monster: Monster | Partial<Monster>
  editingNew: boolean
  onChange: (next: Monster | Partial<Monster>) => void
  onSave: () => void
  onDelete?: () => void
}

function setField<K extends keyof Monster>(monster: Monster | Partial<Monster>, key: K, value: Monster[K]) {
  return { ...monster, [key]: value }
}

function EntriesField({
  label,
  items,
  onChange,
}: {
  label: string
  items?: NamedEntry[]
  onChange: (items: NamedEntry[]) => void
}) {
  const { t } = useT()
  return (
    <Field label={t('monsterForm.entriesFormat', { label })}>
      <Textarea value={formatEntries(items)} onChange={(e) => onChange(parseEntries(e.target.value))} />
    </Field>
  )
}

export function MonsterForm({ monster, editingNew, onChange, onSave, onDelete }: Props) {
  const { t } = useT()
  return (
    <div className="space-y-3 rounded-xl border border-line bg-panel p-4">
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('monsterForm.name')}>
          <Input value={monster.name ?? ''} onChange={(e) => onChange(setField(monster, 'name', e.target.value))} />
        </Field>
        <Field label={t('monsterForm.size')}>
          <Input value={monster.size ?? ''} onChange={(e) => onChange(setField(monster, 'size', e.target.value))} />
        </Field>
        <Field label={t('monsterForm.type')}>
          <Input value={monster.creatureType ?? ''} onChange={(e) => onChange(setField(monster, 'creatureType', e.target.value))} />
        </Field>
        <Field label={t('monsterForm.alignment')}>
          <Input value={monster.alignment ?? ''} onChange={(e) => onChange(setField(monster, 'alignment', e.target.value))} />
        </Field>
        <Field label={t('monsterForm.ac')}>
          <Input type="number" value={monster.acValue ?? 10} onChange={(e) => onChange(setField(monster, 'acValue', Number(e.target.value)))} />
        </Field>
        <Field label={t('monsterForm.acNote')}>
          <Input value={monster.acNote ?? ''} onChange={(e) => onChange(setField(monster, 'acNote', e.target.value))} placeholder={t('monsterForm.acNotePlaceholder')} />
        </Field>
        <Field label={t('monsterForm.hp')}>
          <Input type="number" value={monster.hpMax ?? 10} onChange={(e) => onChange(setField(monster, 'hpMax', Number(e.target.value)))} />
        </Field>
        <Field label={t('monsterForm.hitDice')}>
          <Input value={monster.hitDiceFormula ?? ''} onChange={(e) => onChange(setField(monster, 'hitDiceFormula', e.target.value))} />
        </Field>
        <Field label={t('monsterForm.speed')} className="col-span-2">
          <Input value={monster.speed ?? ''} onChange={(e) => onChange(setField(monster, 'speed', e.target.value))} />
        </Field>
      </div>
      <div className="grid grid-cols-6 gap-2">
        {ABILITIES.map((ab) => (
          <Field key={ab} label={ABILITY_LABELS[ab]}>
            <Input
              type="number"
              value={monster[ab] ?? 10}
              onChange={(e) => onChange(setField(monster, ab, Number(e.target.value)))}
            />
          </Field>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('monsterForm.savingThrows')}>
          <Input value={monster.savingThrows ?? ''} onChange={(e) => onChange(setField(monster, 'savingThrows', e.target.value))} />
        </Field>
        <Field label={t('monsterForm.skills')}>
          <Input value={monster.skills ?? ''} onChange={(e) => onChange(setField(monster, 'skills', e.target.value))} />
        </Field>
        <Field label={t('monsterForm.damageVulnerabilities')}>
          <Input
            value={monster.damageVulnerabilities ?? ''}
            onChange={(e) => onChange(setField(monster, 'damageVulnerabilities', e.target.value))}
          />
        </Field>
        <Field label={t('monsterForm.damageResistances')}>
          <Input value={monster.damageResistances ?? ''} onChange={(e) => onChange(setField(monster, 'damageResistances', e.target.value))} />
        </Field>
        <Field label={t('monsterForm.damageImmunities')}>
          <Input value={monster.damageImmunities ?? ''} onChange={(e) => onChange(setField(monster, 'damageImmunities', e.target.value))} />
        </Field>
        <Field label={t('monsterForm.conditionImmunities')}>
          <Input value={monster.conditionImmunities ?? ''} onChange={(e) => onChange(setField(monster, 'conditionImmunities', e.target.value))} />
        </Field>
        <Field label={t('monsterForm.senses')} className="col-span-2">
          <Input value={monster.senses ?? ''} onChange={(e) => onChange(setField(monster, 'senses', e.target.value))} />
        </Field>
        <Field label={t('monsterForm.languages')} className="col-span-2">
          <Input value={monster.languages ?? ''} onChange={(e) => onChange(setField(monster, 'languages', e.target.value))} />
        </Field>
        <Field label={t('monsterForm.cr')}>
          <Input
            type="number"
            step="0.125"
            value={monster.challengeRating ?? 0}
            onChange={(e) => {
              const challengeRating = Number(e.target.value)
              onChange({ ...monster, challengeRating, xp: crXp(challengeRating) })
            }}
          />
        </Field>
        <Field label={t('monsterForm.xp')}>
          <Input type="number" value={monster.xp ?? 0} onChange={(e) => onChange(setField(monster, 'xp', Number(e.target.value)))} />
        </Field>
        <Field label={t('monsterForm.proficiencyBonus')}>
          <Input
            type="number"
            value={monster.proficiencyBonus ?? 2}
            onChange={(e) => onChange(setField(monster, 'proficiencyBonus', Number(e.target.value)))}
          />
        </Field>
      </div>
      <EntriesField label={t('monsterForm.traits')} items={monster.traits} onChange={(traits) => onChange(setField(monster, 'traits', traits))} />
      <EntriesField label={t('monsterForm.actions')} items={monster.actions} onChange={(actions) => onChange(setField(monster, 'actions', actions))} />
      <EntriesField
        label={t('monsterForm.bonusActions')}
        items={monster.bonusActions}
        onChange={(bonusActions) => onChange(setField(monster, 'bonusActions', bonusActions))}
      />
      <EntriesField label={t('monsterForm.reactions')} items={monster.reactions} onChange={(reactions) => onChange(setField(monster, 'reactions', reactions))} />
      <EntriesField
        label={t('monsterForm.legendaryActions')}
        items={monster.legendaryActions}
        onChange={(legendaryActions) => onChange(setField(monster, 'legendaryActions', legendaryActions))}
      />
      <EntriesField
        label={t('monsterForm.lairActions')}
        items={monster.lairActions}
        onChange={(lairActions) => onChange(setField(monster, 'lairActions', lairActions))}
      />
      <div className="flex gap-2">
        <Button onClick={onSave}>{editingNew ? t('monsterForm.addToBestiary') : t('monsterForm.saveChanges')}</Button>
        {onDelete && (
          <Button variant="ghost" onClick={onDelete}>
            {t('common.delete')}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted">{t('monsterForm.editHint')}</p>
    </div>
  )
}
