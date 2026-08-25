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
  const scores = [
    ['STR', monster.str],
    ['DEX', monster.dex],
    ['CON', monster.con],
    ['INT', monster.int],
    ['WIS', monster.wis],
    ['CHA', monster.cha],
  ] as const
  return (
    <article className={cn('parchment space-y-3 rounded-lg border border-line p-4', className)}>
      <header>
        <h3 className="font-display text-xl text-gold-2">{monster.name}</h3>
        <p className="text-sm italic text-muted">
          {monster.size} {monster.creatureType}, {monster.alignment}
        </p>
      </header>
      <div className="h-px bg-ember/70" />
      <Line label="Armor Class" value={`${monster.acValue}${monster.acNote ? ` (${monster.acNote})` : ''}`} />
      <Line label="Hit Points" value={`${monster.hpMax}${monster.hitDiceFormula ? ` (${monster.hitDiceFormula})` : ''}`} />
      <Line label="Speed" value={monster.speed} />
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
      <Line label="Saving Throws" value={monster.savingThrows} />
      <Line label="Skills" value={monster.skills} />
      <Line label="Damage Vulnerabilities" value={monster.damageVulnerabilities} />
      <Line label="Damage Resistances" value={monster.damageResistances} />
      <Line label="Damage Immunities" value={monster.damageImmunities} />
      <Line label="Condition Immunities" value={monster.conditionImmunities} />
      <Line label="Senses" value={monster.senses} />
      <Line label="Languages" value={monster.languages} />
      <Line label="Challenge" value={`${monster.challengeRating} (${monster.xp.toLocaleString()} XP)`} />
      <Line label="Proficiency Bonus" value={signed(monster.proficiencyBonus)} />
      <div className="h-px bg-ember/70" />
      <Entries title="Traits" items={monster.traits} />
      <Entries title="Actions" items={monster.actions} />
      <Entries title="Bonus Actions" items={monster.bonusActions} />
      <Entries title="Reactions" items={monster.reactions} />
      <Entries title="Legendary Actions" items={monster.legendaryActions} />
      <Entries title="Lair Actions" items={monster.lairActions} />
    </article>
  )
}
