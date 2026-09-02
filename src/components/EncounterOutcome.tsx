import { Flag, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
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
  const { t } = useT()
  const won = outcome === 'won'
  return (
    <div className={won ? 'outcome-overlay outcome-overlay-won' : 'outcome-overlay outcome-overlay-lost'} role="dialog" aria-label={won ? t('outcome.victory') : t('outcome.defeat')}>
      <div className="outcome-rays" aria-hidden />
      <div className="outcome-banner">
        {won ? <Trophy className="mx-auto h-14 w-14 text-gold-2" /> : <Flag className="mx-auto h-14 w-14 text-blood" />}
        <p className="mt-3 text-xs uppercase tracking-[0.4em] text-gold">{encounterName || t('outcome.encounter')}</p>
        <h2 className="font-display text-5xl md:text-7xl">{won ? t('outcome.victory') : t('outcome.defeat')}</h2>
        <p className="mx-auto mt-3 max-w-md text-muted">
          {won ? t('outcome.wonBlurb') : t('outcome.lostBlurb')}
        </p>
        {isDm ? (
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button disabled={busy} onClick={onReturnToTable}>
              {t('outcome.returnToTable')}
            </Button>
            <Button disabled={busy} variant="ember" onClick={onNextEncounter}>
              {t('outcome.nextEncounter')}
            </Button>
          </div>
        ) : (
          <p className="mt-8 text-sm text-gold">{t('outcome.dmWrapping')}</p>
        )}
      </div>
    </div>
  )
}
