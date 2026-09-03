import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
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
import { cn, DEFAULT_SCRATCH_CELL, mapFeet, nearestWalkableCell, playerStartOrigin, spreadCells, tokenOccupiesBlocked, tokenSizeSquares } from '@/lib/utils'
import { monsterTokenLook, playerTokenLook, templateReady, templateReadyGap } from '@/lib/token-look'
import { copyText } from '@/lib/copy'
import { LanguageToggle, useT } from '@/lib/i18n'
import { ThemeToggle } from '@/lib/theme'
import { CampaignHubPanel } from '@/components/CampaignHubPanel'
import { emptyHub, ensureCombatBeatForTemplate, parseHub, sortTemplates } from '@/lib/campaign-hub'

const tabs = ['Maps', 'Encounters', 'Campaign', 'Characters', 'Bestiary'] as const

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
      const look = monsterTokenLook(spec.name, src?.creatureType)
      tokens.push({
        id: `tpl:${specIndex}:${copyIndex}`,
        encounterInstanceId: '',
        x: pos.col * cell + cell / 2,
        y: pos.row * cell + cell / 2,
        refType: 'combatant',
        refId: `tpl:${specIndex}:${copyIndex}`,
        label: spec.quantity > 1 ? `${spec.name} ${copyIndex + 1}` : spec.name,
        color: look.from,
        color2: look.to,
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
    const look = playerTokenLook(ch.color || pc?.tokenColor || TOKEN_PALETTE[0])
    tokens.push({
      id: `pch:${ch.characterId}`,
      encounterInstanceId: '',
      x: ch.startX * cell + cell / 2,
      y: ch.startY * cell + cell / 2,
      refType: 'character',
      refId: ch.characterId,
      label: ch.name || pc?.name || 'Player',
      color: look.from,
      color2: look.to,
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

function placeCharacterOnTemplate(
  tpl: Partial<EncounterTemplate>,
  ch: PlayerCharacter,
  cell: { col: number; row: number },
): Partial<EncounterTemplate> {
  const next: TemplateCharacter = {
    characterId: ch.id,
    name: ch.name,
    startX: cell.col,
    startY: cell.row,
    color: ch.tokenColor,
  }
  const list = [...(tpl.characters ?? [])]
  const i = list.findIndex((c) => c.characterId === ch.id)
  if (i >= 0) list[i] = { ...list[i], ...next }
  else list.push(next)
  return { ...tpl, characters: list }
}

export function Prep() {
  const { campaignId } = useParams()
  const nav = useNavigate()
  const { t } = useT()
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
  const [placingCharacterId, setPlacingCharacterId] = useState<string | null>(null)
  const [hub, setHub] = useState(emptyHub())

  async function reload() {
    if (!campaignId) return
    const [m, b, t, c, camps] = await Promise.all([
      api.maps(campaignId),
      api.bestiary(),
      api.templates(campaignId),
      api.characters(campaignId),
      api.campaigns(),
    ])
    setMaps(m.maps)
    setMonsters(b.monsters)
    setTemplates(t.templates)
    setCharacters(c.characters)
    const mine = camps.campaigns.find((x) => x.id === campaignId)
    if (mine?.hub) setHub(parseHub(mine.hub))
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
    setMsg(t('prep.pictureAttachedMsg'))
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
    setMsg(t('prep.blankCreatedMsg', { cols: newMapCols, rows: newMapRows, feet: mapFeet(newMapCols, newMapRows) }))
  }

  async function saveMonster() {
    if (!selectedMonster?.name) return
    await api.saveMonster(selectedMonster)
    setEditingNew(false)
    setMsg(t('prep.monsterSavedMsg'))
    await reload()
  }

  async function saveTemplate() {
    if (!campaignId || !tpl.name || !tpl.mapId) {
      setMsg(t('encounter.errNameMap'))
      return
    }
    try {
      const r = await api.saveTemplate(campaignId, {
        ...tpl,
        monsters: tpl.monsters ?? [],
        characters: tpl.characters ?? [],
      })
      const savedId = r.template?.id ?? tpl.id
      const [m, b, tpls, c, camps] = await Promise.all([
        api.maps(campaignId),
        api.bestiary(),
        api.templates(campaignId),
        api.characters(campaignId),
        api.campaigns(),
      ])
      setMaps(m.maps)
      setMonsters(b.monsters)
      setTemplates(tpls.templates)
      setCharacters(c.characters)
      const mine = camps.campaigns.find((x) => x.id === campaignId)
      let nextHub = parseHub(mine?.hub ?? hub)
      const fresh = savedId ? tpls.templates.find((x) => x.id === savedId) : undefined
      const saved = fresh ?? r.template
      if (saved?.id) {
        nextHub = ensureCombatBeatForTemplate(nextHub, saved)
        await api.patchCampaign(campaignId, { hub: { ...nextHub, stages: [] } })
        setTpl({
          ...saved,
          monsters: saved.monsters ?? [],
          characters: saved.characters ?? [],
        })
      }
      setHub(nextHub)
      const gap = templateReadyGap(saved ?? tpl)
      setMsg(gap ? t('encounter.savedDraftMsg', { gap: t(`encounter.gap.${gap}`) }) : t('encounter.savedMsg'))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('encounter.errSave'))
    }
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
            {t('prep.allCampaigns')}
          </Link>
          <h1 className="font-display text-3xl text-gold-2">{t('prep.title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('prep.setupHint')}</p>
        </div>
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <ThemeToggle />
          <Button
            variant="outline"
            onClick={async () => {
              if (!campaignId) return
              try {
                await api.endSession(campaignId)
                setMsg(t('prep.campaignEndedMsg'))
              } catch (e) {
                setMsg(e instanceof Error ? e.message : t('prep.errEndCampaign'))
              }
            }}
          >
            {t('prep.endLive')}
          </Button>
          <Button
            onClick={async () => {
              if (!campaignId) return
              try {
                await api.ensureSession(campaignId)
                nav(`/dm/${campaignId}/live`)
              } catch (e) {
                setMsg(e instanceof Error ? e.message : t('prep.errStartCampaign'))
              }
            }}
          >
            {t('prep.openLive')}
          </Button>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-1">
        {tabs.map((name) => (
          <button
            key={name}
            type="button"
            className={cn('min-h-10 rounded-md px-3 py-1.5 text-sm', tab === name ? 'bg-gold text-bg' : 'text-muted hover:bg-panel-2')}
            onClick={() => setTab(name)}
          >
            {t(`prep.tab.${name.toLowerCase()}`)}
          </button>
        ))}
      </div>
      {msg && (
        <p className={cn('mt-3 text-sm', /could not|before saving|run migrate/i.test(msg) ? 'text-blood' : 'text-moss')}>
          {msg}
        </p>
      )}

      {tab === 'Campaign' && (
        <div className="mt-6 rounded-xl border border-line bg-panel p-4">
          <h2 className="font-display text-xl text-gold">{t('prep.hubTitle')}</h2>
          <p className="mt-1 text-sm text-muted">{t('prep.hubBlurb')}</p>
          <div className="mt-4">
            <CampaignHubPanel
              hub={hub}
              characters={characters}
              templates={templates}
              canEdit
              onChange={setHub}
              onUploadImage={
                campaignId
                  ? async (file) => {
                      const r = await api.uploadStageImage(campaignId, file)
                      return r.imageUrl
                    }
                  : undefined
              }
            />
          </div>
          <Button
            className="mt-4 min-h-11 w-full sm:w-auto"
            onClick={() => {
              if (!campaignId) return
              api
                .patchCampaign(campaignId, { hub: { ...hub, stages: [] } })
                .then(() => setMsg(t('prep.runOrderSavedMsg')))
                .catch((e) => setMsg(e instanceof Error ? e.message : t('prep.errSaveHub')))
            }}
          >
            {t('prep.saveRunOrder')}
          </Button>
        </div>
      )}

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
              <h2 className="font-display text-xl text-gold">{t('prep.newGrid')}</h2>
              <p className="mt-1 text-xs text-muted">{t('prep.newGridBlurb')}</p>
              <div className="mt-3 grid gap-3">
                <Field label={t('common.name')}>
                  <Input value={newMapName} onChange={(e) => setNewMapName(e.target.value)} />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t('field.squaresWide')}>
                    <Input type="number" min={1} max={80} value={newMapCols} onChange={(e) => setNewMapCols(Number(e.target.value) || 1)} />
                  </Field>
                  <Field label={t('field.squaresHigh')}>
                    <Input type="number" min={1} max={80} value={newMapRows} onChange={(e) => setNewMapRows(Number(e.target.value) || 1)} />
                  </Field>
                </div>
                <p className="text-sm text-gold">{mapFeet(newMapCols, newMapRows)}</p>
                <Button onClick={() => createBlankMap().catch((e) => setMsg(e.message))}>{t('prep.createBlankMap')}</Button>
              </div>
            </div>
            <label className="flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-line bg-panel p-4 text-center text-muted hover:text-ink">
              <span className="font-display text-xl text-gold">{t('prep.optionalBackground')}</span>
              <span className="mt-2 max-w-xs text-sm">{t('prep.backgroundHint')}</span>
              <span className="mt-1 text-xs">{t('prep.imageFormats')}</span>
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
                  {m.blocked?.some((v) => v > 0) ? t('prep.terrainPaintedSuffix') : ''}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => setEditingMapId(m.id)}>
                    {t('prep.editMap')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => api.deleteMap(m.id).then(reload)}>
                    {t('common.delete')}
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
            <Input placeholder={t('bestiary.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
            <Button
              className="mt-2 w-full"
              variant="outline"
              onClick={() => {
                setEditingNew(true)
                setSelectedMonster(blankMonster())
              }}
            >
              {t('bestiary.addMonster')}
            </Button>
            <p className="mt-2 text-xs text-muted">{t('bestiary.entriesHint', { count: filtered.length })}</p>
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
                      {t('bestiary.cr')} {m.challengeRating} · {m.creatureType}
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
                  <p className="text-sm text-muted">{t('bestiary.fillHint')}</p>
                )}
              </div>
            ) : (
              <p className="text-muted">{t('bestiary.introHint')}</p>
            )}
          </div>
        </div>
      )}

      {tab === 'Encounters' && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-line bg-panel p-4">
            <h2 className="font-display text-xl text-gold">{tpl.id ? t('encounter.editTemplate') : t('encounter.newTemplate')}</h2>
            <div className="mt-3 grid gap-3">
              <Field label={t('common.name')}>
                <Input value={tpl.name ?? ''} onChange={(e) => setTpl({ ...tpl, name: e.target.value })} />
              </Field>
              <Field label={t('encounter.objective')}>
                <Input value={tpl.objective ?? ''} onChange={(e) => setTpl({ ...tpl, objective: e.target.value })} placeholder={t('encounter.objectivePlaceholder')} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('encounter.difficulty')}>
                  <Input value={tpl.difficulty ?? ''} onChange={(e) => setTpl({ ...tpl, difficulty: e.target.value })} placeholder={t('encounter.difficultyPlaceholder')} />
                </Field>
                <Field label={t('encounter.xpAward')}>
                  <Input type="number" min={0} value={tpl.xpAward ?? 0} onChange={(e) => setTpl({ ...tpl, xpAward: Number(e.target.value) || 0 })} />
                </Field>
              </div>
              <Field label={t('sheet.notes')}>
                <Input value={tpl.notes ?? ''} onChange={(e) => setTpl({ ...tpl, notes: e.target.value })} placeholder={t('encounter.notesPlaceholder')} />
              </Field>
              <Field label={t('encounter.loot')}>
                <Input value={tpl.lootNotes ?? ''} onChange={(e) => setTpl({ ...tpl, lootNotes: e.target.value })} placeholder={t('encounter.lootPlaceholder')} />
              </Field>
              <Field label={t('encounter.playOrder')}>
                <Input type="number" value={tpl.sortOrder ?? 0} onChange={(e) => setTpl({ ...tpl, sortOrder: Number(e.target.value) || 0 })} />
              </Field>
              <Field label={t('player.map')}>
                <select
                  className="h-10 rounded-md border border-line bg-bg px-3 text-sm"
                  value={tpl.mapId ?? ''}
                  onChange={(e) => setTpl({ ...tpl, mapId: e.target.value })}
                >
                  <option value="">{t('encounter.chooseMap')}</option>
                  {maps.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="rounded-lg border border-line/70 p-3">
                <div className="text-xs uppercase tracking-wider text-muted">{t('encounter.monsters')}</div>
                <Field label={t('common.filter')}>
                  <Input
                    placeholder={t('encounter.searchBestiary')}
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
                    <option value="">{t('encounter.chooseMonster')}</option>
                    {encounterMonsters.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} · {t('bestiary.cr')} {m.challengeRating}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={beastQty}
                    onChange={(e) => setBeastQty(Math.max(1, Number(e.target.value) || 1))}
                    aria-label={t('encounter.quantity')}
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
                          color: monsterTokenLook(hit.name, hit.creatureType).from,
                          positions: cells.map((c) => ({ x: c.col, y: c.row })),
                        } satisfies TemplateMonster)
                        setTpl({ ...tpl, monsters: list })
                      }
                      setBeastPick('')
                      setBeastQty(1)
                    }}
                  >
                    {t('common.add')}
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
                <div className="text-xs uppercase tracking-wider text-muted">{t('encounter.playerStartingSquares')}</div>
                <p className="mt-1 text-xs text-muted">
                  {t('encounter.placeHint')}
                </p>
                {placingCharacterId && (
                  <p className="mt-2 text-xs text-gold">
                    {t('encounter.clickToSetStart', { name: characters.find((c) => c.id === placingCharacterId)?.name ?? 'this character' })}
                  </p>
                )}
                <ul className="mt-2 space-y-2">
                  {characters.map((ch) => {
                    const placed = (tpl.characters ?? []).some((c) => c.characterId === ch.id)
                    const placing = placingCharacterId === ch.id
                    return (
                      <li key={ch.id} className="flex items-center gap-2 text-sm">
                        <span className="h-3 w-3 rounded-full" style={{ background: ch.tokenColor }} />
                        <span className="flex-1">{ch.name}</span>
                        {placed ? (
                          <>
                            <Button
                              size="sm"
                              variant={placing ? 'default' : 'ghost'}
                              onClick={() => setPlacingCharacterId(placing ? null : ch.id)}
                            >
                              {placing ? t('encounter.clickASquare') : t('map.move')}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                if (placingCharacterId === ch.id) setPlacingCharacterId(null)
                                setTpl({ ...tpl, characters: (tpl.characters ?? []).filter((c) => c.characterId !== ch.id) })
                              }}
                            >
                              {t('common.remove')}
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant={placing ? 'default' : 'outline'}
                            disabled={!tpl.mapId}
                            onClick={() => {
                              const map = maps.find((m) => m.id === tpl.mapId)
                              if (!map) return
                              const occupied = occupiedKeys(tpl.monsters ?? [], tpl.characters ?? [], map)
                              const origin = playerStartOrigin(map.gridCols, map.gridRows)
                              const cell = spreadCells(origin, 1, map.gridCols, map.gridRows, map.blocked, occupied)[0]
                              setTpl(placeCharacterOnTemplate(tpl, ch, cell))
                              setPlacingCharacterId(ch.id)
                              setMsg(t('encounter.placedMsg', { name: ch.name }))
                            }}
                          >
                            {t('encounter.placeOnMap')}
                          </Button>
                        )}
                      </li>
                    )
                  })}
                  {characters.length === 0 && <li className="text-xs text-muted">{t('encounter.noCharactersYet')}</li>}
                </ul>
              </div>
              <p className="text-xs text-muted">{t('encounter.copyHint')}</p>
              <div className="flex gap-2">
                <div className="flex flex-wrap gap-2">
                  <Button onClick={saveTemplate}>{tpl.id ? t('encounter.saveChanges') : t('encounter.saveTemplate')}</Button>
                  {tpl.id ? (
                    <Button
                      variant="outline"
                      onClick={() =>
                        setTpl({ name: '', mapId: tpl.mapId ?? '', monsters: [], characters: [], objective: '', notes: '', difficulty: '', xpAward: 0, lootNotes: '' })
                      }
                    >
                      {t('encounter.newEncounter')}
                    </Button>
                  ) : null}
                </div>
                {tpl.id && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setPlacingCharacterId(null)
                      setTpl({ name: '', mapId: '', monsters: [], characters: [], notes: '', objective: '', difficulty: '', xpAward: 0, lootNotes: '', sortOrder: templates.length })
                    }}
                  >
                    {t('encounter.newTemplate')}
                  </Button>
                )}
                {tpl.id && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setPlacingCharacterId(null)
                      setTpl({
                        ...tpl,
                        id: undefined,
                        name: `${tpl.name ?? 'Encounter'} (copy)`,
                        sortOrder: (tpl.sortOrder ?? 0) + 1,
                      })
                      setMsg(t('encounter.duplicatedMsg'))
                    }}
                  >
                    {t('common.duplicate')}
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
                  selectedId={placingCharacterId ?? undefined}
                  onCellClick={(col, row) => {
                    const map = maps.find((m) => m.id === tpl.mapId)
                    if (!map) return
                    if (tokenOccupiesBlocked(map.blocked, col, row, map.gridCols, map.gridRows)) {
                      setMsg(t('encounter.blockedSquare'))
                      return
                    }
                    const ch =
                      characters.find((c) => c.id === placingCharacterId) ??
                      characters.find((c) => !(tpl.characters ?? []).some((x) => x.characterId === c.id))
                    if (!ch) {
                      setMsg(t('encounter.chooseCharacterFirst'))
                      return
                    }
                    setTpl(placeCharacterOnTemplate(tpl, ch, { col, row }))
                    setPlacingCharacterId(ch.id)
                    setMsg(t('encounter.setSquareMsg', { name: ch.name, col: col + 1, row: row + 1 }))
                  }}
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
              <p className="rounded-xl border border-dashed border-line p-6 text-sm text-muted">{t('encounter.chooseMapHint')}</p>
            )}
            <ul className="space-y-3">
              {sortTemplates(templates).map((tp) => (
                <li key={tp.id} className="rounded-xl border border-line bg-panel p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-display text-lg text-gold">{tp.name}</div>
                    {templateReady(tp) ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-moss/20 px-2 py-0.5 text-xs uppercase tracking-wider text-moss">
                        <Check className="h-3.5 w-3.5" /> {t('encounter.ready')}
                      </span>
                    ) : (
                      <span className="rounded-full bg-panel-2 px-2 py-0.5 text-xs uppercase tracking-wider text-muted">
                        {t('encounter.draft', { gap: t(`encounter.gap.${templateReadyGap(tp)}`) })}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted">
                    {tp.monsters.map((m) => `${m.quantity}× ${m.name}`).join(', ') || t('encounter.noMonstersYet')}
                    {(tp.characters?.length ?? 0) > 0 ? ` · ${tp.characters!.map((c) => c.name).join(', ')}` : ''}
                  </p>
                  {(tp.difficulty || tp.objective || tp.xpAward) && (
                    <p className="text-xs text-gold">
                      {[tp.difficulty, tp.objective, tp.xpAward ? `${tp.xpAward} ${t('sheet.xpShort')}` : ''].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setPlacingCharacterId(null)
                        setTpl({
                          ...tp,
                          monsters: tp.monsters.map((m, i) => ({
                            ...m,
                            startX: Number.isFinite(m.startX) ? m.startX : 2 + (i % 8),
                            startY: Number.isFinite(m.startY) ? m.startY : 2 + Math.floor(i / 8),
                          })),
                          characters: tp.characters ?? [],
                        })
                      }}
                    >
                      {t('encounter.editPlacement')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => api.deleteTemplate(tp.id).then(reload)}>
                      {t('common.delete')}
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
              {t('prep.createCharacter')}
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
                    <div className="text-xs text-gold">{t('characters.joinAs', { name: c.name })}</div>
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    title={t('characters.copyName', { name: c.name })}
                    onClick={() => copyCode(c.name, c.id)}
                  >
                    {copied === c.id ? <Check className="h-4 w-4 text-moss" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
          {selectedChar ? (
            <div className="min-w-0 rounded-xl border border-line bg-panel p-4">
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
                  setMsg(
                    r.fieldCount
                      ? t('characters.pdfRead', { count: r.fieldCount })
                      : t('characters.pdfNoFields'),
                  )
                  await reload()
                }}
              />
            </div>
          ) : (
            <p className="text-muted">{t('prep.characterHint')}</p>
          )}
        </div>
      )}
    </div>
  )
}
