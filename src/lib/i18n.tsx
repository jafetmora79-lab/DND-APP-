import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

export type Lang = 'en' | 'es'

const STORAGE_KEY = 'dlt-lang'

const en = {
  'lang.en': 'English',
  'lang.es': 'Español',
  'landing.kicker': 'Campaign companion',
  'landing.title': 'D&D LIVE TABLE',
  'landing.blurb': 'Prep the campaign, open the live table, and keep every phone on the same map, tracker, and character sheet.',
  'landing.dm': 'Dungeon Master',
  'landing.join': 'Join as player',
  'landing.leave': 'Leave',
  'map.day': 'Day',
  'map.night': 'Night',
  'map.interior': 'Inside',
  'map.fogOn': 'Fog on',
  'map.fogOff': 'Fog off',
  'map.reveal': 'Reveal',
  'map.hide': 'Hide',
  'map.move': 'Move',
  'map.terrain.open': 'Walkable',
  'map.terrain.wall': 'Wall',
  'map.terrain.hole': 'Hole',
  'map.terrain.difficult': 'Difficult',
  'map.terrain.slippery': 'Slippery',
  'map.terrain.fire': 'Fire',
  'map.terrain.water': 'Water',
  'map.terrain.halfCover': 'Half cover',
  'map.terrain.threeQuarterCover': '¾ cover',
  'map.maker.blurb': 'Each square is 5 feet. Paint walls that block sight, holes you cannot walk, difficult ground, and cover.',
  'init.title': 'Initiative',
  'init.blurb': 'Walk the roster. Enter the d20 from the table, or let the app roll — Dex is added either way. Attacks still use physical dice.',
  'init.roll': 'Roll',
  'init.submit': 'Submit',
  'init.rollMonsters': 'Roll remaining monsters',
  'init.rollAll': 'Roll remaining',
  'init.begin': 'Sort and begin round 1',
  'init.waiting': 'Waiting for initiative…',
  'init.your': 'Your initiative',
  'init.total': 'Total',
  'init.bonus': 'Bonus',
  'init.later': 'Do this in the tracker',
  'init.open': 'Initiative rolls',
  'start.lighting': 'Lighting',
  'start.dayHint': 'Day: whole map visible.',
  'start.nightHint': 'Night: fog on. Each character sees out to darkvision (walls still block).',
  'start.interiorHint': 'Inside: you only see rooms you can look into. Walls block line of sight.',
  'player.stats': 'Stat block',
  'sheet.darkvision': 'Darkvision (ft)',
}

const es: Record<keyof typeof en, string> = {
  'lang.en': 'English',
  'lang.es': 'Español',
  'landing.kicker': 'Compañero de campaña',
  'landing.title': 'MESA VIVA DE D&D',
  'landing.blurb': 'Prepara la campaña, abre la mesa en vivo y mantén cada teléfono en el mismo mapa, rastreador y hoja.',
  'landing.dm': 'Dungeon Master',
  'landing.join': 'Unirse como jugador',
  'landing.leave': 'Salir',
  'map.day': 'Día',
  'map.night': 'Noche',
  'map.interior': 'Interior',
  'map.fogOn': 'Niebla sí',
  'map.fogOff': 'Niebla no',
  'map.reveal': 'Revelar',
  'map.hide': 'Ocultar',
  'map.move': 'Mover',
  'map.terrain.open': 'Transitable',
  'map.terrain.wall': 'Muro',
  'map.terrain.hole': 'Hoyo',
  'map.terrain.difficult': 'Difícil',
  'map.terrain.slippery': 'Resbaladizo',
  'map.terrain.fire': 'Fuego',
  'map.terrain.water': 'Agua',
  'map.terrain.halfCover': 'Cobertura media',
  'map.terrain.threeQuarterCover': 'Cobertura ¾',
  'map.maker.blurb': 'Cada casilla son 5 pies. Pinta muros que bloquean la vista, hoyos intransitables, terreno difícil y cobertura.',
  'init.title': 'Iniciativa',
  'init.blurb': 'Pasa lista. Escribe el d20 de la mesa, o deja que la app tire — se suma Destreza. Los ataques siguen con dados físicos.',
  'init.roll': 'Tirar',
  'init.submit': 'Enviar',
  'init.rollMonsters': 'Tirar monstruos que faltan',
  'init.rollAll': 'Tirar lo que falta',
  'init.begin': 'Ordenar y empezar ronda 1',
  'init.waiting': 'Esperando iniciativa…',
  'init.your': 'Tu iniciativa',
  'init.total': 'Total',
  'init.bonus': 'Bono',
  'init.later': 'Hacerlo en el rastreador',
  'init.open': 'Tiradas de iniciativa',
  'start.lighting': 'Iluminación',
  'start.dayHint': 'Día: el mapa entero es visible.',
  'start.nightHint': 'Noche: niebla. Cada personaje ve hasta su visión en la oscuridad (los muros siguen bloqueando).',
  'start.interiorHint': 'Interior: solo ves las habitaciones a las que puedes mirar. Los muros bloquean la línea de visión.',
  'player.stats': 'Bloque de estadísticas',
  'sheet.darkvision': 'Visión en la oscuridad (pies)',
}

const dict: Record<Lang, Record<string, string>> = { en, es }

function readLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'es' || v === 'en') return v
  } catch {
    /* ignore */
  }
  return 'en'
}

const I18nContext = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (key: string) => string }>({
  lang: 'en',
  setLang: () => undefined,
  t: (key) => dict.en[key] ?? key,
})

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang)
  const value = useMemo(() => {
    function setLang(next: Lang) {
      setLangState(next)
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        /* ignore */
      }
    }
    function t(key: string) {
      return dict[lang][key] ?? dict.en[key] ?? key
    }
    return { lang, setLang, t }
  }, [lang])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useT() {
  return useContext(I18nContext)
}

export function LanguageToggle({ className }: { className?: string }) {
  const { lang, setLang } = useT()
  return (
    <div className={className ?? 'inline-flex rounded-md border border-line text-xs'}>
      <button
        type="button"
        className={`px-2 py-1 ${lang === 'en' ? 'bg-gold text-bg' : 'text-muted'}`}
        onClick={() => setLang('en')}
      >
        EN
      </button>
      <button
        type="button"
        className={`px-2 py-1 ${lang === 'es' ? 'bg-gold text-bg' : 'text-muted'}`}
        onClick={() => setLang('es')}
      >
        ES
      </button>
    </div>
  )
}
