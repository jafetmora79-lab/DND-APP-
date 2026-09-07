import { useTheme } from '@/lib/theme'

// Deterministic pseudo-random spread so particles don't regenerate/jump on re-render.
function seeded(i: number, salt: number) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

const EMBER_COUNT = 30
const embers = Array.from({ length: EMBER_COUNT }, (_, i) => ({
  left: `${(seeded(i, 1) * 100).toFixed(1)}%`,
  size: 2 + Math.round(seeded(i, 2) * 3),
  duration: 8 + seeded(i, 3) * 7,
  delay: -(seeded(i, 4) * 12),
  drift: (seeded(i, 5) - 0.5) * 70,
  peak: 0.5 + seeded(i, 6) * 0.4,
}))

const SPOTLIGHT_COUNT = 5
const spotlights = Array.from({ length: SPOTLIGHT_COUNT }, (_, i) => ({
  left: `${(5 + (i * 90) / (SPOTLIGHT_COUNT - 1) + (seeded(i, 7) - 0.5) * 10).toFixed(1)}%`,
  top: `${(5 + seeded(i, 8) * 15).toFixed(1)}%`,
  size: 260 + Math.round(seeded(i, 9) * 140),
  duration: 10 + seeded(i, 10) * 6,
  delay: -(seeded(i, 11) * 8),
}))

const GLOW_COUNT = 10
const glows = Array.from({ length: GLOW_COUNT }, (_, i) => ({
  left: `${(5 + (i * 90) / (GLOW_COUNT - 1) + (seeded(i, 12) - 0.5) * 8).toFixed(1)}%`,
  top: `${(15 + seeded(i, 13) * 55).toFixed(1)}%`,
  size: 18 + Math.round(seeded(i, 14) * 16),
  duration: 2.4 + seeded(i, 15) * 2.2,
  delay: -(seeded(i, 16) * 4),
}))

/** Subtle ambient motion layered over the theme hero art: drifting ash on every
 *  palette, plus spotlight sweeps for Arcane Verdigris and flickering lantern
 *  glow for Dragon's Hoard. Pure CSS so it's cheap and respects reduced-motion. */
export function ThemeParticles() {
  const { palette } = useTheme()

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {embers.map((e, i) => (
        <span
          key={i}
          className="theme-ember"
          style={{
            left: e.left,
            width: e.size,
            height: e.size,
            animationDuration: `${e.duration}s`,
            animationDelay: `${e.delay}s`,
            ['--drift' as string]: `${e.drift}px`,
            ['--ember-peak' as string]: e.peak,
          }}
        />
      ))}

      {palette === 'verdigris' &&
        spotlights.map((s, i) => (
          <span
            key={i}
            className="theme-spotlight"
            style={{
              left: s.left,
              top: s.top,
              width: s.size,
              height: s.size,
              animationDuration: `${s.duration}s`,
              animationDelay: `${s.delay}s`,
            }}
          />
        ))}

      {palette === 'hoard' &&
        glows.map((g, i) => (
          <span
            key={i}
            className="theme-glow"
            style={{
              left: g.left,
              top: g.top,
              width: g.size,
              height: g.size,
              animationDuration: `${g.duration}s`,
              animationDelay: `${g.delay}s`,
            }}
          />
        ))}
    </div>
  )
}
