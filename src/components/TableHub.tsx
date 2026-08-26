import { useRef, type ReactNode } from 'react'
import { Check, ImagePlus, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AmbianceStage } from '@/components/AmbianceStage'
import type { CampaignHub, EncounterInstance, EncounterOutcome, EncounterTemplate, PlayerCharacter } from '@/lib/types'
import { templateReady } from '@/lib/token-look'
import { sortTemplates } from '@/lib/campaign-hub'
import { CampaignHubPanel } from '@/components/CampaignHubPanel'
import { cn } from '@/lib/utils'

type DmProps = {
  caption: string
  onCaption: (value: string) => void
  onUpload: (file: File) => void
  onClearImage: () => void
  hasImage: boolean
  templates: EncounterTemplate[]
  paused: EncounterInstance[]
  onStart: (templateId: string) => void
  onResume: (instanceId: string) => void
  busy: boolean
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
  dm?: DmProps
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
  dm,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
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
                if (file) dm.onUpload(file)
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
              ? 'Talk, travel, and plan here. Start a fight when you are ready — the join code stays the same.'
              : 'This is the campaign table. Your sheet stays open while the party talks, travels, or waits on the next fight.'}
          </p>
          {dm && (
            <Input
              className="mt-3"
              placeholder="Scene caption — a tavern, a road, a council chamber…"
              value={dm.caption}
              onChange={(e) => dm.onCaption(e.target.value)}
            />
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
                        <div className="text-xs text-muted">Round {i.roundNumber}</div>
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
                  <Button size="sm" variant="ember" disabled={dm.busy} onClick={() => dm.onStart(t.id)}>
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
          <div className="max-h-64 overflow-y-auto border-b border-line p-3">
            <CampaignHubPanel hub={hub} characters={characters} templates={dm?.templates} canEdit={false} compact />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">{sheet}</div>
      </aside>
    </div>
  )
}
