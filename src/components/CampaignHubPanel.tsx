import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { emptyBeat, parseHub, emptyHub, isCombatBeat } from '@/lib/campaign-hub'
import type { CampaignHub, EncounterTemplate, PlayerCharacter, QuestStatus, SessionBeat, SessionBeatKind, SessionBeatStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

type Props = {
  hub: CampaignHub
  characters: PlayerCharacter[]
  templates?: EncounterTemplate[]
  canEdit: boolean
  compact?: boolean
  /** Hide DM notes; keep titles, status, roles, loot, and recap. */
  playerView?: boolean
  onChange?: (hub: CampaignHub) => void
  onUploadImage?: (file: File) => Promise<string>
}

function nid() {
  return crypto.randomUUID().slice(0, 8)
}

export function CampaignHubPanel({ hub, characters, templates = [], canEdit, compact, playerView, onChange, onUploadImage }: Props) {
  const data = parseHub(hub ?? emptyHub())
  function patch(next: CampaignHub) {
    onChange?.(next)
  }

  return (
    <div className={cn('space-y-4', compact && 'space-y-3')}>
      <section>
        <h3 className="text-xs uppercase tracking-wider text-muted">Tonight</h3>
        {canEdit ? (
          <div className="mt-2 grid gap-2">
            <Field label="Session title">
              <Input value={data.sessionTitle} onChange={(e) => patch({ ...data, sessionTitle: e.target.value })} placeholder="Night of the Cragmaw" />
            </Field>
            <Field label="Session notes">
              <Input value={data.sessionNotes} onChange={(e) => patch({ ...data, sessionNotes: e.target.value })} placeholder="Ambush, then town rumors…" />
            </Field>
          </div>
        ) : (
          <div className="mt-1">
            <div className="font-display text-lg text-gold">{data.sessionTitle || 'At the table'}</div>
            {!playerView && data.sessionNotes && <p className="text-sm text-muted">{data.sessionNotes}</p>}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs uppercase tracking-wider text-muted">Run order</h3>
          {canEdit && (
            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  patch({
                    ...data,
                    beats: [
                      ...data.beats,
                      emptyBeat({
                        id: nid(),
                        kind: 'social',
                        title: 'New scene',
                        status: 'upcoming',
                      }),
                    ],
                  })
                }
              >
                Add scene
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  patch({
                    ...data,
                    beats: [
                      ...data.beats,
                      emptyBeat({
                        id: nid(),
                        kind: 'combat',
                        title: templates[0]?.name || 'Encounter',
                        templateId: templates[0]?.id ?? '',
                        status: 'upcoming',
                      }),
                    ],
                  })
                }
              >
                Add encounter
              </Button>
            </div>
          )}
        </div>
        <p className="mt-1 text-xs text-muted">
          Top to bottom is what Live follows: opening scene, then Start encounter, then the next scene after that fight ends.
        </p>
        <ul className="mt-2 space-y-2">
          {data.beats.map((b, i) => (
            <li key={b.id} className="rounded-lg border border-line bg-bg px-3 py-2">
              {canEdit ? (
                <BeatEditor
                  beat={b}
                  index={i}
                  total={data.beats.length}
                  templates={templates}
                  onChange={(next) => {
                    const beats = data.beats.slice()
                    beats[i] = next
                    patch({ ...data, beats })
                  }}
                  onMove={(dir) => {
                    const j = i + dir
                    if (j < 0 || j >= data.beats.length) return
                    const beats = data.beats.slice()
                    const swap = beats[i]!
                    beats[i] = beats[j]!
                    beats[j] = swap
                    patch({ ...data, beats })
                  }}
                  onRemove={() => patch({ ...data, beats: data.beats.filter((x) => x.id !== b.id) })}
                  onUploadImage={onUploadImage}
                />
              ) : (
                <div className="flex gap-3">
                  {!isCombatBeat(b) && b.imageUrl ? (
                    <img src={b.imageUrl} alt="" className="h-14 w-20 shrink-0 rounded object-cover" />
                  ) : null}
                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span>
                        <span className="mr-2 text-[10px] uppercase tracking-wide text-muted">{i + 1}.</span>
                        {b.title}
                      </span>
                      <span className="text-[10px] uppercase tracking-wide text-muted">{b.status}</span>
                    </div>
                    <div className="text-xs text-muted">
                      {isCombatBeat(b)
                        ? `Encounter${templates.find((t) => t.id === b.templateId) ? ` · ${templates.find((t) => t.id === b.templateId)?.name}` : ''}`
                        : 'Scene'}
                      {!playerView && b.notes ? ` · ${b.notes}` : ''}
                    </div>
                    {!playerView && !isCombatBeat(b) && b.caption ? <p className="text-xs text-muted">{b.caption}</p> : null}
                  </div>
                </div>
              )}
            </li>
          ))}
          {data.beats.length === 0 && (
            <li className="text-sm text-muted">No run yet. Add the opening scene, then the first encounter, and keep alternating.</li>
          )}
        </ul>
      </section>

      <section>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs uppercase tracking-wider text-muted">Quests</h3>
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={() => patch({ ...data, quests: [...data.quests, { id: nid(), name: 'New quest', status: 'open', notes: '', npcIds: [] }] })}>
              Add quest
            </Button>
          )}
        </div>
        <ul className="mt-2 space-y-2">
          {data.quests.map((q, i) => (
            <li key={q.id} className="rounded-lg border border-line bg-bg px-3 py-2">
              {canEdit ? (
                <div className="grid gap-2">
                  <Input value={q.name} onChange={(e) => {
                    const quests = data.quests.slice()
                    quests[i] = { ...q, name: e.target.value }
                    patch({ ...data, quests })
                  }} />
                  <select
                    className="h-10 rounded-md border border-line bg-bg px-2 text-sm"
                    value={q.status}
                    onChange={(e) => {
                      const quests = data.quests.slice()
                      quests[i] = { ...q, status: e.target.value as QuestStatus }
                      patch({ ...data, quests })
                    }}
                  >
                    <option value="open">Open</option>
                    <option value="complete">Complete</option>
                    <option value="failed">Failed</option>
                  </select>
                  <Input value={q.notes} onChange={(e) => {
                    const quests = data.quests.slice()
                    quests[i] = { ...q, notes: e.target.value }
                    patch({ ...data, quests })
                  }} placeholder="Notes" />
                  <button type="button" className="text-left text-xs text-blood" onClick={() => patch({ ...data, quests: data.quests.filter((x) => x.id !== q.id) })}>
                    Remove quest
                  </button>
                </div>
              ) : (
                <div className="text-sm">
                  <span className="font-medium">{q.name}</span>
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-muted">{q.status}</span>
                  {!playerView && q.notes && <p className="text-xs text-muted">{q.notes}</p>}
                </div>
              )}
            </li>
          ))}
          {data.quests.length === 0 && <li className="text-sm text-muted">No quests tracked.</li>}
        </ul>
      </section>

      <section>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs uppercase tracking-wider text-muted">NPCs</h3>
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={() => patch({ ...data, npcs: [...data.npcs, { id: nid(), name: 'New NPC', role: '', notes: '' }] })}>
              Add NPC
            </Button>
          )}
        </div>
        <ul className="mt-2 space-y-2">
          {data.npcs.map((n, i) => (
            <li key={n.id} className="rounded-lg border border-line bg-bg px-3 py-2">
              {canEdit ? (
                <div className="grid gap-2">
                  <Input value={n.name} onChange={(e) => {
                    const npcs = data.npcs.slice()
                    npcs[i] = { ...n, name: e.target.value }
                    patch({ ...data, npcs })
                  }} placeholder="Name" />
                  <Input value={n.role} onChange={(e) => {
                    const npcs = data.npcs.slice()
                    npcs[i] = { ...n, role: e.target.value }
                    patch({ ...data, npcs })
                  }} placeholder="Role" />
                  <Input value={n.notes} onChange={(e) => {
                    const npcs = data.npcs.slice()
                    npcs[i] = { ...n, notes: e.target.value }
                    patch({ ...data, npcs })
                  }} placeholder="Notes" />
                  <button type="button" className="text-left text-xs text-blood" onClick={() => patch({ ...data, npcs: data.npcs.filter((x) => x.id !== n.id) })}>
                    Remove NPC
                  </button>
                </div>
              ) : (
                <div className="text-sm">
                  <span className="font-medium">{n.name}</span>
                  {n.role && <span className="text-muted"> · {n.role}</span>}
                  {!playerView && n.notes && <p className="text-xs text-muted">{n.notes}</p>}
                </div>
              )}
            </li>
          ))}
          {data.npcs.length === 0 && <li className="text-sm text-muted">No NPCs yet.</li>}
        </ul>
      </section>

      <section>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs uppercase tracking-wider text-muted">Party loot</h3>
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={() => patch({ ...data, loot: [...data.loot, { id: nid(), name: 'New item', qty: 1, notes: '', holder: '' }] })}>
              Add loot
            </Button>
          )}
        </div>
        <ul className="mt-2 space-y-2">
          {data.loot.map((item, i) => (
            <li key={item.id} className="rounded-lg border border-line bg-bg px-3 py-2">
              {canEdit ? (
                <div className="grid gap-2">
                  <div className="grid grid-cols-[1fr_4rem] gap-2">
                    <Input value={item.name} onChange={(e) => {
                      const loot = data.loot.slice()
                      loot[i] = { ...item, name: e.target.value }
                      patch({ ...data, loot })
                    }} placeholder="Item" />
                    <Input type="number" min={1} value={item.qty} onChange={(e) => {
                      const loot = data.loot.slice()
                      loot[i] = { ...item, qty: Number(e.target.value) || 1 }
                      patch({ ...data, loot })
                    }} aria-label="Quantity" />
                  </div>
                  <select
                    className="h-10 rounded-md border border-line bg-bg px-2 text-sm"
                    value={item.holder}
                    onChange={(e) => {
                      const loot = data.loot.slice()
                      loot[i] = { ...item, holder: e.target.value }
                      patch({ ...data, loot })
                    }}
                  >
                    <option value="">Party</option>
                    {characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <Input value={item.notes} onChange={(e) => {
                    const loot = data.loot.slice()
                    loot[i] = { ...item, notes: e.target.value }
                    patch({ ...data, loot })
                  }} placeholder="Notes" />
                  <button type="button" className="text-left text-xs text-blood" onClick={() => patch({ ...data, loot: data.loot.filter((x) => x.id !== item.id) })}>
                    Remove loot
                  </button>
                </div>
              ) : (
                <div className="text-sm">
                  {item.qty}× {item.name}
                  <span className="text-muted"> · {item.holder ? characters.find((c) => c.id === item.holder)?.name ?? 'carried' : 'party'}</span>
                  {!playerView && item.notes && <p className="text-xs text-muted">{item.notes}</p>}
                </div>
              )}
            </li>
          ))}
          {data.loot.length === 0 && <li className="text-sm text-muted">No loot recorded.</li>}
        </ul>
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wider text-muted">Recap</h3>
        {canEdit ? (
          <textarea
            className="mt-2 min-h-24 w-full rounded-md border border-line bg-bg px-3 py-2 text-sm"
            value={data.recap}
            onChange={(e) => patch({ ...data, recap: e.target.value })}
            placeholder="What happened last session…"
          />
        ) : (
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{data.recap || 'No recap yet.'}</p>
        )}
      </section>
    </div>
  )
}

function BeatEditor({
  beat,
  index,
  total,
  templates,
  onChange,
  onMove,
  onRemove,
  onUploadImage,
}: {
  beat: SessionBeat
  index: number
  total: number
  templates: EncounterTemplate[]
  onChange: (next: SessionBeat) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  onUploadImage?: (file: File) => Promise<string>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const combat = isCombatBeat(beat)

  async function onFile(file: File) {
    if (!onUploadImage) return
    setBusy(true)
    setError('')
    try {
      const imageUrl = await onUploadImage(file)
      onChange({ ...beat, imageUrl })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-muted">
          {index + 1}. {combat ? 'Encounter' : 'Scene'}
        </span>
        <div className="flex gap-1">
          <button type="button" className="text-xs text-muted disabled:opacity-40" disabled={index === 0} onClick={() => onMove(-1)}>
            Up
          </button>
          <button type="button" className="text-xs text-muted disabled:opacity-40" disabled={index === total - 1} onClick={() => onMove(1)}>
            Down
          </button>
        </div>
      </div>
      <Input value={beat.title} onChange={(e) => onChange({ ...beat, title: e.target.value })} placeholder={combat ? 'Encounter name' : 'Scene name'} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <select
          className="h-10 rounded-md border border-line bg-bg px-2 text-sm"
          value={combat ? 'combat' : beat.kind === 'combat' ? 'social' : beat.kind}
          onChange={(e) => {
            const kind = e.target.value as SessionBeatKind
            if (kind === 'combat') {
              onChange({
                ...beat,
                kind: 'combat',
                templateId: beat.templateId || templates[0]?.id || '',
                imageUrl: '',
                caption: beat.caption,
              })
            } else {
              onChange({ ...beat, kind, templateId: '' })
            }
          }}
        >
          <option value="social">Scene — social</option>
          <option value="travel">Scene — travel</option>
          <option value="other">Scene — other</option>
          <option value="combat">Encounter</option>
        </select>
        <select
          className="h-10 rounded-md border border-line bg-bg px-2 text-sm"
          value={beat.status}
          onChange={(e) => onChange({ ...beat, status: e.target.value as SessionBeatStatus })}
        >
          <option value="upcoming">Upcoming</option>
          <option value="active">Active</option>
          <option value="done">Done</option>
        </select>
        {combat ? (
          <select
            className="h-10 rounded-md border border-line bg-bg px-2 text-sm"
            value={beat.templateId}
            onChange={(e) => {
              const templateId = e.target.value
              const t = templates.find((x) => x.id === templateId)
              onChange({ ...beat, templateId, title: beat.title === 'Encounter' || !beat.title ? t?.name || beat.title : beat.title })
            }}
          >
            <option value="">Pick encounter</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        ) : (
          <div className="hidden md:block" />
        )}
      </div>
      {!combat && (
        <>
          {beat.imageUrl ? (
            <img src={beat.imageUrl} alt="" className="h-24 w-full rounded object-cover" />
          ) : (
            <div className="flex h-24 items-center justify-center rounded border border-dashed border-line text-xs text-muted">No image yet</div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {onUploadImage && (
              <label className="inline-flex h-10 cursor-pointer items-center rounded-md border border-line bg-bg px-3 text-sm">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) void onFile(file)
                  }}
                />
                {busy ? 'Uploading…' : beat.imageUrl ? 'Change image' : 'Upload image'}
              </label>
            )}
            {beat.imageUrl && (
              <button type="button" className="text-xs text-muted" onClick={() => onChange({ ...beat, imageUrl: '' })}>
                Remove image
              </button>
            )}
          </div>
          <Input value={beat.caption} onChange={(e) => onChange({ ...beat, caption: e.target.value })} placeholder="Caption on the table" />
        </>
      )}
      <Input value={beat.notes} onChange={(e) => onChange({ ...beat, notes: e.target.value })} placeholder="Notes" />
      {error && <p className="text-xs text-blood">{error}</p>}
      <button type="button" className="text-left text-xs text-blood" onClick={onRemove}>
        Remove {combat ? 'encounter' : 'scene'}
      </button>
    </div>
  )
}
