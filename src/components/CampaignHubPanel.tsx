import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { emptyHub, parseHub } from '@/lib/campaign-hub'
import type { CampaignHub, EncounterTemplate, PlayerCharacter, QuestStatus, SessionBeatKind, SessionBeatStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

type Props = {
  hub: CampaignHub
  characters: PlayerCharacter[]
  templates?: EncounterTemplate[]
  canEdit: boolean
  compact?: boolean
  onChange?: (hub: CampaignHub) => void
}

function nid() {
  return crypto.randomUUID().slice(0, 8)
}

export function CampaignHubPanel({ hub, characters, templates = [], canEdit, compact, onChange }: Props) {
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
            {data.sessionNotes && <p className="text-sm text-muted">{data.sessionNotes}</p>}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs uppercase tracking-wider text-muted">Timeline</h3>
          {canEdit && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                patch({
                  ...data,
                  beats: [...data.beats, { id: nid(), kind: 'combat', title: 'New beat', notes: '', templateId: '', status: 'upcoming' }],
                })
              }
            >
              Add beat
            </Button>
          )}
        </div>
        <ul className="mt-2 space-y-2">
          {data.beats.map((b, i) => (
            <li key={b.id} className="rounded-lg border border-line bg-bg px-3 py-2">
              {canEdit ? (
                <div className="grid gap-2">
                  <Input value={b.title} onChange={(e) => {
                    const beats = data.beats.slice()
                    beats[i] = { ...b, title: e.target.value }
                    patch({ ...data, beats })
                  }} />
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                    <select
                      className="h-10 rounded-md border border-line bg-bg px-2 text-sm"
                      value={b.kind}
                      onChange={(e) => {
                        const beats = data.beats.slice()
                        beats[i] = { ...b, kind: e.target.value as SessionBeatKind }
                        patch({ ...data, beats })
                      }}
                    >
                      <option value="combat">Combat</option>
                      <option value="social">Social</option>
                      <option value="travel">Travel</option>
                      <option value="other">Other</option>
                    </select>
                    <select
                      className="h-10 rounded-md border border-line bg-bg px-2 text-sm"
                      value={b.status}
                      onChange={(e) => {
                        const beats = data.beats.slice()
                        beats[i] = { ...b, status: e.target.value as SessionBeatStatus }
                        patch({ ...data, beats })
                      }}
                    >
                      <option value="upcoming">Upcoming</option>
                      <option value="active">Active</option>
                      <option value="done">Done</option>
                    </select>
                    <select
                      className="h-10 rounded-md border border-line bg-bg px-2 text-sm"
                      value={b.templateId}
                      onChange={(e) => {
                        const beats = data.beats.slice()
                        beats[i] = { ...b, templateId: e.target.value }
                        patch({ ...data, beats })
                      }}
                    >
                      <option value="">No fight</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Input value={b.notes} onChange={(e) => {
                    const beats = data.beats.slice()
                    beats[i] = { ...b, notes: e.target.value }
                    patch({ ...data, beats })
                  }} placeholder="Notes" />
                  <button type="button" className="text-left text-xs text-blood" onClick={() => patch({ ...data, beats: data.beats.filter((x) => x.id !== b.id) })}>
                    Remove beat
                  </button>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span>{b.title}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted">{b.status}</span>
                  </div>
                  <div className="text-xs text-muted">{b.kind}{b.notes ? ` · ${b.notes}` : ''}</div>
                </div>
              )}
            </li>
          ))}
          {data.beats.length === 0 && <li className="text-sm text-muted">No beats yet. Add the night’s order here.</li>}
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
                  {q.notes && <p className="text-xs text-muted">{q.notes}</p>}
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
                  {n.notes && <p className="text-xs text-muted">{n.notes}</p>}
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
                  {item.notes && <p className="text-xs text-muted">{item.notes}</p>}
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
