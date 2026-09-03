import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { useT } from '@/lib/i18n'

type Props = {
  imageUrl: string
  gridSize: number
  bgOffsetX: number
  bgOffsetY: number
  bgScale: number | null
  onApply: (next: { bgOffsetX: number; bgOffsetY: number; bgScale: number }) => void
  onClearAlignment: () => void
  onCancel: () => void
}

const PREVIEW_MAX = 640

/**
 * Lets a DM line up the app's grid with a pre-gridded map image instead of
 * having the image force-stretched to the grid. Two ways to calibrate:
 * drag a rectangle over one square of the image's own artwork (sets scale
 * from the measured square, and anchors it), then drag the image freely to
 * nudge the offset until every line matches — or type exact numbers.
 */
export function GridAlignTool({ imageUrl, gridSize, bgOffsetX, bgOffsetY, bgScale, onApply, onClearAlignment, onCancel }: Props) {
  const { t } = useT()
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [scale, setScale] = useState(bgScale ?? 1)
  const [offX, setOffX] = useState(bgOffsetX)
  const [offY, setOffY] = useState(bgOffsetY)
  const [measuring, setMeasuring] = useState(false)
  const [rect, setRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const dragStart = useRef<{ x: number; y: number; offX: number; offY: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (!cancelled) setNatural({ w: img.naturalWidth, h: img.naturalHeight })
    }
    img.src = imageUrl
    return () => {
      cancelled = true
    }
  }, [imageUrl])

  if (!natural) {
    return <p className="text-sm text-muted">{t('mapAlign.loading')}</p>
  }

  const displayScale = Math.min(1, PREVIEW_MAX / natural.w)
  const dispW = natural.w * displayScale
  const dispH = natural.h * displayScale
  const safeScale = scale > 0 ? scale : 1
  const cellPx = (gridSize / safeScale) * displayScale
  const bgPosX = (-offX / safeScale) * displayScale
  const bgPosY = (-offY / safeScale) * displayScale

  function localPoint(e: ReactPointerEvent) {
    const el = containerRef.current
    const r = el?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = localPoint(e)
    if (measuring) {
      setRect({ x1: p.x, y1: p.y, x2: p.x, y2: p.y })
      return
    }
    dragStart.current = { x: p.x, y: p.y, offX, offY }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const p = localPoint(e)
    if (measuring) {
      if (rect) setRect({ ...rect, x2: p.x, y2: p.y })
      return
    }
    const start = dragStart.current
    if (!start) return
    setOffX(start.offX + ((p.x - start.x) / displayScale) * safeScale)
    setOffY(start.offY + ((p.y - start.y) / displayScale) * safeScale)
  }

  function onPointerUp() {
    if (measuring && rect) {
      const wPx = Math.abs(rect.x2 - rect.x1) / displayScale
      const hPx = Math.abs(rect.y2 - rect.y1) / displayScale
      const measured = (wPx + hPx) / 2
      if (measured > 2) {
        const nextScale = gridSize / measured
        const topLeftX = Math.min(rect.x1, rect.x2) / displayScale
        const topLeftY = Math.min(rect.y1, rect.y2) / displayScale
        setScale(nextScale)
        setOffX(-topLeftX * nextScale)
        setOffY(-topLeftY * nextScale)
      }
      setMeasuring(false)
    }
    setRect(null)
    dragStart.current = null
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">{t('mapAlign.hint')}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={measuring ? 'default' : 'outline'} onClick={() => setMeasuring((m) => !m)}>
          {measuring ? t('mapAlign.measuring') : t('mapAlign.measureButton')}
        </Button>
      </div>
      <div
        ref={containerRef}
        className="relative touch-none select-none overflow-hidden rounded-md border border-line bg-[#0a0806]"
        style={{ width: dispW, height: dispH, cursor: measuring ? 'crosshair' : 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <img src={imageUrl} alt="" draggable={false} className="pointer-events-none block" style={{ width: dispW, height: dispH }} />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: [
              `repeating-linear-gradient(to right, rgba(255,244,214,0.85) 0, rgba(255,244,214,0.85) 1px, transparent 1px, transparent ${cellPx}px)`,
              `repeating-linear-gradient(to bottom, rgba(255,244,214,0.85) 0, rgba(255,244,214,0.85) 1px, transparent 1px, transparent ${cellPx}px)`,
            ].join(', '),
            backgroundPosition: `${bgPosX}px ${bgPosY}px`,
          }}
        />
        {rect && (
          <div
            className="pointer-events-none absolute border-2 border-gold bg-gold/20"
            style={{
              left: Math.min(rect.x1, rect.x2),
              top: Math.min(rect.y1, rect.y2),
              width: Math.abs(rect.x2 - rect.x1),
              height: Math.abs(rect.y2 - rect.y1),
            }}
          />
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label={t('mapAlign.scalePercent')}>
          <Input
            type="number"
            min={5}
            step={0.5}
            value={Math.round(safeScale * 1000) / 10}
            onChange={(e) => setScale(Math.max(0.05, Number(e.target.value) / 100))}
          />
        </Field>
        <Field label={t('mapAlign.offsetX')}>
          <Input type="number" value={Math.round(offX)} onChange={(e) => setOffX(Number(e.target.value) || 0)} />
        </Field>
        <Field label={t('mapAlign.offsetY')}>
          <Input type="number" value={Math.round(offY)} onChange={(e) => setOffY(Number(e.target.value) || 0)} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => onApply({ bgOffsetX: offX, bgOffsetY: offY, bgScale: safeScale })}>{t('mapAlign.apply')}</Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('mapAlign.cancel')}
        </Button>
        <Button variant="ghost" onClick={onClearAlignment}>
          {t('mapAlign.clear')}
        </Button>
      </div>
    </div>
  )
}
