import { useEffect, useRef, useState } from 'react'
import { TOKEN_PALETTE } from '@/lib/types'
import { cn } from '@/lib/utils'

type Props = {
  value: string
  onChange: (color: string) => void
  disabled?: boolean
  label: string
  title?: string
}

export function TokenColorPicker({ value, onChange, disabled, label, title }: Props) {
  const current = value || TOKEN_PALETTE[0]
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={wrap} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-md border border-line bg-bg px-2.5 py-1.5 text-xs text-ink hover:bg-panel-2 disabled:opacity-50"
      >
        <span className="h-4 w-4 rounded-full border border-line" style={{ background: current }} />
        {label}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={title ?? label}
          className="absolute right-0 top-full z-40 mt-1 w-[15.5rem] rounded-lg border border-line bg-panel p-3 shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
        >
          <p className="mb-2 text-[10px] uppercase tracking-wider text-gold">{title ?? label}</p>
          <div className="flex flex-wrap gap-2">
            {TOKEN_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                className={cn(
                  'h-7 w-7 rounded-full border-2',
                  current.toLowerCase() === c.toLowerCase() ? 'border-gold-2' : 'border-line',
                )}
                style={{ background: c }}
                onClick={() => {
                  onChange(c)
                  setOpen(false)
                }}
              />
            ))}
            <label className="relative h-7 w-7 overflow-hidden rounded-full border border-line">
              <input
                type="color"
                aria-label={title ?? label}
                value={/^#[0-9a-fA-F]{6}$/.test(current) ? current : '#6ea8c9'}
                onChange={(e) => onChange(e.target.value)}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
              <span className="pointer-events-none absolute inset-0 rounded-full" style={{ background: current }} />
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
