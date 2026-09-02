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
    ['STR', monster.str],
    ['DEX', monster.dex],
    ['CON', monster.con],
    ['INT', monster.int],
    ['WIS', monster.wis],
    ['CHA', monster.cha],
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
      <Line label={t('statBlock.armorClass')} value={`${monster.acValue}${monster.acNote ? ` (${monster.acNote})` : ''}`} />
      <Line label={t('statBlock.hitPoints')} value={`${monster.hpMax}${monster.hitDiceFormula ? ` (${monster.hitDiceFormula})` : ''}`} />
      <Line label={t('statBlock.speed')} value={monster.speed} />
      <div className="grid grid-cols-6 gap-1 border-y border-line py-2 text-center">
        {scores.map(([k, v]) => (
          <div key={k}>
            <div className="text-[10px] uppercase text-muted">{k}</div>
            <div className="stat-num text-sm">
              {v} ({signed(abilityMod(v))})
            </div>
          </div>
        ))}
      </div>
      <Line label={t('statBlock.savingThrows')} value={monster.savingThrows} />
      <Line label={t('statBlock.skills')} value={monster.skills} />
      <Line label={t('statBlock.damageVulnerabilities')} value={monster.damageVulnerabilities} />
      <Line label={t('statBlock.damageResistances')} value={monster.damageResistances} />
      <Line label={t('statBlock.damageImmunities')} value={monster.damageImmunities} />
      <Line label={t('statBlock.conditionImmunities')} value={monster.conditionImmunities} />
      <Line label={t('statBlock.senses')} value={monster.senses} />
      <Line label={t('statBlock.languages')} value={monster.languages} />
      <Line label={t('statBlock.challenge')} value={`${monster.challengeRating} (${monster.xp.toLocaleString()} XP)`} />
      <Line label={t('statBlock.proficiencyBonus')} value={signed(monster.proficiencyBonus)} />
      <div className="h-px border-gold/30" />
      <Entries title={t('statBlock.traits')} items={monster.traits} />
      <Entries title={t('statBlock.actions')} items={monster.actions} />
      <Entries title={t('statBlock.bonusActions')} items={monster.bonusActions} />
      <Entries title={t('statBlock.reactions')} items={monster.reactions} />
      <Entries title={t('statBlock.legendaryActions')} items={monster.legendaryActions} />
      <Entries title={t('statBlock.lairActions')} items={monster.lairActions} />
    </article>
  )
}
