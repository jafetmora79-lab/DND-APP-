import { useEffect, useRef } from 'react'
import type { CombatActivity } from '@/lib/types'

export function CombatActivityFeed({ items }: { items: CombatActivity[] }) {
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [items])

  return (
    <section className="mt-3">
      <h3 className="text-xs uppercase tracking-wider text-muted">Activity</h3>
      <div ref={scroller} className="mt-1 max-h-44 overflow-y-auto rounded-md border border-line bg-bg px-2 py-1.5">
        {items.length === 0 ? (
          <p className="text-xs text-muted">Nothing yet this fight.</p>
        ) : (
          <ol className="space-y-1">
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
