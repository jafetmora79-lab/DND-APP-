import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { CharacterSheet } from '@/components/CharacterSheet'
import { StatBlock } from '@/components/StatBlock'
import { api } from '@/lib/api'
import { emptySheet, TOKEN_PALETTE, type BattleMap, type EncounterTemplate, type Monster, type NamedEntry, type PlayerCharacter, type TemplateMonster } from '@/lib/types'
import { cn } from '@/lib/utils'

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
  const [tpl, setTpl] = useState<Partial<EncounterTemplate>>({ name: '', mapId: '', monsters: [] })
  const [msg, setMsg] = useState('')

  async function reload() {
    if (!campaignId) return
    const [m, b, t, c] = await Promise.all([api.maps(campaignId), api.bestiary(q), api.templates(campaignId), api.characters(campaignId)])
    setMaps(m.maps)
    setMonsters(b.monsters)
    setTemplates(t.templates)
    setCharacters(c.characters)
  }

  useEffect(() => {
    reload().catch((e) => setMsg(e.message))
  }, [campaignId])

  useEffect(() => {
    const t = setTimeout(() => {
      api.bestiary(q).then((r) => setMonsters(r.monsters)).catch(() => undefined)
    }, 200)
    return () => clearTimeout(t)
  }, [q])

  const filtered = useMemo(() => monsters, [monsters])

  async function uploadMap(file: File) {
    if (!campaignId) return
    const form = new FormData()
    form.append('image', file)
    form.append('name', file.name.replace(/\.[^.]+$/, ''))
    form.append('gridSize', '70')
    form.append('gridCols', '20')
    form.append('gridRows', '15')
    await api.uploadMap(campaignId, form)
    await reload()
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
    setTpl({ name: '', mapId: '', monsters: [] })
    await reload()
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
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <label className="flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-line bg-panel text-muted hover:text-ink">
            <span>Upload a battle map</span>
            <span className="mt-1 text-xs">PNG, JPG, WebP, or SVG</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) uploadMap(f)
              }}
            />
          </label>
          {maps.map((m) => (
            <article key={m.id} className="overflow-hidden rounded-xl border border-line bg-panel">
              <div className="h-40 bg-bg">
                <img src={m.imageUrl} alt="" className="h-full w-full object-cover" />
              </div>
              <div className="p-3">
                <Input className="mb-2" value={m.name} onChange={(e) => setMaps((list) => list.map((x) => (x.id === m.id ? { ...x, name: e.target.value } : x)))} />
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <Field label="Cell px">
                    <Input
                      type="number"
                      value={m.gridSize}
                      onChange={(e) => setMaps((list) => list.map((x) => (x.id === m.id ? { ...x, gridSize: Number(e.target.value) } : x)))}
                    />
                  </Field>
                  <Field label="Cols">
                    <Input
                      type="number"
                      value={m.gridCols}
                      onChange={(e) => setMaps((list) => list.map((x) => (x.id === m.id ? { ...x, gridCols: Number(e.target.value) } : x)))}
                    />
                  </Field>
                  <Field label="Rows">
                    <Input
                      type="number"
                      value={m.gridRows}
                      onChange={(e) => setMaps((list) => list.map((x) => (x.id === m.id ? { ...x, gridRows: Number(e.target.value) } : x)))}
                    />
                  </Field>
                </div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => api.patchMap(m.id, m)}>
                    Save grid
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => api.deleteMap(m.id).then(reload)}>
                    Delete
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
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
                <div className="space-y-3 rounded-xl border border-line bg-panel p-4">
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Name">
                      <Input value={selectedMonster.name ?? ''} onChange={(e) => setSelectedMonster({ ...selectedMonster, name: e.target.value })} />
                    </Field>
                    <Field label="Size">
                      <Input value={selectedMonster.size ?? ''} onChange={(e) => setSelectedMonster({ ...selectedMonster, size: e.target.value })} />
                    </Field>
                    <Field label="Type">
                      <Input value={selectedMonster.creatureType ?? ''} onChange={(e) => setSelectedMonster({ ...selectedMonster, creatureType: e.target.value })} />
                    </Field>
                    <Field label="Alignment">
                      <Input value={selectedMonster.alignment ?? ''} onChange={(e) => setSelectedMonster({ ...selectedMonster, alignment: e.target.value })} />
                    </Field>
                    <Field label="AC">
                      <Input type="number" value={selectedMonster.acValue ?? 10} onChange={(e) => setSelectedMonster({ ...selectedMonster, acValue: Number(e.target.value) })} />
                    </Field>
                    <Field label="HP">
                      <Input type="number" value={selectedMonster.hpMax ?? 10} onChange={(e) => setSelectedMonster({ ...selectedMonster, hpMax: Number(e.target.value) })} />
                    </Field>
                    <Field label="Speed">
                      <Input value={selectedMonster.speed ?? ''} onChange={(e) => setSelectedMonster({ ...selectedMonster, speed: e.target.value })} />
                    </Field>
                    <Field label="CR">
                      <Input type="number" step="0.125" value={selectedMonster.challengeRating ?? 0} onChange={(e) => setSelectedMonster({ ...selectedMonster, challengeRating: Number(e.target.value) })} />
                    </Field>
                  </div>
                  <Field label="Actions (one per line: Name. Description)">
                    <Textarea
                      value={(selectedMonster.actions ?? []).map((a) => `${a.name}. ${a.desc}`).join('\n\n')}
                      onChange={(e) =>
                        setSelectedMonster({
                          ...selectedMonster,
                          actions: e.target.value.split('\n\n').filter(Boolean).map((line) => {
                            const [n, ...rest] = line.split('.')
                            return { name: n.trim(), desc: rest.join('.').trim() } satisfies NamedEntry
                          }),
                        })
                      }
                    />
                  </Field>
                  <div className="flex gap-2">
                    <Button onClick={saveMonster}>{editingNew ? 'Add to bestiary' : 'Save changes'}</Button>
                    {selectedMonster.id && (
                      <Button variant="ghost" onClick={() => api.deleteMonster(selectedMonster.id!).then(reload)}>
                        Delete
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted">Edits do not rewrite monsters already placed in a paused fight.</p>
                </div>
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
            <h2 className="font-display text-xl text-gold">New template</h2>
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
              <Field label="Add from bestiary">
                <Input
                  placeholder="Type a monster name and press Enter"
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    const hit = monsters.find((m) => m.name.toLowerCase() === e.currentTarget.value.toLowerCase()) || monsters.find((m) => m.name.toLowerCase().includes(e.currentTarget.value.toLowerCase()))
                    if (!hit) return
                    const list = [...(tpl.monsters ?? [])]
                    const existing = list.find((x) => x.bestiaryMonsterId === hit.id)
                    if (existing) existing.quantity += 1
                    else
                      list.push({
                        bestiaryMonsterId: hit.id,
                        name: hit.name,
                        quantity: 1,
                        startX: 4 + list.length,
                        startY: 4,
                        color: TOKEN_PALETTE[list.length % TOKEN_PALETTE.length],
                      } satisfies TemplateMonster)
                    setTpl({ ...tpl, monsters: list })
                    e.currentTarget.value = ''
                  }}
                />
              </Field>
              <ul className="space-y-2">
                {(tpl.monsters ?? []).map((m, i) => (
                  <li key={m.bestiaryMonsterId} className="flex items-center gap-2 text-sm">
                    <span className="flex-1">{m.name}</span>
                    <Input
                      className="w-16"
                      type="number"
                      value={m.quantity}
                      onChange={(e) => {
                        const list = tpl.monsters!.slice()
                        list[i] = { ...m, quantity: Number(e.target.value) }
                        setTpl({ ...tpl, monsters: list })
                      }}
                    />
                    <button type="button" className="text-blood" onClick={() => setTpl({ ...tpl, monsters: tpl.monsters!.filter((_, j) => j !== i) })}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <Button onClick={saveTemplate}>Save template</Button>
            </div>
          </div>
          <ul className="space-y-3">
            {templates.map((t) => (
              <li key={t.id} className="rounded-xl border border-line bg-panel p-4">
                <div className="font-display text-lg text-gold">{t.name}</div>
                <p className="text-sm text-muted">
                  {t.monsters.map((m) => `${m.quantity}× ${m.name}`).join(', ') || 'No monsters yet'}
                </p>
                <Button className="mt-2" size="sm" variant="ghost" onClick={() => api.deleteTemplate(t.id).then(reload)}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
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
                <li key={c.id}>
                  <button
                    type="button"
                    className={cn('w-full rounded-md px-2 py-2 text-left hover:bg-panel-2', selectedChar?.id === c.id && 'bg-panel-2')}
                    onClick={() => setSelectedChar(c)}
                  >
                    <div className="font-medium">{c.name}</div>
                    <div className="font-mono text-xs text-gold">{c.personalCode}</div>
                  </button>
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
