import { useT } from '@/lib/i18n'
import { abilityMod, cn, signed } from '@/lib/utils'
import type { Monster } from '@/lib/types'

function Line({ label, value }: { label: string; value?: string | number | null }) {
  if (!value && value !== 0) return null
  return (
    <p className="text-sm">
      <span className="font-semibold text-gold">{label}</span> {value}
    </p>
  )
}

function Entries({ title, items }: { title: string; items?: { name: string; desc: string }[] }) {
  if (!items?.length) return null
  return (
    <div className="space-y-2">
      <h4 className="font-display text-sm tracking-wide text-gold-2">{title}</h4>
      {items.map((e) => (
        <p key={e.name} className="text-sm leading-relaxed text-ink/90">
          <span className="font-semibold italic text-ink">{e.name}.</span> {e.desc}
        </p>
      ))}
    </div>
  )
}

export function StatBlock({ monster, className }: { monster: Monster; className?: string }) {
  const { t } = useT()
  const scores = [
    ['str', monster.str],
    ['dex', monster.dex],
    ['con', monster.con],
    ['int', monster.int],
    ['wis', monster.wis],
    ['cha', monster.cha],
  ] as const
  return (
    <article className={cn('space-y-3 rounded-lg border border-line bg-panel/50 p-4 shadow-sm', className)}>
      <header>
        <h3 className="font-display text-xl text-gold-2">{monster.name}</h3>
        <p className="text-sm italic text-muted">
          {monster.size} {monster.creatureType}, {monster.alignment}
        </p>
      </header>
      <div className="h-px border-gold/30" />
      <Line label={t('statblock.armorClass')} value={`${monster.acValue}${monster.acNote ? ` (${monster.acNote})` : ''}`} />
      <Line label={t('statblock.hitPoints')} value={`${monster.hpMax}${monster.hitDiceFormula ? ` (${monster.hitDiceFormula})` : ''}`} />
      <Line label={t('statblock.speed')} value={monster.speed} />
      <div className="grid grid-cols-6 gap-1 border-y border-line py-2 text-center">
        {scores.map(([k, v]) => (
          <div key={k}>
            <div className="text-[10px] uppercase text-muted">{t(`ability.${k}`)}</div>
            <div className="stat-num text-sm">
              {v} ({signed(abilityMod(v))})
            </div>
          </div>
        ))}
      </div>
      <Line label={t('statblock.savingThrows')} value={monster.savingThrows} />
      <Line label={t('statblock.skills')} value={monster.skills} />
      <Line label={t('statblock.damageVulnerabilities')} value={monster.damageVulnerabilities} />
      <Line label={t('statblock.damageResistances')} value={monster.damageResistances} />
      <Line label={t('statblock.damageImmunities')} value={monster.damageImmunities} />
      <Line label={t('statblock.conditionImmunities')} value={monster.conditionImmunities} />
      <Line label={t('statblock.senses')} value={monster.senses} />
      <Line label={t('statblock.languages')} value={monster.languages} />
      <Line label={t('statblock.challenge')} value={`${monster.challengeRating} (${monster.xp.toLocaleString()} ${t('sheet.xpShort')})`} />
      <Line label={t('statblock.proficiencyBonus')} value={signed(monster.proficiencyBonus)} />
      <div className="h-px border-gold/30" />
      <Entries title={t('statblock.traits')} items={monster.traits} />
      <Entries title={t('statblock.actions')} items={monster.actions} />
      <Entries title={t('statblock.bonusActions')} items={monster.bonusActions} />
      <Entries title={t('statblock.reactions')} items={monster.reactions} />
      <Entries title={t('statblock.legendaryActions')} items={monster.legendaryActions} />
      <Entries title={t('statblock.lairActions')} items={monster.lairActions} />
    </article>
  )
}
