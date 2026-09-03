import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, Palette as PaletteIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'

export type Palette = 'hoard' | 'verdigris' | 'iron'

const STORAGE_KEY = 'dlt-palette'

/** Drop the matching file in /public with this exact name to give a theme its own hero background. */
export const PALETTE_BACKGROUND: Record<Palette, string> = {
  hoard: 'tavern-hearth.jpg',
  verdigris: 'theme-verdigris.jpg',
  iron: 'theme-iron.jpg',
}

const PALETTES: { id: Palette; swatches: string[] }[] = [
  { id: 'hoard', swatches: ['#1d1712', '#c9992f', '#7a1f26', '#ecdfc8'] },
  { id: 'verdigris', swatches: ['#18142a', '#8a68d6', '#3fae7a', '#e8e2f5'] },
  { id: 'iron', swatches: ['#1c1c1e', '#b3323d', '#9a958a', '#e6e5e1'] },
]

function readPalette(): Palette {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'hoard' || v === 'verdigris' || v === 'iron') return v
  } catch {
    /* ignore */
  }
  return 'hoard'
}

const ThemeContext = createContext<{
  palette: Palette
  setPalette: (p: Palette) => void
}>({
  palette: 'hoard',
  setPalette: () => undefined,
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [palette, setPaletteState] = useState<Palette>(readPalette)
  useEffect(() => {
    document.documentElement.setAttribute('data-palette', palette)
  }, [palette])
  const value = useMemo(() => {
    function setPalette(next: Palette) {
      setPaletteState(next)
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        /* ignore */
      }
    }
    return { palette, setPalette }
  }, [palette])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}

export function ThemeToggle({ className }: { className?: string }) {
  const { palette, setPalette } = useTheme()
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<Palette>(palette)

  function openModal() {
    setPending(palette)
    setOpen(true)
  }

  function confirm() {
    setPalette(pending)
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        className={
          className ??
          'inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-muted hover:bg-panel-2 hover:text-ink'
        }
        onClick={openModal}
      >
        <PaletteIcon className="h-3.5 w-3.5" />
        {t('palette.button')}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border-2 border-gold bg-panel p-6 shadow-[0_0_60px_rgba(0,0,0,0.6)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-xl text-gold">{t('palette.label')}</h2>
            <p className="mt-1 text-sm text-muted">{t('palette.pickHint')}</p>

            <div className="mt-4 space-y-2">
              {PALETTES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPending(p.id)}
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    pending === p.id ? 'border-gold bg-gold/10' : 'border-line hover:border-gold/40'
                  }`}
                  aria-pressed={pending === p.id}
                >
                  <div className="flex shrink-0 gap-1">
                    {p.swatches.map((c) => (
                      <span key={c} className="h-5 w-5 rounded-full border border-black/30" style={{ background: c }} />
                    ))}
                  </div>
                  <span className="flex-1 font-display text-sm">{t(`palette.${p.id}`)}</span>
                  {pending === p.id && <Check className="h-4 w-4 shrink-0 text-gold" />}
                </button>
              ))}
            </div>

            <div className="mt-5 flex gap-3">
              <Button type="button" variant="outline" size="default" className="flex-1" onClick={() => setOpen(false)}>
                {t('turn.cancel')}
              </Button>
              <Button type="button" size="default" className="flex-1" onClick={confirm}>
                {t('palette.confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
