import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { useT } from '@/lib/i18n'
import { formatEntries, parseEntries } from '@/lib/named-entries'
import { ABILITIES, type Monster, type NamedEntry } from '@/lib/types'
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
    <Field label={t('monster.entriesHint', { label })}>
      <Textarea value={formatEntries(items)} onChange={(e) => onChange(parseEntries(e.target.value))} />
    </Field>
  )
}

export function MonsterForm({ monster, editingNew, onChange, onSave, onDelete }: Props) {
  const { t } = useT()
  return (
    <div className="space-y-3 rounded-xl border border-line bg-panel p-4">
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('common.name')}>
          <Input value={monster.name ?? ''} onChange={(e) => onChange(setField(monster, 'name', e.target.value))} />
        </Field>
        <Field label={t('monster.size')}>
          <Input value={monster.size ?? ''} onChange={(e) => onChange(setField(monster, 'size', e.target.value))} />
        </Field>
        <Field label={t('monster.type')}>
          <Input value={monster.creatureType ?? ''} onChange={(e) => onChange(setField(monster, 'creatureType', e.target.value))} />
        </Field>
        <Field label={t('monster.alignment')}>
          <Input value={monster.alignment ?? ''} onChange={(e) => onChange(setField(monster, 'alignment', e.target.value))} />
        </Field>
        <Field label={t('sheet.acShort')}>
          <Input type="number" value={monster.acValue ?? 10} onChange={(e) => onChange(setField(monster, 'acValue', Number(e.target.value)))} />
        </Field>
        <Field label={t('monster.acNote')}>
          <Input value={monster.acNote ?? ''} onChange={(e) => onChange(setField(monster, 'acNote', e.target.value))} placeholder={t('monster.acNotePlaceholder')} />
        </Field>
        <Field label={t('player.hp')}>
          <Input type="number" value={monster.hpMax ?? 10} onChange={(e) => onChange(setField(monster, 'hpMax', Number(e.target.value)))} />
        </Field>
        <Field label={t('sheet.hitDice')}>
          <Input value={monster.hitDiceFormula ?? ''} onChange={(e) => onChange(setField(monster, 'hitDiceFormula', e.target.value))} />
        </Field>
        <Field label={t('sheet.speed')} className="col-span-2">
          <Input value={monster.speed ?? ''} onChange={(e) => onChange(setField(monster, 'speed', e.target.value))} />
        </Field>
      </div>
      <div className="grid grid-cols-6 gap-2">
        {ABILITIES.map((ab) => (
          <Field key={ab} label={t(`ability.${ab}`)}>
            <Input
              type="number"
              value={monster[ab] ?? 10}
              onChange={(e) => onChange(setField(monster, ab, Number(e.target.value)))}
            />
          </Field>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('sheet.saves')}>
          <Input value={monster.savingThrows ?? ''} onChange={(e) => onChange(setField(monster, 'savingThrows', e.target.value))} />
        </Field>
        <Field label={t('sheet.skills')}>
          <Input value={monster.skills ?? ''} onChange={(e) => onChange(setField(monster, 'skills', e.target.value))} />
        </Field>
        <Field label={t('monster.damageVulnerabilities')}>
          <Input
            value={monster.damageVulnerabilities ?? ''}
            onChange={(e) => onChange(setField(monster, 'damageVulnerabilities', e.target.value))}
          />
        </Field>
        <Field label={t('monster.damageResistances')}>
          <Input value={monster.damageResistances ?? ''} onChange={(e) => onChange(setField(monster, 'damageResistances', e.target.value))} />
        </Field>
        <Field label={t('monster.damageImmunities')}>
          <Input value={monster.damageImmunities ?? ''} onChange={(e) => onChange(setField(monster, 'damageImmunities', e.target.value))} />
        </Field>
        <Field label={t('monster.conditionImmunities')}>
          <Input value={monster.conditionImmunities ?? ''} onChange={(e) => onChange(setField(monster, 'conditionImmunities', e.target.value))} />
        </Field>
        <Field label={t('monster.senses')} className="col-span-2">
          <Input value={monster.senses ?? ''} onChange={(e) => onChange(setField(monster, 'senses', e.target.value))} />
        </Field>
        <Field label={t('monster.languages')} className="col-span-2">
          <Input value={monster.languages ?? ''} onChange={(e) => onChange(setField(monster, 'languages', e.target.value))} />
        </Field>
        <Field label={t('bestiary.cr')}>
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
        <Field label={t('sheet.xpShort')}>
          <Input type="number" value={monster.xp ?? 0} onChange={(e) => onChange(setField(monster, 'xp', Number(e.target.value)))} />
        </Field>
        <Field label={t('sheet.proficiency')}>
          <Input
            type="number"
            value={monster.proficiencyBonus ?? 2}
            onChange={(e) => onChange(setField(monster, 'proficiencyBonus', Number(e.target.value)))}
          />
        </Field>
      </div>
      <EntriesField label={t('monster.traits')} items={monster.traits} onChange={(traits) => onChange(setField(monster, 'traits', traits))} />
      <EntriesField label={t('monster.actions')} items={monster.actions} onChange={(actions) => onChange(setField(monster, 'actions', actions))} />
      <div className="max-w-[10rem]">
        <Field label={t('monster.attacksPerAction')}>
          <Input
            type="number"
            min={1}
            max={6}
            value={monster.attacksPerAction ?? 1}
            onChange={(e) => onChange(setField(monster, 'attacksPerAction', Math.max(1, Number(e.target.value) || 1)))}
          />
        </Field>
        <p className="mt-1 text-[10px] text-muted">{t('monster.attacksPerActionHint')}</p>
      </div>
      <EntriesField
        label={t('monster.bonusActions')}
        items={monster.bonusActions}
        onChange={(bonusActions) => onChange(setField(monster, 'bonusActions', bonusActions))}
      />
      <EntriesField label={t('monster.reactions')} items={monster.reactions} onChange={(reactions) => onChange(setField(monster, 'reactions', reactions))} />
      <EntriesField
        label={t('monster.legendaryActions')}
        items={monster.legendaryActions}
        onChange={(legendaryActions) => onChange(setField(monster, 'legendaryActions', legendaryActions))}
      />
      <EntriesField
        label={t('monster.lairActions')}
        items={monster.lairActions}
        onChange={(lairActions) => onChange(setField(monster, 'lairActions', lairActions))}
      />
      <div className="flex gap-2">
        <Button onClick={onSave}>{editingNew ? t('monster.addToBestiary') : t('encounter.saveChanges')}</Button>
        {onDelete && (
          <Button variant="ghost" onClick={onDelete}>
            {t('common.delete')}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted">{t('monster.editsHint')}</p>
    </div>
  )
}
