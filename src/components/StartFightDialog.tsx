import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { EncounterTemplate, PlayerCharacter } from '@/lib/types'
import type { StartFightOpts } from '@/lib/turn-flow'

type Props = {
  template: EncounterTemplate
  characters: PlayerCharacter[]
  busy?: boolean
  warnActiveFight?: boolean
  onCancel: () => void
  onConfirm: (opts: StartFightOpts) => void
}

export function StartFightDialog({ template, characters, busy, warnActiveFight, onCancel, onConfirm }: Props) {
  const [fog, setFog] = useState(false)
  const [surpriseParty, setSurpriseParty] = useState(false)
  const [surpriseMonsters, setSurpriseMonsters] = useState(false)
  const placed = new Set((template.characters ?? []).map((c) => c.characterId))
  const missing = characters.filter((c) => !placed.has(c.id))
  const onMap = (template.characters ?? []).filter((c) => characters.some((ch) => ch.id === c.characterId))

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-label="Start encounter">
      <div className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-panel p-6">
        <h2 className="font-display text-2xl text-gold-2">{template.name}</h2>
        <p className="mt-1 text-sm text-muted">Check the board, then roll initiative. The fight does not start until you begin round 1.</p>
        {(template.objective || template.notes || template.difficulty) && (
          <p className="mt-3 text-sm">
            {[template.difficulty, template.objective, template.notes].filter(Boolean).join(' · ')}
          </p>
        )}
        <section className="mt-4">
          <h3 className="text-xs uppercase tracking-wider text-muted">On the map</h3>
          <ul className="mt-1 text-sm">
            {onMap.map((c) => (
              <li key={c.characterId}>✓ {c.name}</li>
            ))}
            {missing.map((c) => (
              <li key={c.id} className="text-muted">
                {c.name} — not placed (Join this fight / + Name after start)
              </li>
            ))}
            {characters.length === 0 && <li className="text-muted">No characters in this campaign yet.</li>}
          </ul>
          <p className="mt-2 text-xs text-muted">
            {template.monsters.map((m) => `${m.quantity}× ${m.name}`).join(', ') || 'No monsters'}
          </p>
        </section>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={fog} onChange={(e) => setFog(e.target.checked)} />
          Start hidden (fog on, nothing revealed)
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={surpriseParty} onChange={(e) => setSurpriseParty(e.target.checked)} />
          Surprise the party (they skip round 1)
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={surpriseMonsters} onChange={(e) => setSurpriseMonsters(e.target.checked)} />
          Surprise the monsters (they skip round 1)
        </label>
        {warnActiveFight && (
          <p className="mt-3 text-sm text-blood">Pause or Finalize the current fight before starting another. Starting here does not silently complete the one on the table.</p>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="ember"
            disabled={busy || warnActiveFight}
            onClick={() => onConfirm({ fog, surpriseParty, surpriseMonsters })}
          >
            Open the board
          </Button>
        </div>
      </div>
    </div>
  )
}
