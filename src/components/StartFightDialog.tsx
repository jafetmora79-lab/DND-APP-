import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
import type { EncounterTemplate, PlayerCharacter } from '@/lib/types'
import type { StartFightOpts } from '@/lib/turn-flow'
import type { Lighting } from '@/lib/vision'

type Props = {
  template: EncounterTemplate
  characters: PlayerCharacter[]
  busy?: boolean
  warnActiveFight?: boolean
  onCancel: () => void
  onConfirm: (opts: StartFightOpts) => void
}

export function StartFightDialog({ template, characters, busy, warnActiveFight, onCancel, onConfirm }: Props) {
  const { t } = useT()
  const [lighting, setLighting] = useState<Lighting>('day')
  const [surpriseParty, setSurpriseParty] = useState(false)
  const [surpriseMonsters, setSurpriseMonsters] = useState(false)
  const placed = new Set((template.characters ?? []).map((c) => c.characterId))
  const missing = characters.filter((c) => !placed.has(c.id))
  const onMap = (template.characters ?? []).filter((c) => characters.some((ch) => ch.id === c.characterId))

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-label={t('start.startEncounter')}>
      <div className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-panel p-6">
        <h2 className="font-display text-2xl text-gold-2">{template.name}</h2>
        <p className="mt-1 text-sm text-muted">{t('start.checkBoardHint')}</p>
        {(template.objective || template.notes || template.difficulty) && (
          <p className="mt-3 text-sm">
            {[template.difficulty, template.objective, template.notes].filter(Boolean).join(' · ')}
          </p>
        )}
        <section className="mt-4">
          <h3 className="text-xs uppercase tracking-wider text-muted">{t('start.onTheMap')}</h3>
          <ul className="mt-1 text-sm">
            {onMap.map((c) => (
              <li key={c.characterId}>✓ {c.name}</li>
            ))}
            {missing.map((c) => (
              <li key={c.id} className="text-muted">
                {c.name} — {t('start.notPlaced')}
              </li>
            ))}
            {characters.length === 0 && <li className="text-muted">{t('start.noCharactersYet')}</li>}
          </ul>
          <p className="mt-2 text-xs text-muted">
            {template.monsters.map((m) => `${m.quantity}× ${m.name}`).join(', ') || t('start.noMonsters')}
          </p>
        </section>
        <section className="mt-4">
          <h3 className="text-xs uppercase tracking-wider text-muted">{t('start.lighting')}</h3>
          <div className="mt-2 flex flex-wrap gap-1">
            {(['day', 'night', 'interior'] as const).map((mode) => (
              <Button key={mode} size="sm" variant={lighting === mode ? 'default' : 'outline'} onClick={() => setLighting(mode)}>
                {t(`map.${mode === 'interior' ? 'interior' : mode}`)}
              </Button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            {lighting === 'day' ? t('start.dayHint') : lighting === 'night' ? t('start.nightHint') : t('start.interiorHint')}
          </p>
        </section>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={surpriseParty} onChange={(e) => setSurpriseParty(e.target.checked)} />
          {t('start.surpriseParty')}
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={surpriseMonsters} onChange={(e) => setSurpriseMonsters(e.target.checked)} />
          {t('start.surpriseMonsters')}
        </label>
        {warnActiveFight && (
          <p className="mt-3 text-sm text-blood">{t('start.pauseOrFinalizeWarning')}</p>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="ember"
            disabled={busy || warnActiveFight}
            onClick={() => onConfirm({ lighting, fog: lighting !== 'day', surpriseParty, surpriseMonsters })}
          >
            {t('start.openBoard')}
          </Button>
        </div>
      </div>
    </div>
  )
}
