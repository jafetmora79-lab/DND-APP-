import { useEffect, useRef } from 'react'
import type { CombatActivity } from '@/lib/types'
import { useT } from '@/lib/i18n'

export function CombatActivityFeed({ items }: { items: CombatActivity[] }) {
  const { t } = useT()
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [items])

  return (
    <section className="mt-3">
      <h3 className="text-xs uppercase tracking-wider text-muted font-semibold">{t('activity.title')}</h3>
      <div ref={scroller} className="mt-1.5 max-h-44 overflow-y-auto rounded-lg border border-line bg-panel/50 px-2.5 py-2">
        {items.length === 0 ? (
          <p className="text-xs text-muted">{t('activity.empty')}</p>
        ) : (
          <ol className="space-y-1.5">
            {items.map((line) => (
              <li key={line.id || `${line.at}-${line.text}`} className="text-xs leading-snug text-ink">
                {line.text}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
