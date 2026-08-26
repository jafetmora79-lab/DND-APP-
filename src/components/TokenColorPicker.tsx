import { TOKEN_PALETTE } from '@/lib/types'
import { cn } from '@/lib/utils'

type Props = {
  value: string
  onChange: (color: string) => void
  disabled?: boolean
}

export function TokenColorPicker({ value, onChange, disabled }: Props) {
  const current = value || TOKEN_PALETTE[0]
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wider text-muted">Token color</span>
      {TOKEN_PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          disabled={disabled}
          aria-label={`Token color ${c}`}
          className={cn(
            'h-6 w-6 rounded-full border-2',
            current.toLowerCase() === c.toLowerCase() ? 'border-gold-2' : 'border-line',
          )}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
      <input
        type="color"
        aria-label="Custom token color"
        disabled={disabled}
        value={/^#[0-9a-fA-F]{6}$/.test(current) ? current : '#6ea8c9'}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-6 cursor-pointer rounded-full border border-line bg-transparent p-0"
      />
    </div>
  )
}
