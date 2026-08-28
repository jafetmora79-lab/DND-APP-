import { useRef, useState, type ReactNode } from 'react'
import { Check, ImagePlus, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AmbianceStage } from '@/components/AmbianceStage'
import { StartFightDialog } from '@/components/StartFightDialog'
import { CampaignHubPanel } from '@/components/CampaignHubPanel'
import { sortTemplates, stagePlacementLabel } from '@/lib/campaign-hub'
import { templateReady } from '@/lib/token-look'
import { applyShortRestHp, type StartFightOpts } from '@/lib/turn-flow'
import type { CampaignHub, CampaignStage, EncounterInstance, EncounterOutcome, EncounterTemplate, PlayerCharacter } from '@/lib/types'
import { cn } from '@/lib/utils'

type SceneCommit = {
  file: File
  name: string
  caption: string
  afterTemplateId: string
  beforeTemplateId: string
  saveToCampaign: boolean
}

type DmProps = {
  caption: string
  onCaption: (value: string) => void
  onUpload: (file: File) => void
  onCommitScene?: (scene: SceneCommit) => void
  onClearImage: () => void
  hasImage: boolean
  templates: EncounterTemplate[]
  paused: EncounterInstance[]
  onStart: (templateId: string, opts?: StartFightOpts) => void
  onResume: (instanceId: string) => void
  busy: boolean
  activeFight?: boolean
  stages?: CampaignStage[]
  onSelectStage?: (stageId: string) => void
  onHubChange?: (hub: CampaignHub) => void
  onUploadStage?: (file: File) => Promise<string>
}

type Props = {
  campaignName: string
  imageUrl: string | null
  caption: string
  lastOutcome: EncounterOutcome | null
  hub?: CampaignHub | null
  characters: PlayerCharacter[]
  selectedId: string | null
  onSelectCharacter: (id: string) => void
  sheet: ReactNode
  playerView?: boolean
  dm?: DmProps
  onShortRest?: (characterId: string, hpCurrent: number) => void
}

export function TableHub({
  campaignName,
  imageUrl,
  caption,
  lastOutcome,
  hub,
  characters,
  selectedId,
  onSelectCharacter,
  sheet,
  playerView,
  dm,
  onShortRest,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [startTpl, setStartTpl] = useState<EncounterTemplate | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [restHp, setRestHp] = useState('')
  const selected = characters.find((c) => c.id === selectedId)

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row overflow-hidden">
      <div className="relative min-h-[40vh] flex-1 lg:min-h-0">
        <AmbianceStage imageUrl={imageUrl} caption={caption} className="h-full min-h-[40vh]" />
        {lastOutcome && (
          <div
            className={cn(
              'absolute left-3 top-3 rounded-full px-3 py-1 text-xs uppercase tracking-wider',
              lastOutcome === 'won' ? 'bg-gold/20 text-gold-2' : 'bg-blood/20 text-blood',
            )}
          >
            Last fight: {lastOutcome === 'won' ? 'victory' : 'defeat'}
          </div>
        )}
        {dm && (
          <div className="absolute bottom-3 right-3 flex flex-wrap justify-end gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                if (dm.onCommitScene) setPendingFile(file)
                else dm.onUpload(file)
              }}
            />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={dm.busy}>
              <ImagePlus className="h-4 w-4" />
              {dm.hasImage ? 'Change scene' : 'Set scene'}
            </Button>
            {dm.hasImage && (
              <Button size="sm" variant="ghost" disabled={dm.busy} onClick={dm.onClearImage}>
                Use tavern scene
              </Button>
            )}
          </div>
        )}
      </div>

      <aside className="flex w-full shrink-0 flex-col overflow-y-auto border-t border-line bg-panel lg:w-[28rem] lg:border-l lg:border-t-0">
        <div className="border-b border-line p-3">
          <p className="text-xs uppercase tracking-[0.3em] text-gold">{campaignName}</p>
          <h2 className="font-display text-xl text-gold-2">{dm ? 'The table' : 'Your character'}</h2>
          <p className="mt-1 text-sm text-muted">
            {dm
              ? 'Talk, travel, and plan here. Start a fight when you are ready — the join code stays the same. Table during combat pauses the fight; Finalize ends it.'
              : 'This is the campaign table. Your sheet stays open while the party talks, travels, or waits on the next fight.'}
          </p>
          {dm && (
            <>
              {dm.stages && dm.stages.length > 0 && (
                <select
                  className="mt-3 h-10 w-full rounded-md border border-line bg-bg px-2 text-sm"
                  aria-label="Campaign scene"
                  value={dm.stages.find((s) => s.imageUrl === imageUrl || (!s.imageUrl && s.caption === caption && !imageUrl))?.id ?? ''}
                  onChange={(e) => dm.onSelectStage?.(e.target.value)}
                >
                  <option value="">Choose a campaign scene…</option>
                  {dm.stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {stagePlacementLabel(s, dm.templates)}
                    </option>
                  ))}
                </select>
              )}
              <Input
                className="mt-3"
                placeholder="Scene caption — a tavern, a road, a council chamber…"
                value={dm.caption}
                onChange={(e) => dm.onCaption(e.target.value)}
              />
            </>
          )}
        </div>

        {dm && (
          <div className="border-b border-line p-3">
            {dm.paused.length > 0 && (
              <section className="mb-4">
                <h3 className="text-xs uppercase tracking-wider text-muted">Paused fights</h3>
                <ul className="mt-2 space-y-2">
                  {dm.paused.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-bg px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate">{i.name}</div>
                        <div className="text-xs text-muted">{i.roundNumber === 0 ? 'Initiative' : `Round ${i.roundNumber}`}</div>
                      </div>
                      <Button size="sm" disabled={dm.busy} onClick={() => dm.onResume(i.id)}>
                        <Play className="h-4 w-4" /> Resume
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <h3 className="text-xs uppercase tracking-wider text-muted">Next encounter</h3>
            <ul className="mt-2 space-y-2">
              {sortTemplates(dm.templates).map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-bg px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 truncate">
                      {templateReady(t) && <Check className="h-4 w-4 shrink-0 text-moss" aria-label="Ready" />}
                      <span className="truncate">{t.name}</span>
                    </div>
                    <div className="truncate text-xs text-muted">
                      {[t.difficulty, t.objective, t.monsters.map((m) => `${m.quantity}× ${m.name}`).join(', ')].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <Button size="sm" variant="ember" disabled={dm.busy} onClick={() => setStartTpl(t)}>
                    Start
                  </Button>
                </li>
              ))}
              {dm.templates.length === 0 && (
                <li className="text-sm text-muted">Build an encounter template in prep, then start it from this table.</li>
              )}
            </ul>
          </div>
        )}

        <div className="flex gap-2 overflow-x-auto border-b border-line px-3 py-2">
          {characters.map((c) => (
            <button
              key={c.id}
              type="button"
              className={cn(
                'shrink-0 rounded-full border px-3 py-1 text-sm',
                selectedId === c.id ? 'border-gold bg-gold text-bg' : 'border-line text-ink',
              )}
              onClick={() => onSelectCharacter(c.id)}
            >
              {c.name}
            </button>
          ))}
          {characters.length === 0 && <p className="text-sm text-muted">No characters in this campaign yet.</p>}
        </div>
        {hub && (
          <div className={cn('overflow-y-auto border-b border-line p-3', dm?.onHubChange ? 'max-h-[32rem]' : 'max-h-64')}>
            <CampaignHubPanel
              hub={hub}
              characters={characters}
              templates={dm?.templates}
              canEdit={Boolean(dm?.onHubChange)}
              compact
              playerView={playerView}
              onChange={dm?.onHubChange}
              onUploadImage={dm?.onUploadStage}
            />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {selected && onShortRest && (
            <div className="mb-3 rounded-md border border-line bg-bg p-2">
              <div className="text-xs uppercase tracking-wider text-muted">Short rest — {selected.name}</div>
              <p className="mt-1 text-xs text-muted">
                Type the HP recovered from hit dice ({selected.sheet.hitDice || 'none on sheet'}). The app does not roll.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input
                  className="h-8 w-20"
                  inputMode="numeric"
                  placeholder="HP"
                  value={restHp}
                  onChange={(e) => setRestHp(e.target.value)}
                  aria-label="Hit dice HP recovered"
                />
                <Button
                  size="sm"
                  disabled={dm?.busy}
                  onClick={() => {
                    const n = Number(restHp)
                    if (!Number.isFinite(n) || n < 0) return
                    onShortRest(selected.id, applyShortRestHp(selected.sheet.hpCurrent, selected.sheet.hpMax, n))
                    setRestHp('')
                  }}
                >
                  Apply HP
                </Button>
              </div>
            </div>
          )}
          {sheet}
        </div>
      </aside>
      {startTpl && dm && (
        <StartFightDialog
          template={startTpl}
          characters={characters}
          busy={dm.busy}
          warnActiveFight={dm.activeFight}
          onCancel={() => setStartTpl(null)}
          onConfirm={(opts) => {
            dm.onStart(startTpl.id, opts)
            setStartTpl(null)
          }}
        />
      )}
      {pendingFile && dm?.onCommitScene && (
        <SetSceneDialog
          file={pendingFile}
          templates={dm.templates}
          defaultCaption={dm.caption}
          busy={dm.busy}
          onCancel={() => setPendingFile(null)}
          onConfirm={(scene) => {
            dm.onCommitScene?.(scene)
            setPendingFile(null)
          }}
        />
      )}
    </div>
  )
}

function SetSceneDialog({
  file,
  templates,
  defaultCaption,
  busy,
  onCancel,
  onConfirm,
}: {
  file: File
  templates: EncounterTemplate[]
  defaultCaption: string
  busy: boolean
  onCancel: () => void
  onConfirm: (scene: SceneCommit) => void
}) {
  const stem = file.name.replace(/\.[^.]+$/, '')
  const ordered = sortTemplates(templates)
  const [name, setName] = useState(stem)
  const [caption, setCaption] = useState(defaultCaption || stem)
  const [afterTemplateId, setAfterTemplateId] = useState('')
  const [beforeTemplateId, setBeforeTemplateId] = useState(ordered[0]?.id ?? '')
  const [saveToCampaign, setSaveToCampaign] = useState(true)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg/70 p-4 sm:items-center" role="dialog" aria-labelledby="set-scene-title">
      <div className="w-full max-w-md rounded-xl border border-line bg-panel p-4 shadow-xl">
        <h2 id="set-scene-title" className="font-display text-xl text-gold-2">
          Set scene
        </h2>
        <p className="mt-1 text-sm text-muted">
          Show it on the table now. Save it to the campaign to pick which encounters it sits between, before the night starts.
        </p>
        <p className="mt-2 truncate text-xs text-muted">{file.name}</p>
        <div className="mt-3 grid gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Scene name" />
          <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption on the table" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={saveToCampaign} onChange={(e) => setSaveToCampaign(e.target.checked)} />
            Save to campaign (between encounters)
          </label>
          {saveToCampaign && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="grid gap-1 text-xs text-muted">
                After
                <select
                  className="h-10 rounded-md border border-line bg-bg px-2 text-sm text-ink"
                  value={afterTemplateId}
                  onChange={(e) => setAfterTemplateId(e.target.value)}
                >
                  <option value="">Start of night</option>
                  {ordered.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs text-muted">
                Before
                <select
                  className="h-10 rounded-md border border-line bg-bg px-2 text-sm text-ink"
                  value={beforeTemplateId}
                  onChange={(e) => setBeforeTemplateId(e.target.value)}
                >
                  <option value="">End of night</option>
                  {ordered.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {saveToCampaign && (
            <p className="text-xs text-muted">{stagePlacementLabel({ afterTemplateId, beforeTemplateId }, ordered)}</p>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              onConfirm({
                file,
                name: name.trim() || stem,
                caption,
                afterTemplateId,
                beforeTemplateId,
                saveToCampaign,
              })
            }
          >
            {busy ? 'Saving…' : saveToCampaign ? 'Save & show' : 'Show on table'}
          </Button>
        </div>
      </div>
    </div>
  )
}
