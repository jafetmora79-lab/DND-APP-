/** Thematic token fills: goblin greens, dragon reds, and a darker stop for Konva gradients. */

export type TokenLook = { from: string; to: string }

const BY_NAME: { test: RegExp; look: TokenLook }[] = [
  { test: /dragon|wyrm/, look: { from: '#b42318', to: '#140806' } },
  { test: /hobgoblin/, look: { from: '#6b8f32', to: '#2a2410' } },
  { test: /bugbear/, look: { from: '#7a5a28', to: '#2a180c' } },
  { test: /kobold/, look: { from: '#c4453c', to: '#3a1410' } },
  { test: /goblin/, look: { from: '#5cad4a', to: '#1c3a18' } },
  { test: /orc/, look: { from: '#4a6b32', to: '#1a2410' } },
  { test: /ogre|troll|giant/, look: { from: '#7a6a4a', to: '#2a2014' } },
  { test: /wolf|worg|winter wolf/, look: { from: '#8a847c', to: '#2a2824' } },
  { test: /bear|owlbear|boar/, look: { from: '#8a5a32', to: '#2a180c' } },
  { test: /spider|ettercap/, look: { from: '#4a3a29', to: '#120e0b' } },
  { test: /skeleton|zombie|ghoul|wight|lich|mummy|specter|ghost|wraith/, look: { from: '#c8c2b4', to: '#3d294f' } },
  { test: /ooze|jelly|slime/, look: { from: '#6bcb4a', to: '#1a3d12' } },
  { test: /elemental/, look: { from: '#e07030', to: '#3d1408' } },
  { test: /demon|devil|fiend|balor/, look: { from: '#9b3b32', to: '#1a0808' } },
  { test: /angel|celestial|deva/, look: { from: '#f0d78c', to: '#4a3a18' } },
  { test: /mind flayer|illithid|aboleth/, look: { from: '#72558c', to: '#1c1428' } },
  { test: /beholder/, look: { from: '#8f6127', to: '#2a1408' } },
  { test: /gnoll/, look: { from: '#c9963e', to: '#3a2410' } },
  { test: /bandit|guard|knight|veteran|noble|commoner|cultist/, look: { from: '#6ea8c9', to: '#1c2834' } },
]

const BY_TYPE: Record<string, TokenLook> = {
  dragon: { from: '#b42318', to: '#140806' },
  undead: { from: '#c8c2b4', to: '#3d294f' },
  fiend: { from: '#9b3b32', to: '#1a0808' },
  celestial: { from: '#f0d78c', to: '#4a3a18' },
  elemental: { from: '#e07030', to: '#3d1408' },
  ooze: { from: '#6bcb4a', to: '#1a3d12' },
  beast: { from: '#8a6a4a', to: '#2a1c10' },
  monstrosity: { from: '#7b6cc9', to: '#1c1428' },
  humanoid: { from: '#5cad4a', to: '#1c3a18' },
  aberration: { from: '#72558c', to: '#1c1428' },
  construct: { from: '#a99b87', to: '#2a241d' },
  giant: { from: '#7a6a4a', to: '#2a2014' },
  fey: { from: '#4ea36a', to: '#1a2c1c' },
  plant: { from: '#55734b', to: '#1a2818' },
}

function shadeToward(hex: string, toward: string, amount: number) {
  const a = parseHex(hex)
  const b = parseHex(toward)
  if (!a || !b) return hex
  const mix = (x: number, y: number) => Math.round(x + (y - x) * amount)
  return `#${[mix(a[0], b[0]), mix(a[1], b[1]), mix(a[2], b[2])].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

function parseHex(hex: string): [number, number, number] | null {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (!m) return null
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
}

export function inkOnToken(hex: string) {
  const rgb = parseHex(hex)
  if (!rgb) return '#E8DDC8'
  const [r, g, b] = rgb
  const luma = (r * 299 + g * 587 + b * 114) / 1000
  return luma > 150 ? '#171411' : '#E8DDC8'
}

export function monsterTokenLook(name: string, creatureType = ''): TokenLook {
  const hay = `${name} ${creatureType}`.toLowerCase()
  for (const row of BY_NAME) {
    if (row.test.test(hay)) return row.look
  }
  const type = creatureType.trim().toLowerCase()
  if (type && BY_TYPE[type]) return BY_TYPE[type]
  return { from: '#8a6a4a', to: '#2a1c10' }
}

export function playerTokenLook(color: string): TokenLook {
  const from = color || '#6ea8c9'
  return { from, to: shadeToward(from, '#11100E', 0.55) }
}

export function templateReady(t: { mapId?: string; monsters?: unknown[] }) {
  return Boolean(t.mapId && (t.monsters?.length ?? 0) > 0)
}
