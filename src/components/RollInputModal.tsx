import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT } from '@/lib/i18n'

type RollInputModalProps = {
  isOpen: boolean
  title: string
  subtitle?: string
  description?: string
  placeholder?: string
  onSubmit: (value: number) => void
  onCancel: () => void
  disabled?: boolean
  d20?: boolean
}

export function RollInputModal({
  isOpen,
  title,
  subtitle,
  description,
  placeholder = 'd20',
  onSubmit,
  onCancel,
  disabled = false,
  d20 = true,
}: RollInputModalProps) {
  const { t } = useT()
  if (!isOpen) return null

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const input = e.currentTarget.querySelector('input') as HTMLInputElement
    const value = Number(input.value)
    if (Number.isFinite(value) && value >= 0) {
      onSubmit(value)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-2xl border-2 border-gold bg-panel p-6 shadow-[0_0_60px_rgba(200,150,70,0.5)]">
        <div className="mb-6">
          <h2 className="font-display text-xl text-gold">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>

        {description && <p className="mb-4 text-sm text-muted">{description}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <p className="mb-2 text-xs uppercase tracking-wider text-gold font-semibold">{t('battle.enterYourRoll')}</p>
            <Input
              type="number"
              inputMode="numeric"
              placeholder={placeholder}
              min={d20 ? 1 : 0}
              max={d20 ? 20 : undefined}
              autoFocus
              className="h-14 text-center text-2xl font-bold"
              disabled={disabled}
            />
            {d20 && <p className="mt-1 text-xs text-muted">{t('battle.enter1to20')}</p>}
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              size="default"
              className="flex-1"
              onClick={onCancel}
              disabled={disabled}
            >
              {t('battle.cancel')}
            </Button>
            <Button
              type="submit"
              size="default"
              className="flex-1"
              disabled={disabled}
            >
              {t('battle.submit')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
