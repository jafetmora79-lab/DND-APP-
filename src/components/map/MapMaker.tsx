import { useEffect, useRef, useState } from 'react'
import { Ban, Footprints, ImagePlus, Move } from 'lucide-react'
import { MapBoard, type MapTool } from '@/components/map/MapBoard'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import type { BattleMap } from '@/lib/types'
import { clampGridDim, clampGridSize, DEFAULT_SCRATCH_CELL, FEET_PER_SQUARE, mapFeet, remapBlocked } from '@/lib/utils'

type Props = {
  map: BattleMap
  onChange: (map: BattleMap) => void
  onClose: () => void
  onDeleted: () => void
}

export function MapMaker({ map, onChange, onClose, onDeleted }: Props) {
  const [draft, setDraft] = useState(map)
  const [tool, setTool] = useState<MapTool>('block')
  const [msg, setMsg] = useState('')
  const saveTimer = useRef<number>(0)
  const pending = useRef<BattleMap>(map)

  useEffect(() => {
    return () => {
      window.clearTimeout(saveTimer.current)
      const current = pending.current
      void api.patchMap(current.id, {
        name: current.name,
        gridSize: current.gridSize,
        gridCols: current.gridCols,
        gridRows: current.gridRows,
        imageUrl: current.imageUrl,
        blocked: current.blocked,
      })
    }
  }, [])

  function apply(next: BattleMap) {
    pending.current = next
    setDraft(next)
    onChange(next)
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const current = pending.current
      api
        .patchMap(current.id, {
          name: current.name,
          gridSize: current.gridSize,
          gridCols: current.gridCols,
          gridRows: current.gridRows,
          imageUrl: current.imageUrl,
          blocked: current.blocked,
        })
        .catch((e: Error) => setMsg(e.message))
    }, 280)
  }

  function patch(partial: Partial<BattleMap>) {
    apply({ ...pending.current, ...partial })
  }

  async function flush() {
    window.clearTimeout(saveTimer.current)
    const current = pending.current
    try {
      await api.patchMap(current.id, {
        name: current.name,
        gridSize: current.gridSize,
        gridCols: current.gridCols,
        gridRows: current.gridRows,
        imageUrl: current.imageUrl,
        blocked: current.blocked,
      })
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save map')
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
      setMsg('Background image attached. Squares still sit on top at 5 ft each.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not upload background')
    }
  }

  async function clearBackground() {
    patch({ imageUrl: '' })
    setMsg('Background removed. The grid itself is the map.')
  }

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-[20rem_1fr]">
      <div className="rounded-xl border border-line bg-panel p-4">
        <button type="button" className="text-xs uppercase tracking-[0.3em] text-gold" onClick={() => flush().then(onClose)}>
          All maps
        </button>
        <h2 className="font-display text-xl text-gold-2">Map maker</h2>
        <p className="mt-1 text-xs text-muted">Each square is {FEET_PER_SQUARE} feet. Paint walls and pits so tokens cannot stop there.</p>
        <div className="mt-3 grid gap-3">
          <Field label="Name">
            <Input
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Squares wide">
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
            <Field label="Squares high">
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
          <Field label="Square size on screen (px)">
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
              <Move className="h-4 w-4" /> Pan
            </Button>
            <Button size="sm" variant={tool === 'block' ? 'default' : 'outline'} onClick={() => setTool('block')}>
              <Ban className="h-4 w-4" /> Block
            </Button>
            <Button size="sm" variant={tool === 'open' ? 'default' : 'outline'} onClick={() => setTool('open')}>
              <Footprints className="h-4 w-4" /> Walkable
            </Button>
          </div>
          <p className="text-xs text-muted">Blocked squares (red X) cannot be walked on. Use Walkable to clear them.</p>
          <div className="rounded-md border border-line p-2">
            <div className="flex items-center gap-2 text-sm">
              <ImagePlus className="h-4 w-4 text-gold" />
              Background picture
            </div>
            <p className="mt-1 text-xs text-muted">Optional scenery under the 5-ft grid. The picture is not the map.</p>
            <label className="mt-2 flex h-9 cursor-pointer items-center justify-center rounded-md border border-line text-xs hover:bg-panel-2">
              {draft.imageUrl ? 'Replace background' : 'Add background'}
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
              <Button size="sm" variant="ghost" className="mt-1 w-full" onClick={clearBackground}>
                Remove background
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                flush().then(onClose)
              }}
            >
              Done
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (!confirm('Delete this map? Encounters that use it will break.')) return
                api.deleteMap(draft.id).then(onDeleted)
              }}
            >
              Delete
            </Button>
          </div>
          {msg && <p className="text-xs text-moss">{msg}</p>}
        </div>
      </div>
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
    </div>
  )
}
