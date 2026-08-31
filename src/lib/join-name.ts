/** Match a join-form name to a character at tonight's table. */

export function normalizeJoinName(raw: string) {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
}

function nameKey(name: string) {
  return normalizeJoinName(name).toUpperCase()
}

export function matchJoinName<T extends { name: string; personalCode?: string }>(
  characters: T[],
  raw: string,
): { ok: true; character: T } | { ok: false; error: string } {
  const q = normalizeJoinName(raw)
  if (!q) return { ok: false, error: 'Enter your character name.' }
  const needle = q.toUpperCase()

  const exact = characters.filter((c) => nameKey(c.name) === needle)
  if (exact.length === 1) return { ok: true, character: exact[0]! }
  if (exact.length > 1) return { ok: false, error: 'Two characters share that name. Ask the DM to rename one.' }

  const first = characters.filter((c) => {
    const n = nameKey(c.name)
    return n === needle || n.startsWith(`${needle} `)
  })
  if (first.length === 1) return { ok: true, character: first[0]! }
  if (first.length > 1) return { ok: false, error: 'Several characters match that name. Use the full character name.' }

  const byCode = characters.filter((c) => nameKey(c.personalCode ?? '') === needle)
  if (byCode.length === 1) return { ok: true, character: byCode[0]! }

  return { ok: false, error: 'No character with that name at this table.' }
}
