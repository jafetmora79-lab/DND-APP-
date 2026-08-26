import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { CharacterSheet } from '@/components/CharacterSheet'
import { MonsterForm } from '@/components/MonsterForm'
import { StatBlock } from '@/components/StatBlock'
import { MapBoard } from '@/components/map/MapBoard'
import { MapMaker } from '@/components/map/MapMaker'
import { api } from '@/lib/api'
import { monsterCopyCells } from '@/lib/combat'
import {
  emptySheet,
  TOKEN_PALETTE,
  type BattleMap,
  type EncounterTemplate,
  type MapToken,
  type Monster,
  type PlayerCharacter,
  type TemplateCharacter,
  type TemplateMonster,
} from '@/lib/types'
import { cn, DEFAULT_SCRATCH_CELL, mapFeet, nearestWalkableCell, spreadCells, tokenSizeSquares } from '@/lib/utils'
import { copyText } from '@/lib/copy'

const tabs = ['Maps', 'Bestiary', 'Encounters', 'Characters'] as const

function blankMonster(): Partial<Monster> {
  return {
    name: '',
    size: 'Medium',
    creatureType: 'humanoid',
    alignment: 'unaligned',
    acValue: 13,
    acNote: '',
    hpMax: 7,
    hitDiceFormula: '2d6',
    speed: '30 ft.',
    str: 10,
    dex: 10,
    con: 10,
    int: 10,
    wis: 10,
    cha: 10,
    savingThrows: '',
    skills: '',
    damageVulnerabilities: '',
    damageResistances: '',
    damageImmunities: '',
    conditionImmunities: '',
    senses: 'passive Perception 10',
    languages: 'Common',
    challengeRating: 0.25,
    xp: 50,
    proficiencyBonus: 2,
    traits: [],
    actions: [{ name: 'Scimitar', desc: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.' }],
    legendaryActions: [],
    reactions: [],
    bonusActions: [],
    lairActions: [],
    source: 'custom',
  }
}

function occupiedKeys(monsters: TemplateMonster[], characters: TemplateCharacter[], map: BattleMap) {
  const keys = new Set<string>()
  for (const spec of monsters) {
    for (const cell of monsterCopyCells(spec, map, keys)) {
      keys.add(`${cell.col},${cell.row}`)
    }
  }
  for (const ch of characters) keys.add(`${ch.startX},${ch.startY}`)
  return keys
}

function placementTokens(
  map: BattleMap,
  specs: TemplateMonster[],
  characters: TemplateCharacter[],
  roster: PlayerCharacter[],
  bestiary: Monster[],
): MapToken[] {
  const cell = map.gridSize
  const occupied = new Set<string>()
  const tokens: MapToken[] = []
  specs.forEach((spec, specIndex) => {
    const src = bestiary.find((m) => m.id === spec.bestiaryMonsterId)
    const copies = monsterCopyCells(spec, map, occupied)
    copies.forEach((pos, copyIndex) => {
      tokens.push({
        id: `tpl:${specIndex}:${copyIndex}`,
        encounterInstanceId: '',
        x: pos.col * cell + cell / 2,
        y: pos.row * cell + cell / 2,
        refType: 'combatant',
        refId: `tpl:${specIndex}:${copyIndex}`,
        label: spec.quantity > 1 ? `${spec.name} ${copyIndex + 1}` : spec.name,
        color: spec.color,
        sizeSquares: tokenSizeSquares(src?.size ?? 'Medium'),
        visibleToPlayers: true,
        hpCurrent: src?.hpMax,
        hpMax: src?.hpMax,
        ac: src?.acValue,
        conditions: [],
      })
    })
  })
  characters.forEach((ch) => {
    const pc = roster.find((c) => c.id === ch.characterId)
    tokens.push({
      id: `pch:${ch.characterId}`,
      encounterInstanceId: '',
      x: ch.startX * cell + cell / 2,
      y: ch.startY * cell + cell / 2,
      refType: 'character',
      refId: ch.characterId,
      label: ch.name || pc?.name || 'Player',
      color: ch.color || pc?.tokenColor || TOKEN_PALETTE[0],
      sizeSquares: 1,
      visibleToPlayers: true,
      hpCurrent: pc?.sheet.hpCurrent,
      hpMax: pc?.sheet.hpMax,
      ac: pc?.sheet.ac,
      conditions: [],
    })
  })
  return tokens
}

export function Prep() {
  const { campaignId } = useParams()
  const [tab, setTab] = useState<(typeof tabs)[number]>('Maps')
  const [maps, setMaps] = useState<BattleMap[]>([])
  const [monsters, setMonsters] = useState<Monster[]>([])
  const [templates, setTemplates] = useState<EncounterTemplate[]>([])
  const [characters, setCharacters] = useState<PlayerCharacter[]>([])
  const [q, setQ] = useState('')
  const [selectedMonster, setSelectedMonster] = useState<Monster | Partial<Monster> | null>(null)
  const [editingNew, setEditingNew] = useState(false)
  const [selectedChar, setSelectedChar] = useState<PlayerCharacter | null>(null)
  const [tpl, setTpl] = useState<Partial<EncounterTemplate>>({ name: '', mapId: '', monsters: [], characters: [] })
  const [msg, setMsg] = useState('')
  const [editingMapId, setEditingMapId] = useState<string | null>(null)
  const [newMapName, setNewMapName] = useState('New encounter map')
  const [newMapCols, setNewMapCols] = useState(20)
  const [newMapRows, setNewMapRows] = useState(15)
  const [beastPick, setBeastPick] = useState('')
  const [beastQty, setBeastQty] = useState(1)
  const [beastFilter, setBeastFilter] = useState('')
  const [copied, setCopied] = useState('')

  async function reload() {
    if (!campaignId) return
    const [m, b, t, c] = await Promise.all([api.maps(campaignId), api.bestiary(), api.templates(campaignId), api.characters(campaignId)])
    setMaps(m.maps)
    setMonsters(b.monsters)
    setTemplates(t.templates)
    setCharacters(c.characters)
  }

  useEffect(() => {
    reload().catch((e) => setMsg(e.message))
  }, [campaignId])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return monsters
    return monsters.filter((m) => m.name.toLowerCase().includes(s) || m.creatureType.toLowerCase().includes(s))
  }, [monsters, q])

  const encounterMonsters = useMemo(() => {
    const s = beastFilter.trim().toLowerCase()
    if (!s) return monsters
    return monsters.filter((m) => m.name.toLowerCase().includes(s) || m.creatureType.toLowerCase().includes(s))
  }, [monsters, beastFilter])

  async function uploadMap(file: File) {
    if (!campaignId) return
    const form = new FormData()
    form.append('image', file)
    form.append('name', file.name.replace(/\.[^.]+$/, ''))
    form.append('gridSize', String(DEFAULT_SCRATCH_CELL))
    form.append('gridCols', String(newMapCols))
    form.append('gridRows', String(newMapRows))
    const r = await api.uploadMap(campaignId, form)
    await reload()
    setEditingMapId(r.map.id)
    setMsg('Picture attached as background. Paint blocked squares on the 5-ft grid.')
  }

  async function createBlankMap() {
    if (!campaignId) return
    const r = await api.createMap(campaignId, {
      name: newMapName.trim() || 'Untitled map',
      gridSize: DEFAULT_SCRATCH_CELL,
      gridCols: newMapCols,
      gridRows: newMapRows,
    })
    await reload()
    setEditingMapId(r.map.id)
    setMsg(`Blank ${newMapCols}×${newMapRows} grid created (${mapFeet(newMapCols, newMapRows)}). Paint blocked squares, then use it in an encounter.`)
  }

  async function saveMonster() {
    if (!selectedMonster?.name) return
    await api.saveMonster(selectedMonster)
    setEditingNew(false)
    setMsg('Monster saved to your shared bestiary.')
    await reload()
  }

  async function saveTemplate() {
    if (!campaignId || !tpl.name || !tpl.mapId) return
    await api.saveTemplate(campaignId, tpl)
    setMsg('Encounter template saved.')
    setTpl({ name: '', mapId: '', monsters: [], characters: [] })
    await reload()
  }

  async function copyCode(code: string, id: string) {
    const ok = await copyText(code)
    if (!ok) return
    setCopied(id)
    window.setTimeout(() => setCopied((cur) => (cur === id ? '' : cur)), 1600)
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/dm" className="text-xs uppercase tracking-[0.3em] text-gold">
            All campaigns
          </Link>
          <h1 className="font-display text-3xl text-gold-2">Prep library</h1>
        </div>
        <Button asChild>
          <Link to={`/dm/${campaignId}/live`}>Open live session</Link>
        </Button>
      </div>
      <div className="mt-4 flex flex-wrap gap-1">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            className={cn('rounded-md px-3 py-1.5 text-sm', tab === t ? 'bg-gold text-bg' : 'text-muted hover:bg-panel-2')}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {msg && <p className="mt-3 text-sm text-moss">{msg}</p>}

      {tab === 'Maps' && (
        editingMapId && maps.find((m) => m.id === editingMapId) ? (
          <MapMaker
            key={editingMapId}
            map={maps.find((m) => m.id === editingMapId)!}
            onChange={(next) => setMaps((list) => list.map((x) => (x.id === next.id ? next : x)))}
            onClose={() => setEditingMapId(null)}
            onDeleted={() => {
              setEditingMapId(null)
              reload()
            }}
          />
        ) : (
        <div className="mt-6 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-line bg-panel p-4">
              <h2 className="font-display text-xl text-gold">New 5-ft grid</h2>
              <p className="mt-1 text-xs text-muted">Create a square battle map from scratch. Each square is 5 feet — the same scale used for movement and encounters.</p>
              <div className="mt-3 grid gap-3">
                <Field label="Name">
                  <Input value={newMapName} onChange={(e) => setNewMapName(e.target.value)} />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Squares wide">
                    <Input type="number" min={1} max={80} value={newMapCols} onChange={(e) => setNewMapCols(Number(e.target.value) || 1)} />
                  </Field>
                  <Field label="Squares high">
                    <Input type="number" min={1} max={80} value={newMapRows} onChange={(e) => setNewMapRows(Number(e.target.value) || 1)} />
                  </Field>
                </div>
                <p className="text-sm text-gold">{mapFeet(newMapCols, newMapRows)}</p>
                <Button onClick={() => createBlankMap().catch((e) => setMsg(e.message))}>Create blank map</Button>
              </div>
            </div>
            <label className="flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-line bg-panel p-4 text-center text-muted hover:text-ink">
              <span className="font-display text-xl text-gold">Optional background</span>
              <span className="mt-2 max-w-xs text-sm">Upload a picture to start a map with scenery under the grid. You still paint blocked squares on the 5-ft grid itself.</span>
              <span className="mt-1 text-xs">PNG, JPG, WebP, or SVG</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) uploadMap(f).catch((err) => setMsg(err.message))
                }}
              />
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {maps.map((m) => (
            <article key={m.id} className="overflow-hidden rounded-xl border border-line bg-panel">
              <button type="button" className="h-40 w-full bg-bg" onClick={() => setEditingMapId(m.id)}>
                {m.imageUrl ? (
                  <img src={m.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted">
                    <span className="font-display text-lg text-gold-2">
                      {m.gridCols}×{m.gridRows}
                    </span>
                    <span className="text-xs">{mapFeet(m.gridCols, m.gridRows)}</span>
                  </div>
                )}
              </button>
              <div className="p-3">
                <div className="font-display text-lg text-gold">{m.name}</div>
                <p className="text-xs text-muted">
                  {m.gridCols}×{m.gridRows} squares · {mapFeet(m.gridCols, m.gridRows)}
                  {m.blocked?.some((v) => v === 1) ? ' · blocked squares painted' : ''}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => setEditingMapId(m.id)}>
                    Edit map
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => api.deleteMap(m.id).then(reload)}>
                    Delete
                  </Button>
                </div>
              </div>
            </article>
          ))}
          </div>
        </div>
        )
      )}

      {tab === 'Bestiary' && (
        <div className="mt-6 grid gap-4 lg:grid-cols-[20rem_1fr]">
          <div className="rounded-xl border border-line bg-panel p-3">
            <Input placeholder="Search name or type…" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button
              className="mt-2 w-full"
              variant="outline"
              onClick={() => {
                setEditingNew(true)
                setSelectedMonster(blankMonster())
              }}
            >
              Add a monster
            </Button>
            <p className="mt-2 text-xs text-muted">{filtered.length} entries · shared across every campaign at this table</p>
            <ul className="mt-3 max-h-[70vh] space-y-1 overflow-y-auto scroll-thin">
              {filtered.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className={cn(
                      'w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-panel-2',
                      selectedMonster && 'id' in selectedMonster && selectedMonster.id === m.id && 'bg-panel-2 text-gold',
                    )}
                    onClick={() => {
                      setEditingNew(false)
                      setSelectedMonster(m)
                    }}
                  >
                    <span className="font-medium">{m.name}</span>
                    <span className="ml-2 text-xs text-muted">
                      CR {m.challengeRating} · {m.creatureType}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            {selectedMonster ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <MonsterForm
                  monster={selectedMonster}
                  editingNew={editingNew}
                  onChange={setSelectedMonster}
                  onSave={saveMonster}
                  onDelete={selectedMonster.id ? () => api.deleteMonster(selectedMonster.id!).then(reload) : undefined}
                />
                {'id' in selectedMonster && selectedMonster.id ? (
                  <StatBlock monster={selectedMonster as Monster} />
                ) : (
                  <p className="text-sm text-muted">Fill the form and save to preview the printed block.</p>
                )}
              </div>
            ) : (
              <p className="text-muted">Search the SRD 5.1 seed or add something of your own. Built once, used in every campaign.</p>
            )}
          </div>
        </div>
      )}

      {tab === 'Encounters' && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-line bg-panel p-4">
            <h2 className="font-display text-xl text-gold">{tpl.id ? 'Edit template' : 'New template'}</h2>
            <div className="mt-3 grid gap-3">
              <Field label="Name">
                <Input value={tpl.name ?? ''} onChange={(e) => setTpl({ ...tpl, name: e.target.value })} />
              </Field>
              <Field label="Map">
                <select
                  className="h-10 rounded-md border border-line bg-bg px-3 text-sm"
                  value={tpl.mapId ?? ''}
                  onChange={(e) => setTpl({ ...tpl, mapId: e.target.value })}
                >
                  <option value="">Choose a map</option>
                  {maps.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="rounded-lg border border-line/70 p-3">
                <div className="text-xs uppercase tracking-wider text-muted">Monsters</div>
                <Field label="Filter">
                  <Input
                    placeholder="Search the bestiary…"
                    value={beastFilter}
                    onChange={(e) => setBeastFilter(e.target.value)}
                  />
                </Field>
                <div className="mt-2 grid grid-cols-[1fr_4.5rem_auto] gap-2">
                  <select
                    className="h-10 rounded-md border border-line bg-bg px-2 text-sm"
                    value={beastPick}
                    onChange={(e) => setBeastPick(e.target.value)}
                  >
                    <option value="">Choose a monster…</option>
                    {encounterMonsters.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} · CR {m.challengeRating}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={beastQty}
                    onChange={(e) => setBeastQty(Math.max(1, Number(e.target.value) || 1))}
                    aria-label="Quantity"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const hit = monsters.find((m) => m.id === beastPick)
                      if (!hit) return
                      const map = maps.find((m) => m.id === tpl.mapId)
                      const list = [...(tpl.monsters ?? [])]
                      const chars = tpl.characters ?? []
                      const occupied = map ? occupiedKeys(list, chars, map) : new Set<string>()
                      const qty = Math.max(1, beastQty)
                      const existing = list.find((x) => x.bestiaryMonsterId === hit.id)
                      if (existing && map) {
                        const extra = spreadCells(
                          { col: existing.startX, row: existing.startY },
                          qty,
                          map.gridCols,
                          map.gridRows,
                          map.blocked,
                          occupied,
                        )
                        const positions = [
                          ...(existing.positions ?? monsterCopyCells(existing, map, new Set()).map((c) => ({ x: c.col, y: c.row }))),
                          ...extra.map((c) => ({ x: c.col, y: c.row })),
                        ]
                        const next = list.map((x) =>
                          x.bestiaryMonsterId === hit.id
                            ? { ...x, quantity: x.quantity + qty, startX: positions[0].x, startY: positions[0].y, positions }
                            : x,
                        )
                        setTpl({ ...tpl, monsters: next })
                      } else {
                        let startX = Math.min(map ? map.gridCols - 1 : 8, 2 + (list.length % 8))
                        let startY = Math.min(map ? map.gridRows - 1 : 8, 2 + Math.floor(list.length / 8))
                        if (map) {
                          const found = nearestWalkableCell(map.blocked, startX, startY, map.gridCols, map.gridRows)
                          if (found) {
                            startX = found.col
                            startY = found.row
                          }
                        }
                        const cells = map
                          ? spreadCells({ col: startX, row: startY }, qty, map.gridCols, map.gridRows, map.blocked, occupied)
                          : Array.from({ length: qty }, (_, i) => ({ col: startX + (i % 4), row: startY + Math.floor(i / 4) }))
                        list.push({
                          bestiaryMonsterId: hit.id,
                          name: hit.name,
                          quantity: qty,
                          startX: cells[0].col,
                          startY: cells[0].row,
                          color: TOKEN_PALETTE[list.length % TOKEN_PALETTE.length],
                          positions: cells.map((c) => ({ x: c.col, y: c.row })),
                        } satisfies TemplateMonster)
                        setTpl({ ...tpl, monsters: list })
                      }
                      setBeastPick('')
                      setBeastQty(1)
                    }}
                  >
                    Add
                  </Button>
                </div>
                <ul className="mt-3 space-y-2">
                  {(tpl.monsters ?? []).map((m, i) => (
                    <li key={`${m.bestiaryMonsterId}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="h-3 w-3 rounded-full" style={{ background: m.color }} />
                      <span className="flex-1">{m.name}</span>
                      <Input
                        className="w-16"
                        type="number"
                        min={1}
                        value={m.quantity}
                        onChange={(e) => {
                          const map = maps.find((x) => x.id === tpl.mapId)
                          const qty = Math.max(1, Number(e.target.value) || 1)
                          const list = (tpl.monsters ?? []).slice()
                          if (!map) {
                            list[i] = { ...m, quantity: qty }
                            setTpl({ ...tpl, monsters: list })
                            return
                          }
                          const occupied = occupiedKeys(
                            list.filter((_, j) => j !== i),
                            tpl.characters ?? [],
                            map,
                          )
                          const current = monsterCopyCells(m, map, new Set())
                          let positions = current.map((c) => ({ x: c.col, y: c.row }))
                          if (qty > positions.length) {
                            const extra = spreadCells(
                              { col: m.startX, row: m.startY },
                              qty - positions.length,
                              map.gridCols,
                              map.gridRows,
                              map.blocked,
                              new Set([...occupied, ...positions.map((p) => `${p.x},${p.y}`)]),
                            )
                            positions = [...positions, ...extra.map((c) => ({ x: c.col, y: c.row }))]
                          } else {
                            positions = positions.slice(0, qty)
                          }
                          list[i] = { ...m, quantity: qty, startX: positions[0].x, startY: positions[0].y, positions }
                          setTpl({ ...tpl, monsters: list })
                        }}
                      />
                      <button
                        type="button"
                        className="text-blood"
                        onClick={() => setTpl({ ...tpl, monsters: (tpl.monsters ?? []).filter((_, j) => j !== i) })}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border border-line/70 p-3">
                <div className="text-xs uppercase tracking-wider text-muted">Player starting squares</div>
                <p className="mt-1 text-xs text-muted">Place each character on the map, then drag their token to where the fight starts.</p>
                <ul className="mt-2 space-y-2">
                  {characters.map((ch) => {
                    const placed = (tpl.characters ?? []).some((c) => c.characterId === ch.id)
                    return (
                      <li key={ch.id} className="flex items-center gap-2 text-sm">
                        <span className="h-3 w-3 rounded-full" style={{ background: ch.tokenColor }} />
                        <span className="flex-1">{ch.name}</span>
                        {placed ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setTpl({ ...tpl, characters: (tpl.characters ?? []).filter((c) => c.characterId !== ch.id) })
                            }
                          >
                            Remove
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!tpl.mapId}
                            onClick={() => {
                              const map = maps.find((m) => m.id === tpl.mapId)
                              if (!map) return
                              const occupied = occupiedKeys(tpl.monsters ?? [], tpl.characters ?? [], map)
                              const origin = { col: 2, row: Math.max(0, map.gridRows - 3) }
                              const cell = spreadCells(origin, 1, map.gridCols, map.gridRows, map.blocked, occupied)[0]
                              setTpl({
                                ...tpl,
                                characters: [
                                  ...(tpl.characters ?? []),
                                  {
                                    characterId: ch.id,
                                    name: ch.name,
                                    startX: cell.col,
                                    startY: cell.row,
                                    color: ch.tokenColor,
                                  },
                                ],
                              })
                            }}
                          >
                            Place on map
                          </Button>
                        )}
                      </li>
                    )
                  })}
                  {characters.length === 0 && <li className="text-xs text-muted">Create characters first, then place them here.</li>}
                </ul>
              </div>
              <p className="text-xs text-muted">Each copy gets its own circle. Drag them apart so four goblins are four tokens, not one stack.</p>
              <div className="flex gap-2">
                <Button onClick={saveTemplate}>{tpl.id ? 'Save changes' : 'Save template'}</Button>
                {tpl.id && (
                  <Button
                    variant="ghost"
                    onClick={() => setTpl({ name: '', mapId: '', monsters: [], characters: [] })}
                  >
                    New template
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div className="space-y-3">
            {tpl.mapId && maps.find((m) => m.id === tpl.mapId) ? (
              <div className="h-[28rem] overflow-hidden rounded-xl border border-line bg-bg">
                <MapBoard
                  map={maps.find((m) => m.id === tpl.mapId)!}
                  tokens={placementTokens(
                    maps.find((m) => m.id === tpl.mapId)!,
                    tpl.monsters ?? [],
                    tpl.characters ?? [],
                    characters,
                    monsters,
                  )}
                  fog={{
                    cols: maps.find((m) => m.id === tpl.mapId)!.gridCols,
                    rows: maps.find((m) => m.id === tpl.mapId)!.gridRows,
                    enabled: false,
                    revealed: [],
                  }}
                  isDm
                  tool="select"
                  onMove={(id, x, y) => {
                    const map = maps.find((m) => m.id === tpl.mapId)!
                    const col = Math.max(0, Math.round((x - map.gridSize / 2) / map.gridSize))
                    const row = Math.max(0, Math.round((y - map.gridSize / 2) / map.gridSize))
                    if (id.startsWith('tpl:')) {
                      const parts = id.split(':')
                      const specIndex = Number(parts[1])
                      const copyIndex = Number(parts[2])
                      const list = (tpl.monsters ?? []).slice()
                      const spec = list[specIndex]
                      if (!spec) return
                      const occupied = occupiedKeys(
                        list.filter((_, j) => j !== specIndex),
                        tpl.characters ?? [],
                        map,
                      )
                      const cells = monsterCopyCells(spec, map, occupied)
                      cells[copyIndex] = { col, row }
                      list[specIndex] = {
                        ...spec,
                        startX: cells[0].col,
                        startY: cells[0].row,
                        positions: cells.map((c) => ({ x: c.col, y: c.row })),
                      }
                      setTpl({ ...tpl, monsters: list })
                      return
                    }
                    if (id.startsWith('pch:')) {
                      const characterId = id.slice(4)
                      setTpl({
                        ...tpl,
                        characters: (tpl.characters ?? []).map((ch) =>
                          ch.characterId === characterId ? { ...ch, startX: col, startY: row } : ch,
                        ),
                      })
                    }
                  }}
                />
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-line p-6 text-sm text-muted">Choose a map to place starting tokens.</p>
            )}
            <ul className="space-y-3">
              {templates.map((t) => (
                <li key={t.id} className="rounded-xl border border-line bg-panel p-4">
                  <div className="font-display text-lg text-gold">{t.name}</div>
                  <p className="text-sm text-muted">
                    {t.monsters.map((m) => `${m.quantity}× ${m.name}`).join(', ') || 'No monsters yet'}
                    {(t.characters?.length ?? 0) > 0 ? ` · ${t.characters!.map((c) => c.name).join(', ')}` : ''}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setTpl({
                          ...t,
                          monsters: t.monsters.map((m, i) => ({
                            ...m,
                            startX: Number.isFinite(m.startX) ? m.startX : 2 + (i % 8),
                            startY: Number.isFinite(m.startY) ? m.startY : 2 + Math.floor(i / 8),
                          })),
                          characters: t.characters ?? [],
                        })
                      }
                    >
                      Edit placement
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => api.deleteTemplate(t.id).then(reload)}>
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {tab === 'Characters' && (
        <div className="mt-6 grid gap-4 lg:grid-cols-[18rem_1fr]">
          <div className="rounded-xl border border-line bg-panel p-3">
            <Button
              className="w-full"
              variant="outline"
              onClick={async () => {
                if (!campaignId) return
                const r = await api.createCharacter(campaignId, { name: 'New adventurer', sheet: emptySheet(), tokenColor: TOKEN_PALETTE[characters.length % TOKEN_PALETTE.length] })
                await reload()
                setSelectedChar(r.character)
              }}
            >
              Create character
            </Button>
            <ul className="mt-3 space-y-1">
              {characters.map((c) => (
                <li key={c.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    className={cn('min-w-0 flex-1 rounded-md px-2 py-2 text-left hover:bg-panel-2', selectedChar?.id === c.id && 'bg-panel-2')}
                    onClick={() => setSelectedChar(c)}
                  >
                    <div className="font-medium">{c.name}</div>
                    <div className="font-mono text-xs text-gold">{c.personalCode}</div>
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    title={`Copy ${c.name}'s personal code`}
                    onClick={() => copyCode(c.personalCode, c.id)}
                  >
                    {copied === c.id ? <Check className="h-4 w-4 text-moss" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
          {selectedChar ? (
            <div className="rounded-xl border border-line bg-panel p-4">
              <CharacterSheet
                character={selectedChar}
                canEdit
                isDm
                onChange={async (patch) => {
                  const next = {
                    ...selectedChar,
                    ...patch,
                    sheet: patch.sheet ?? selectedChar.sheet,
                  }
                  setSelectedChar(next)
                  await api.patchCharacter(selectedChar.id, next)
                  await reload()
                }}
                onImportPdf={async (file) => {
                  const r = await api.importPdf(selectedChar.id, file)
                  setSelectedChar(r.character)
                  setMsg(`Read ${r.fieldCount} form fields from the PDF.`)
                  await reload()
                }}
                onRegenCode={async () => {
                  const r = await api.regenCode(selectedChar.id)
                  setSelectedChar({ ...selectedChar, personalCode: r.personalCode })
                  await reload()
                }}
              />
            </div>
          ) : (
            <p className="text-muted">Create a character to mint a personal code. Players use that code plus tonight’s join code from any device, any week.</p>
          )}
        </div>
      )}
    </div>
  )
}
