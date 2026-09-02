import { useRef, useState, type ReactNode } from 'react'
import { Check, ChevronLeft, ChevronRight, ImagePlus, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AmbianceStage } from '@/components/AmbianceStage'
import { StartFightDialog } from '@/components/StartFightDialog'
import { CampaignHubPanel } from '@/components/CampaignHubPanel'
import { adjacentBeat, currentRunPointer, isCombatBeat, parseHub, remainingStartEncounters, sceneBeats, tableSceneBeat } from '@/lib/campaign-hub'
import { useT } from '@/lib/i18n'
import { templateReady } from '@/lib/token-look'
import { applyShortRestHp, type StartFightOpts } from '@/lib/turn-flow'
import type { CampaignHub, EncounterInstance, EncounterOutcome, EncounterTemplate, PlayerCharacter } from '@/lib/types'
import { cn } from '@/lib/utils'

type SceneCommit = {
  file: File
  name: string
  caption: string
  insertAfterBeatId: string
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
  onSelectScene?: (beatId: string) => void
  onStepScene?: (direction: -1 | 1) => void
  onHubChange?: (hub: CampaignHub) => void
  onUploadStage?: (file: File) => Promise<string>
  onStartCampaign?: () => void
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
  const { t } = useT()
  const fileRef = useRef<HTMLInputElement>(null)
  const [startTpl, setStartTpl] = useState<EncounterTemplate | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [restHp, setRestHp] = useState('')
  const [mobileTab, setMobileTab] = useState<'play' | 'order' | 'sheet'>(dm ? 'play' : 'sheet')
  const selected = characters.find((c) => c.id === selectedId)
  const parsedHub = parseHub(hub)
  const pointer = currentRunPointer(parsedHub)
  const scenes = sceneBeats(parsedHub)
  const startEncounters = dm ? remainingStartEncounters(parsedHub, dm.templates) : []
  const tableScene = tableSceneBeat(parsedHub)
  const prevBeat = adjacentBeat(parsedHub, -1)
  const nextBeat = adjacentBeat(parsedHub, 1)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden xl:flex-row">
      <div className={cn('relative w-full min-w-0', playerView ? 'h-[50vh] shrink-0 xl:h-auto xl:min-h-0 xl:flex-1' : 'h-[34vh] shrink-0 xl:h-auto xl:min-h-0 xl:flex-1')}>
        <AmbianceStage imageUrl={imageUrl} caption={caption} className="h-full min-h-0" />
        {lastOutcome && (
          <div
            className={cn(
              'absolute left-2 top-2 z-10 rounded-full px-3 py-1 text-xs uppercase tracking-wider',
              lastOutcome === 'won' ? 'bg-gold/20 text-gold-2' : 'bg-blood/20 text-blood',
            )}
          >
            {t('tableHub.lastFight')}: {lastOutcome === 'won' ? t('tableHub.victory') : t('tableHub.defeat')}
          </div>
        )}
        {dm && (
          <div className="absolute right-2 top-2 z-10 flex flex-wrap justify-end gap-2 xl:bottom-3 xl:top-auto">
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
            <Button size="sm" variant="outline" className="min-h-10" onClick={() => fileRef.current?.click()} disabled={dm.busy}>
              <ImagePlus className="h-4 w-4" />
              {dm.hasImage ? t('tableHub.changeScene') : t('tableHub.setScene')}
            </Button>
            {dm.hasImage && !tableScene?.imageUrl && (
              <Button size="sm" variant="ghost" className="min-h-10 bg-bg/70" disabled={dm.busy} onClick={dm.onClearImage}>
                {t('tableHub.useTavernScene')}
              </Button>
            )}
          </div>
        )}
      </div>

      <aside className="flex min-h-0 w-full flex-1 flex-col overflow-hidden border-t border-line bg-panel xl:w-[28rem] xl:flex-none xl:border-l xl:border-t-0">
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-panel-2/30 px-2 py-1 xl:hidden">
          {(dm ? (['play', 'order', 'sheet'] as const) : (['order', 'sheet'] as const)).map((tab) => (
            <button
              key={tab}
              type="button"
              className={cn('min-h-10 rounded px-3 py-1 text-sm capitalize transition-all', mobileTab === tab ? 'bg-gold text-bg' : 'text-muted hover:text-ink')}
              onClick={() => setMobileTab(tab)}
            >
              {tab === 'play' ? t('tableHub.play') : tab === 'order' ? (playerView ? t('tableHub.campaign') : t('prep.hubTitle')) : t('sheet.tab.sheet')}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className={cn('border-b border-line p-3', mobileTab === 'play' || (!dm && mobileTab === 'sheet') ? 'block' : 'hidden xl:block')}>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-gold">{campaignName}</p>
          <h2 className="font-display text-xl text-gold-2">{dm ? t('tableHub.theTable') : t('tableHub.yourCharacter')}</h2>
          <p className="mt-1 text-sm text-muted">
            {dm
              ? t('tableHub.dmLiveBlurb')
              : t('tableHub.playerLiveBlurb')}
          </p>
          {dm && (
            <>
              {dm.onStartCampaign && parsedHub.beats.length > 0 && (
                <Button className="mt-3 min-h-10 w-full" size="sm" disabled={dm.busy} onClick={dm.onStartCampaign}>
                  {t('tableHub.showOpeningScene')}
                </Button>
              )}
              {dm.onStepScene && parsedHub.beats.length > 1 && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-10"
                    disabled={dm.busy || !prevBeat}
                    onClick={() => dm.onStepScene?.(-1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    {t('tableHub.previous')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-10"
                    disabled={dm.busy || !nextBeat}
                    onClick={() => dm.onStepScene?.(1)}
                  >
                    {t('tableHub.next')}
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
              {(pointer.now || pointer.next) && (
                <div className="mt-3 rounded-lg border border-line bg-panel/50 px-3 py-2 text-sm">
                  {pointer.now && (
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-muted">{t('campaignHub.now')}</span>
                      <div className="font-medium">{pointer.now.title}</div>
                    </div>
                  )}
                  {pointer.next && (
                    <div className={pointer.now ? 'mt-2' : ''}>
                      <span className="text-[10px] uppercase tracking-wider text-muted">{t('tableHub.nextOnlyYouSee')}</span>
                      <div>{isCombatBeat(pointer.next) ? t('tableHub.encounterName', { name: pointer.next.title }) : pointer.next.title}</div>
                    </div>
                  )}
                </div>
              )}
              {scenes.length > 0 && (
                <select
                  className="mt-3 h-10 min-h-10 w-full rounded-lg border border-line bg-panel/50 px-2 text-sm"
                  aria-label={t('tableHub.campaignScene')}
                  value={
                    scenes.find((s) => s.imageUrl === imageUrl || (!s.imageUrl && (s.caption === caption || s.title === caption) && !imageUrl))
                      ?.id ?? ''
                  }
                  onChange={(e) => dm.onSelectScene?.(e.target.value)}
                >
                  <option value="">{t('tableHub.jumpToScene')}</option>
                  {scenes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              )}
              <Input
                className="mt-3"
                placeholder={t('tableHub.sceneCaptionPlaceholder')}
                value={dm.caption}
                onChange={(e) => dm.onCaption(e.target.value)}
              />
            </>
          )}
        </div>

        {dm && (
          <div className={cn('border-b border-line p-3', mobileTab === 'play' ? 'block' : 'hidden xl:block')}>
            {dm.paused.length > 0 && (
              <section className="mb-4">
                <h3 className="text-xs uppercase tracking-wider text-muted">{t('tableHub.pausedFights')}</h3>
                <ul className="mt-2 space-y-2">
                  {dm.paused.map((i) => (
                    <li key={i.id} className="flex flex-col gap-2 rounded-lg border border-line bg-panel/50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="truncate">{i.name}</div>
                        <div className="text-xs text-muted">{i.roundNumber === 0 ? t('init.title') : t('tableHub.roundNumber', { round: i.roundNumber })}</div>
                      </div>
                      <Button size="sm" className="h-8 min-h-10 shrink-0 px-3 text-xs" disabled={dm.busy} onClick={() => dm.onResume(i.id)}>
                        <Play className="h-4 w-4" /> {t('tableHub.resume')}
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <h3 className="text-xs uppercase tracking-wider text-muted">{t('tableHub.startEncounter')}</h3>
            <ul className="mt-2 space-y-2">
              {startEncounters.map((row) => {
                const template = row.template
                const ready = template ? templateReady(template) : false
                const detail = template
                  ? templateReady(template)
                    ? [template.difficulty, template.objective, template.monsters.map((m) => `${m.quantity}× ${m.name}`).join(', ')].filter(Boolean).join(' · ')
                    : t('tableHub.draftFinishInPrep')
                  : row.templateId
                    ? t('tableHub.templateMissingPickInPrep')
                    : t('tableHub.noMapLinkedPickInPrep')
                const when = row.primary ? t('tableHub.nextInRun') : row.fromRun ? t('tableHub.laterInRun') : t('tableHub.savedInPrep')
                return (
                  <li
                    key={row.key}
                    className={cn(
                      'flex flex-col gap-2 rounded-lg border bg-panel/50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between',
                      row.primary ? 'border-gold/50' : 'border-line',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 truncate">
                        {ready && <Check className="h-4 w-4 shrink-0 text-moss" aria-label={t('tableHub.ready')} />}
                        <span className="truncate">{row.title}</span>
                      </div>
                      <div className="truncate text-xs text-muted">
                        {when}
                        {detail ? ` · ${detail}` : ''}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="h-8 min-h-10 shrink-0 px-3 text-xs"
                      variant={row.primary ? 'ember' : 'outline'}
                      disabled={dm.busy || !row.templateId || !template || !ready}
                      onClick={() => {
                        if (template) setStartTpl(template)
                      }}
                    >
                      {t('landing.start')}
                    </Button>
                  </li>
                )
              })}
              {startEncounters.length === 0 && dm.templates.length === 0 && (
                <li className="text-sm text-muted">{t('tableHub.buildEncounterEmpty')}</li>
              )}
              {startEncounters.length === 0 && dm.templates.length > 0 && (
                <li className="text-sm text-muted">{t('tableHub.everyEncounterDone')}</li>
              )}
            </ul>
          </div>
        )}

        {hub && (
          <div className={cn('border-b border-line p-3', mobileTab === 'order' ? 'block' : 'hidden xl:block')}>
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
        <div className={cn('p-3', mobileTab === 'sheet' ? 'block' : 'hidden xl:block')}>
          <div className="mb-2 flex gap-2 overflow-x-auto">
            {characters.map((c) => (
              <button
                key={c.id}
                type="button"
                className={cn(
                  'min-h-10 shrink-0 rounded-full border px-3 py-1 text-sm',
                  selectedId === c.id ? 'border-gold bg-gold text-bg' : 'border-line text-ink',
                )}
                onClick={() => onSelectCharacter(c.id)}
              >
                {c.name}
              </button>
            ))}
            {characters.length === 0 && <p className="text-sm text-muted">{t('tableHub.noCharactersYet')}</p>}
          </div>
          {selected && onShortRest && (
            <div className="mb-3 rounded-lg border border-line bg-panel/50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted">{t('tableHub.shortRestName', { name: selected.name })}</div>
              <p className="mt-1 text-xs text-muted">
                {t('tableHub.shortRestHint', { hitDice: selected.sheet.hitDice || t('tableHub.noneOnSheet') })}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input
                  className="h-8 w-20"
                  inputMode="numeric"
                  placeholder={t('player.hp')}
                  value={restHp}
                  onChange={(e) => setRestHp(e.target.value)}
                  aria-label={t('tableHub.hitDiceHpRecovered')}
                />
                <Button
                  size="sm"
                  className="h-8 px-3 text-xs"
                  disabled={dm?.busy || !restHp}
                  onClick={() => {
                    const n = Number(restHp)
                    if (!Number.isFinite(n) || n < 0) return
                    onShortRest(selected.id, applyShortRestHp(selected.sheet.hpCurrent, selected.sheet.hpMax, n))
                    setRestHp('')
                  }}
                >
                  {t('tableHub.applyHp')}
                </Button>
              </div>
            </div>
          )}
          {sheet}
        </div>
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
          beats={parsedHub.beats}
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
  beats,
  defaultCaption,
  busy,
  onCancel,
  onConfirm,
}: {
  file: File
  beats: { id: string; title: string }[]
  defaultCaption: string
  busy: boolean
  onCancel: () => void
  onConfirm: (scene: SceneCommit) => void
}) {
  const { t } = useT()
  const stem = file.name.replace(/\.[^.]+$/, '')
  const [name, setName] = useState(stem)
  const [caption, setCaption] = useState(defaultCaption || stem)
  const [insertAfterBeatId, setInsertAfterBeatId] = useState(beats.at(-1)?.id ?? '')
  const [saveToCampaign, setSaveToCampaign] = useState(true)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg/70 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center" role="dialog" aria-labelledby="set-scene-title">
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-xl border border-line bg-panel p-4 shadow-xl">
        <h2 id="set-scene-title" className="font-display text-xl text-gold-2">
          {t('tableHub.setScene')}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {t('tableHub.setSceneBlurb')}
        </p>
        <p className="mt-2 truncate text-xs text-muted">{file.name}</p>
        <div className="mt-3 grid gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('campaignHub.sceneName')} />
          <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder={t('campaignHub.captionOnTable')} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={saveToCampaign} onChange={(e) => setSaveToCampaign(e.target.checked)} />
            {t('tableHub.addToCampaignRunOrder')}
          </label>
          {saveToCampaign && (
            <label className="grid gap-1 text-xs text-muted">
              {t('tableHub.placeInRun')}
              <select
                className="h-10 rounded-md border border-line bg-bg px-2 text-sm text-ink"
                value={insertAfterBeatId}
                onChange={(e) => setInsertAfterBeatId(e.target.value)}
              >
                <option value="">{t('tableHub.startOfCampaign')}</option>
                {beats.map((b) => (
                  <option key={b.id} value={b.id}>
                    {t('tableHub.afterBeat', { title: b.title })}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t('tableHub.cancel')}
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              onConfirm({
                file,
                name: name.trim() || stem,
                caption,
                insertAfterBeatId,
                saveToCampaign,
              })
            }
          >
            {busy ? t('tableHub.saving') : saveToCampaign ? t('tableHub.saveAndShow') : t('tableHub.showOnTable')}
          </Button>
        </div>
      </div>
    </div>
  )
}
