import type { NamedEntry } from '@/lib/types'

export function formatEntries(items?: NamedEntry[]) {
  return (items ?? []).map((a) => (a.desc ? `${a.name}. ${a.desc}` : a.name)).join('\n\n')
}

export function parseEntries(text: string): NamedEntry[] {
  return text
    .split(/\n\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf('.')
      if (idx < 0) return { name: line, desc: '' }
      return { name: line.slice(0, idx).trim(), desc: line.slice(idx + 1).trim() }
    })
}
