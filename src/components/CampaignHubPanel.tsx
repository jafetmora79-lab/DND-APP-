import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { emptyBeat, parseHub, emptyHub, isCombatBeat } from '@/lib/campaign-hub'
import { useT } from '@/lib/i18n'
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
  const { t } = useT()
  const data = parseHub(hub ?? emptyHub())
  const [addedId, setAddedId] = useState<string | null>(null)

  useEffect(() => {
    if (!addedId) return
    document.getElementById(`run-beat-${addedId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [addedId, data.beats.length])

  function patch(next: CampaignHub) {
    onChange?.({ ...next, stages: [] })
  }

  function addBeat(kind: 'social' | 'combat') {
    const id = nid()
    const beat =
      kind === 'combat'
        ? emptyBeat({
            id,
            kind: 'combat',
            title: templates[0]?.name || t('campaignHub.encounter'),
            templateId: templates[0]?.id ?? '',
            status: 'upcoming',
          })
        : emptyBeat({
            id,
            kind: 'social',
            title: t('campaignHub.newScene'),
            status: 'upcoming',
          })
    setAddedId(id)
    patch({ ...data, beats: [...data.beats, beat] })
  }

  return (
    <div className={cn('space-y-4', compact && 'space-y-3')}>
      <section>
        <h3 className="text-xs uppercase tracking-wider text-muted">{t('campaignHub.tonight')}</h3>
        {canEdit ? (
          <div className="mt-2 grid gap-2">
            <Field label={t('campaignHub.sessionTitle')}>
              <Input value={data.sessionTitle} onChange={(e) => patch({ ...data, sessionTitle: e.target.value })} placeholder={t('campaignHub.sessionTitlePlaceholder')} />
            </Field>
            <Field label={t('campaignHub.sessionNotes')}>
              <Input value={data.sessionNotes} onChange={(e) => patch({ ...data, sessionNotes: e.target.value })} placeholder={t('campaignHub.sessionNotesPlaceholder')} />
            </Field>
          </div>
        ) : (
          <div className="mt-1">
            <div className="font-display text-lg text-gold">{data.sessionTitle || t('campaignHub.atTheTable')}</div>
            {!playerView && data.sessionNotes && <p className="text-sm text-muted">{data.sessionNotes}</p>}
          </div>
        )}
      </section>

      <section>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-xs uppercase tracking-wider text-muted">{playerView ? t('campaignHub.now') : t('prep.hubTitle')}</h3>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" className="min-h-10 flex-1 sm:flex-none" onClick={() => addBeat('social')}>
                {t('campaignHub.addScene')}
              </Button>
              <Button type="button" size="sm" variant="outline" className="min-h-10 flex-1 sm:flex-none" onClick={() => addBeat('combat')}>
                {t('campaignHub.addEncounter')}
              </Button>
            </div>
          )}
        </div>
        {!playerView && (
          <p className="mt-1 text-xs text-muted">
            {t('campaignHub.runOrderBlurb')}
          </p>
        )}
        <ul className="mt-2 space-y-2">
          {(playerView ? data.beats.filter((b) => b.status === 'active') : data.beats).map((b, i) => (
            <li key={b.id} id={`run-beat-${b.id}`} className="rounded-lg border border-line bg-bg px-3 py-2">
              {canEdit ? (
                <BeatEditor
                  beat={b}
                  index={playerView ? i : data.beats.indexOf(b)}
                  total={data.beats.length}
                  templates={templates}
                  compact={compact}
                  forceOpen={addedId === b.id}
                  onChange={(next) => {
                    const beats = data.beats.slice()
                    const idx = data.beats.findIndex((x) => x.id === b.id)
                    if (idx < 0) return
                    beats[idx] = next
                    patch({ ...data, beats })
                  }}
                  onMove={(dir) => {
                    const idx = data.beats.findIndex((x) => x.id === b.id)
                    const j = idx + dir
                    if (idx < 0 || j < 0 || j >= data.beats.length) return
                    const beats = data.beats.slice()
                    const swap = beats[idx]!
                    beats[idx] = beats[j]!
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
                        {!playerView && <span className="mr-2 text-[10px] uppercase tracking-wide text-muted">{data.beats.indexOf(b) + 1}.</span>}
                        {b.title}
                      </span>
                      <span className="text-[10px] uppercase tracking-wide text-muted">{t(`campaignHub.status.${b.status}`)}</span>
                    </div>
                    <div className="text-xs text-muted">
                      {isCombatBeat(b)
                        ? `${t('campaignHub.encounter')}${templates.find((t) => t.id === b.templateId) ? ` · ${templates.find((t) => t.id === b.templateId)?.name}` : ''}`
                        : t('campaignHub.scene')}
                      {!playerView && b.notes ? ` · ${b.notes}` : ''}
                    </div>
                    {!playerView && !isCombatBeat(b) && b.caption ? <p className="text-xs text-muted">{b.caption}</p> : null}
                  </div>
                </div>
              )}
            </li>
          ))}
          {data.beats.length === 0 && !playerView && (
            <li className="text-sm text-muted">{t('campaignHub.noRunYet')}</li>
          )}
          {playerView && data.beats.every((b) => b.status !== 'active') && (
            <li className="text-sm text-muted">{t('campaignHub.nextSceneHere')}</li>
          )}
        </ul>
      </section>

      <section>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs uppercase tracking-wider text-muted">{t('campaignHub.quests')}</h3>
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={() => patch({ ...data, quests: [...data.quests, { id: nid(), name: t('campaignHub.newQuest'), status: 'open', notes: '', npcIds: [] }] })}>
              {t('campaignHub.addQuest')}
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
                    <option value="open">{t('campaignHub.questStatus.open')}</option>
                    <option value="complete">{t('campaignHub.questStatus.complete')}</option>
                    <option value="failed">{t('campaignHub.questStatus.failed')}</option>
                  </select>
                  <Input value={q.notes} onChange={(e) => {
                    const quests = data.quests.slice()
                    quests[i] = { ...q, notes: e.target.value }
                    patch({ ...data, quests })
                  }} placeholder={t('sheet.notes')} />
                  <Button type="button" size="sm" variant="danger" className="min-h-10 w-fit" onClick={() => patch({ ...data, quests: data.quests.filter((x) => x.id !== q.id) })}>
                    {t('campaignHub.removeQuest')}
                  </Button>
                </div>
              ) : (
                <div className="text-sm">
                  <span className="font-medium">{q.name}</span>
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-muted">{t(`campaignHub.questStatus.${q.status}`)}</span>
                  {!playerView && q.notes && <p className="text-xs text-muted">{q.notes}</p>}
                </div>
              )}
            </li>
          ))}
          {data.quests.length === 0 && <li className="text-sm text-muted">{t('campaignHub.noQuestsTracked')}</li>}
        </ul>
      </section>

      <section>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs uppercase tracking-wider text-muted">{t('campaignHub.npcs')}</h3>
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={() => patch({ ...data, npcs: [...data.npcs, { id: nid(), name: t('campaignHub.newNpc'), role: '', notes: '' }] })}>
              {t('campaignHub.addNpc')}
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
                  }} placeholder={t('sheet.attackName')} />
                  <Input value={n.role} onChange={(e) => {
                    const npcs = data.npcs.slice()
                    npcs[i] = { ...n, role: e.target.value }
                    patch({ ...data, npcs })
                  }} placeholder={t('campaignHub.role')} />
                  <Input value={n.notes} onChange={(e) => {
                    const npcs = data.npcs.slice()
                    npcs[i] = { ...n, notes: e.target.value }
                    patch({ ...data, npcs })
                  }} placeholder={t('sheet.notes')} />
                  <Button type="button" size="sm" variant="danger" className="min-h-10 w-fit" onClick={() => patch({ ...data, npcs: data.npcs.filter((x) => x.id !== n.id) })}>
                    {t('campaignHub.removeNpc')}
                  </Button>
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
          {data.npcs.length === 0 && <li className="text-sm text-muted">{t('campaignHub.noNpcsYet')}</li>}
        </ul>
      </section>

      <section>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs uppercase tracking-wider text-muted">{t('campaignHub.partyLoot')}</h3>
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={() => patch({ ...data, loot: [...data.loot, { id: nid(), name: t('campaignHub.newItem'), qty: 1, notes: '', holder: '' }] })}>
              {t('campaignHub.addLoot')}
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
                    }} placeholder={t('campaignHub.item')} />
                    <Input type="number" min={1} value={item.qty} onChange={(e) => {
                      const loot = data.loot.slice()
                      loot[i] = { ...item, qty: Number(e.target.value) || 1 }
                      patch({ ...data, loot })
                    }} aria-label={t('campaignHub.quantity')} />
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
                    <option value="">{t('campaignHub.party')}</option>
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
                  }} placeholder={t('sheet.notes')} />
                  <Button type="button" size="sm" variant="danger" className="min-h-10 w-fit" onClick={() => patch({ ...data, loot: data.loot.filter((x) => x.id !== item.id) })}>
                    {t('campaignHub.removeLoot')}
                  </Button>
                </div>
              ) : (
                <div className="text-sm">
                  {item.qty}× {item.name}
                  <span className="text-muted"> · {item.holder ? characters.find((c) => c.id === item.holder)?.name ?? t('campaignHub.carried') : t('campaignHub.party')}</span>
                  {!playerView && item.notes && <p className="text-xs text-muted">{item.notes}</p>}
                </div>
              )}
            </li>
          ))}
          {data.loot.length === 0 && <li className="text-sm text-muted">{t('campaignHub.noLootRecorded')}</li>}
        </ul>
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wider text-muted">{t('campaignHub.recap')}</h3>
        {canEdit ? (
          <textarea
            className="mt-2 min-h-24 w-full rounded-md border border-line bg-bg px-3 py-2 text-sm"
            value={data.recap}
            onChange={(e) => patch({ ...data, recap: e.target.value })}
            placeholder={t('campaignHub.recapPlaceholder')}
          />
        ) : (
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{data.recap || t('campaignHub.noRecapYet')}</p>
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
  compact,
  forceOpen,
  onChange,
  onMove,
  onRemove,
  onUploadImage,
}: {
  beat: SessionBeat
  index: number
  total: number
  templates: EncounterTemplate[]
  compact?: boolean
  forceOpen?: boolean
  onChange: (next: SessionBeat) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  onUploadImage?: (file: File) => Promise<string>
}) {
  const { t } = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(!compact || Boolean(forceOpen))
  const combat = isCombatBeat(beat)
  const details = open || !compact || Boolean(forceOpen)

  async function onFile(file: File) {
    if (!onUploadImage) return
    setBusy(true)
    setError('')
    try {
      const imageUrl = await onUploadImage(file)
      onChange({ ...beat, imageUrl })
    } catch (e) {
      setError(e instanceof Error ? e.message : t('campaignHub.uploadFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <button
          type="button"
          className="min-h-10 min-w-0 flex-1 text-left"
          onClick={() => compact && setOpen((v) => !v)}
        >
          <span className="text-[10px] uppercase tracking-wider text-muted">
            {index + 1}. {combat ? t('campaignHub.encounter') : t('campaignHub.scene')}
            {compact ? (details ? ` · ${t('campaignHub.hide')}` : ` · ${t('campaignHub.edit')}`) : ''}
          </span>
          <div className="truncate font-medium">{beat.title || (combat ? t('campaignHub.encounter') : t('campaignHub.scene'))}</div>
        </button>
        <div className="flex shrink-0 flex-wrap gap-1">
          <Button type="button" size="sm" variant="outline" className="min-h-10" disabled={index === 0} onClick={() => onMove(-1)}>
            {t('campaignHub.up')}
          </Button>
          <Button type="button" size="sm" variant="outline" className="min-h-10" disabled={index === total - 1} onClick={() => onMove(1)}>
            {t('campaignHub.down')}
          </Button>
          <Button type="button" size="sm" variant="danger" className="min-h-10" onClick={onRemove}>
            {t('campaignHub.remove')}
          </Button>
        </div>
      </div>
      {details && (
        <>
          <Input value={beat.title} onChange={(e) => onChange({ ...beat, title: e.target.value })} placeholder={combat ? t('campaignHub.encounterName') : t('campaignHub.sceneName')} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
            <select
              className="h-10 min-h-10 rounded-md border border-line bg-bg px-2 text-sm"
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
              <option value="social">{t('campaignHub.kind.social')}</option>
              <option value="travel">{t('campaignHub.kind.travel')}</option>
              <option value="other">{t('campaignHub.kind.other')}</option>
              <option value="combat">{t('campaignHub.encounter')}</option>
            </select>
            <select
              className="h-10 min-h-10 rounded-md border border-line bg-bg px-2 text-sm"
              value={beat.status}
              onChange={(e) => onChange({ ...beat, status: e.target.value as SessionBeatStatus })}
            >
              <option value="upcoming">{t('campaignHub.status.upcoming')}</option>
              <option value="active">{t('campaignHub.status.active')}</option>
              <option value="done">{t('campaignHub.status.done')}</option>
            </select>
            {combat ? (
              <select
                className="h-10 min-h-10 rounded-md border border-line bg-bg px-2 text-sm"
                value={beat.templateId}
                onChange={(e) => {
                  const templateId = e.target.value
                  const template = templates.find((x) => x.id === templateId)
                  onChange({
                    ...beat,
                    templateId,
                    title: beat.title === 'Encounter' || beat.title === t('campaignHub.encounter') || !beat.title ? template?.name || beat.title : beat.title,
                  })
                }}
              >
                <option value="">{t('campaignHub.pickEncounter')}</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          {!combat && (
            <>
              {beat.imageUrl ? (
                <img src={beat.imageUrl} alt="" className="h-24 w-full rounded object-cover" />
              ) : (
                <div className="flex h-24 items-center justify-center rounded border border-dashed border-line text-xs text-muted">{t('campaignHub.noImageYet')}</div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {onUploadImage && (
                  <label className="inline-flex min-h-10 cursor-pointer items-center rounded-md border border-line bg-bg px-3 text-sm">
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
                    {busy ? t('campaignHub.uploading') : beat.imageUrl ? t('campaignHub.changeImage') : t('campaignHub.uploadImage')}
                  </label>
                )}
                {beat.imageUrl && (
                  <Button type="button" size="sm" variant="ghost" className="min-h-10" onClick={() => onChange({ ...beat, imageUrl: '' })}>
                    {t('campaignHub.removeImage')}
                  </Button>
                )}
              </div>
              <Input value={beat.caption} onChange={(e) => onChange({ ...beat, caption: e.target.value })} placeholder={t('campaignHub.captionOnTable')} />
            </>
          )}
          <Input value={beat.notes} onChange={(e) => onChange({ ...beat, notes: e.target.value })} placeholder={t('sheet.notes')} />
          {error && <p className="text-xs text-blood">{error}</p>}
        </>
      )}
    </div>
  )
}
