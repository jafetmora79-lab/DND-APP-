import { Flag, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { EncounterOutcome } from '@/lib/types'

type Props = {
  outcome: EncounterOutcome
  encounterName?: string
  isDm?: boolean
  busy?: boolean
  onReturnToTable?: () => void
  onNextEncounter?: () => void
}

export function EncounterOutcomeOverlay({ outcome, encounterName, isDm, busy, onReturnToTable, onNextEncounter }: Props) {
  const won = outcome === 'won'
  return (
    <div className={won ? 'outcome-overlay outcome-overlay-won' : 'outcome-overlay outcome-overlay-lost'} role="dialog" aria-label={won ? 'Victory' : 'Defeat'}>
      <div className="outcome-rays" aria-hidden />
      <div className="outcome-banner">
        {won ? <Trophy className="mx-auto h-14 w-14 text-gold-2" /> : <Flag className="mx-auto h-14 w-14 text-blood" />}
        <p className="mt-3 text-xs uppercase tracking-[0.4em] text-gold">{encounterName || 'Encounter'}</p>
        <h2 className="font-display text-5xl md:text-7xl">{won ? 'Victory' : 'Defeat'}</h2>
        <p className="mx-auto mt-3 max-w-md text-muted">
          {won
            ? 'The party holds the field. Catch your breath at the table, then take the road to whatever comes next.'
            : 'The field is lost. Fall back to the table, bind wounds, and decide how the campaign continues.'}
        </p>
        {isDm ? (
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button disabled={busy} onClick={onReturnToTable}>
              Return to table
            </Button>
            <Button disabled={busy} variant="ember" onClick={onNextEncounter}>
              Next encounter
            </Button>
          </div>
        ) : (
          <p className="mt-8 text-sm text-gold">The DM is wrapping this fight. Your sheet stays with you at the table.</p>
        )}
      </div>
    </div>
  )
}
