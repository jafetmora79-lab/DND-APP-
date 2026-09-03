import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useT } from '@/lib/i18n'

export type Palette = 'hoard' | 'verdigris' | 'iron'

const STORAGE_KEY = 'dlt-palette'

const PALETTES: { id: Palette; swatch: string }[] = [
  { id: 'hoard', swatch: '#c9992f' },
  { id: 'verdigris', swatch: '#8a68d6' },
  { id: 'iron', swatch: '#b3323d' },
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
  return (
    <div
      className={className ?? 'inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-1'}
      role="group"
      aria-label={t('palette.label')}
    >
      {PALETTES.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`h-4 w-4 rounded-full border transition-transform ${
            palette === p.id ? 'scale-110 border-ink' : 'border-line/60 hover:scale-105'
          }`}
          style={{ background: p.swatch }}
          onClick={() => setPalette(p.id)}
          aria-pressed={palette === p.id}
          title={t(`palette.${p.id}`)}
        />
      ))}
    </div>
  )
}
