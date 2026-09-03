import { useEffect, useRef, useState } from 'react'
import { Ban, Box, CircleDot, Crosshair, Droplets, Flame, Footprints, ImagePlus, Move, Snowflake, TreePine } from 'lucide-react'
import { GridAlignTool } from '@/components/map/GridAlignTool'
import { MapBoard, type MapTool } from '@/components/map/MapBoard'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { useT } from '@/lib/i18n'
import type { BattleMap } from '@/lib/types'
import { clampGridDim, clampGridSize, DEFAULT_SCRATCH_CELL, mapFeet, remapBlocked } from '@/lib/utils'

type Props = {
  map: BattleMap
  onChange: (map: BattleMap) => void
  onClose: () => void
  onDeleted: () => void
}

export function MapMaker({ map, onChange, onClose, onDeleted }: Props) {
  const { t } = useT()
  const [draft, setDraft] = useState(map)
  const [tool, setTool] = useState<MapTool>('block')
  const [aligning, setAligning] = useState(false)
  const [msg, setMsg] = useState('')
  const saveTimer = useRef<number>(0)
  const pending = useRef<BattleMap>(map)

  function patchPayload(current: BattleMap) {
    return {
      name: current.name,
      gridSize: current.gridSize,
      gridCols: current.gridCols,
      gridRows: current.gridRows,
      imageUrl: current.imageUrl,
      blocked: current.blocked,
      bgScale: current.bgScale,
      bgOffsetX: current.bgOffsetX,
      bgOffsetY: current.bgOffsetY,
    }
  }

  useEffect(() => {
    return () => {
      window.clearTimeout(saveTimer.current)
      void api.patchMap(pending.current.id, patchPayload(pending.current))
    }
  }, [])

  function apply(next: BattleMap) {
    pending.current = next
    setDraft(next)
    onChange(next)
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const current = pending.current
      api.patchMap(current.id, patchPayload(current)).catch((e: Error) => setMsg(e.message))
    }, 280)
  }

  function patch(partial: Partial<BattleMap>) {
    apply({ ...pending.current, ...partial })
  }

  async function flush() {
    window.clearTimeout(saveTimer.current)
    const current = pending.current
    try {
      await api.patchMap(current.id, patchPayload(current))
      setMsg(t('mapMaker.savedMsg'))
    } catch (e) {
      const text = e instanceof Error ? e.message : t('mapMaker.errSave')
      setMsg(text)
      throw e instanceof Error ? e : new Error(text)
    }
  }

  async function attachBackground(file: File) {
    try {
      await flush()
      const r = await api.uploadMapImage(pending.current.id, file)
      if (r.map) {
        const next = { ...r.map, blocked: pending.current.blocked, name: pending.current.name }
        pending.current = next
        setDraft(next)
        onChange(next)
      }
      setMsg(t('mapMaker.backgroundAttachedMsg'))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('mapMaker.errUpload'))
    }
  }

  async function clearBackground() {
    patch({ imageUrl: '' })
    setMsg(t('mapMaker.backgroundRemovedMsg'))
  }

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-[20rem_1fr]">
      <div className="rounded-xl border border-line bg-panel p-4">
        <button type="button" className="text-xs uppercase tracking-[0.3em] text-gold" onClick={() => flush().then(onClose).catch(() => undefined)}>
          {t('mapMaker.allMaps')}
        </button>
        <h2 className="font-display text-xl text-gold-2">{t('mapMaker.title')}</h2>
        <p className="mt-1 text-xs text-muted">{t('map.maker.blurb')}</p>
        <div className="mt-3 grid gap-3">
          <Field label={t('common.name')}>
            <Input
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('field.squaresWide')}>
              <Input
                type="number"
                min={1}
                max={80}
                value={draft.gridCols}
                onChange={(e) => {
                  const current = pending.current
                  const gridCols = clampGridDim(e.target.value, current.gridCols)
                  const blocked = remapBlocked(current.blocked, current.gridCols, current.gridRows, gridCols, current.gridRows)
                  apply({ ...current, gridCols, blocked })
                }}
              />
            </Field>
            <Field label={t('field.squaresHigh')}>
              <Input
                type="number"
                min={1}
                max={80}
                value={draft.gridRows}
                onChange={(e) => {
                  const current = pending.current
                  const gridRows = clampGridDim(e.target.value, current.gridRows)
                  const blocked = remapBlocked(current.blocked, current.gridCols, current.gridRows, current.gridCols, gridRows)
                  apply({ ...current, gridRows, blocked })
                }}
              />
            </Field>
          </div>
          <p className="text-sm text-gold">
            {mapFeet(draft.gridCols, draft.gridRows)}
          </p>
          <Field label={t('mapMaker.squareSizePx')}>
            <Input
              type="number"
              min={16}
              max={128}
              value={draft.gridSize}
              onChange={(e) => {
                const gridSize = clampGridSize(e.target.value, DEFAULT_SCRATCH_CELL)
                patch({ gridSize })
              }}
            />
          </Field>
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant={tool === 'select' ? 'default' : 'outline'} onClick={() => setTool('select')}>
              <Move className="h-4 w-4" /> {t('mapMaker.pan')}
            </Button>
            <Button size="sm" variant={tool === 'open' ? 'default' : 'outline'} onClick={() => setTool('open')}>
              <Footprints className="h-4 w-4" /> {t('map.terrain.open')}
            </Button>
            <Button size="sm" variant={tool === 'block' ? 'default' : 'outline'} onClick={() => setTool('block')}>
              <Ban className="h-4 w-4" /> {t('map.terrain.wall')}
            </Button>
            <Button size="sm" variant={tool === 'hole' ? 'default' : 'outline'} onClick={() => setTool('hole')}>
              <CircleDot className="h-4 w-4" /> {t('map.terrain.hole')}
            </Button>
            <Button size="sm" variant={tool === 'difficult' ? 'default' : 'outline'} onClick={() => setTool('difficult')}>
              {t('map.terrain.difficult')}
            </Button>
            <Button size="sm" variant={tool === 'slippery' ? 'default' : 'outline'} onClick={() => setTool('slippery')}>
              <Snowflake className="h-4 w-4" /> {t('map.terrain.slippery')}
            </Button>
            <Button size="sm" variant={tool === 'fire' ? 'default' : 'outline'} onClick={() => setTool('fire')}>
              <Flame className="h-4 w-4" /> {t('map.terrain.fire')}
            </Button>
            <Button size="sm" variant={tool === 'water' ? 'default' : 'outline'} onClick={() => setTool('water')}>
              <Droplets className="h-4 w-4" /> {t('map.terrain.water')}
            </Button>
            <Button size="sm" variant={tool === 'half-cover' ? 'default' : 'outline'} onClick={() => setTool('half-cover')}>
              <TreePine className="h-4 w-4" /> {t('map.terrain.halfCover')}
            </Button>
            <Button size="sm" variant={tool === 'three-quarter-cover' ? 'default' : 'outline'} onClick={() => setTool('three-quarter-cover')}>
              <Box className="h-4 w-4" /> {t('map.terrain.threeQuarterCover')}
            </Button>
          </div>
          <p className="text-xs text-muted">
            {t('mapMaker.terrainLegend')}
          </p>
          <div className="rounded-md border border-line p-2">
            <div className="flex items-center gap-2 text-sm">
              <ImagePlus className="h-4 w-4 text-gold" />
              {t('mapMaker.backgroundPicture')}
            </div>
            <p className="mt-1 text-xs text-muted">{t('mapMaker.backgroundPictureHint')}</p>
            <label className="mt-2 flex h-9 cursor-pointer items-center justify-center rounded-md border border-line text-xs hover:bg-panel-2">
              {draft.imageUrl ? t('mapMaker.replaceBackground') : t('mapMaker.addBackground')}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) attachBackground(f)
                  e.target.value = ''
                }}
              />
            </label>
            {draft.imageUrl ? (
              <>
                <Button size="sm" variant="ghost" className="mt-1 w-full" onClick={clearBackground}>
                  {t('mapMaker.removeBackground')}
                </Button>
                <Button size="sm" variant={aligning ? 'default' : 'outline'} className="mt-1 w-full" onClick={() => setAligning((v) => !v)}>
                  <Crosshair className="h-4 w-4" /> {t('mapAlign.openButton')}
                </Button>
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                flush().catch(() => undefined)
              }}
            >
              {t('mapMaker.saveMap')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                flush().then(onClose).catch(() => undefined)
              }}
            >
              {t('common.done')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (!confirm(t('mapMaker.confirmDelete'))) return
                api.deleteMap(draft.id).then(onDeleted)
              }}
            >
              {t('common.delete')}
            </Button>
          </div>
          {msg && <p className="text-xs text-moss">{msg}</p>}
        </div>
      </div>
      {aligning && draft.imageUrl ? (
        <div className="overflow-auto rounded-xl border border-line bg-bg p-4">
          <GridAlignTool
            imageUrl={draft.imageUrl}
            gridSize={draft.gridSize}
            bgOffsetX={draft.bgOffsetX}
            bgOffsetY={draft.bgOffsetY}
            bgScale={draft.bgScale}
            onApply={(next) => {
              patch(next)
              setAligning(false)
              setMsg(t('mapAlign.appliedMsg'))
            }}
            onClearAlignment={() => {
              patch({ bgScale: null, bgOffsetX: 0, bgOffsetY: 0 })
              setAligning(false)
              setMsg(t('mapAlign.clearedMsg'))
            }}
            onCancel={() => setAligning(false)}
          />
        </div>
      ) : (
        <div className="h-[32rem] overflow-hidden rounded-xl border border-line bg-bg lg:h-[40rem]">
          <MapBoard
            map={draft}
            tokens={[]}
            fog={{ cols: draft.gridCols, rows: draft.gridRows, enabled: false, revealed: [] }}
            isDm
            tool={tool}
            onBlocked={(blocked) => {
              const next = { ...pending.current, blocked }
              apply(next)
            }}
          />
        </div>
      )}
    </div>
  )
}
