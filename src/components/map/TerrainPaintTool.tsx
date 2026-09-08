import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type TextureId = 'grass' | 'dirt' | 'sand' | 'stone' | 'water' | 'snow'

const TEXTURE_IDS: TextureId[] = ['grass', 'dirt', 'sand', 'stone', 'water', 'snow']

const TEXTURE_SWATCH: Record<TextureId, string> = {
  grass: '#3f6b2f',
  dirt: '#6b4a2f',
  sand: '#c9b077',
  stone: '#7a7a7c',
  water: '#3a6f9a',
  snow: '#e8edf2',
}

const BRUSH_SIZES = [18, 34, 60] as const
const PREVIEW_MAX = 720

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}

/** One "dab" of a texture at (x,y) inside a brush of radius r. Called many times per stroke segment. */
function stampDab(ctx: CanvasRenderingContext2D, texture: TextureId, x: number, y: number, r: number) {
  const ox = x + rand(-r, r) * 0.85
  const oy = y + rand(-r, r) * 0.85
  switch (texture) {
    case 'grass': {
      const len = rand(r * 0.3, r * 0.7)
      const angle = rand(0, Math.PI * 2)
      const shade = Math.round(rand(70, 130))
      ctx.strokeStyle = `rgba(${Math.round(shade * 0.5)}, ${shade}, ${Math.round(shade * 0.4)}, 0.85)`
      ctx.lineWidth = Math.max(1, r * 0.08)
      ctx.beginPath()
      ctx.moveTo(ox, oy)
      ctx.quadraticCurveTo(ox + Math.cos(angle) * len * 0.5, oy + Math.sin(angle) * len * 0.5 - len * 0.3, ox + Math.cos(angle) * len, oy + Math.sin(angle) * len)
      ctx.stroke()
      break
    }
    case 'dirt': {
      const rr = rand(r * 0.12, r * 0.3)
      const shade = Math.round(rand(60, 110))
      ctx.fillStyle = `rgba(${shade}, ${Math.round(shade * 0.66)}, ${Math.round(shade * 0.4)}, 0.6)`
      ctx.beginPath()
      ctx.ellipse(ox, oy, rr, rr * rand(0.6, 1), rand(0, Math.PI), 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'sand': {
      const rr = rand(r * 0.04, r * 0.1)
      const shade = Math.round(rand(190, 230))
      ctx.fillStyle = `rgba(${shade}, ${Math.round(shade * 0.9)}, ${Math.round(shade * 0.65)}, 0.7)`
      ctx.beginPath()
      ctx.arc(ox, oy, rr, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'stone': {
      const rr = rand(r * 0.15, r * 0.35)
      const shade = Math.round(rand(90, 150))
      ctx.fillStyle = `rgba(${shade}, ${shade}, ${Math.round(shade * 1.02)}, 0.55)`
      ctx.save()
      ctx.translate(ox, oy)
      ctx.rotate(rand(0, Math.PI))
      ctx.beginPath()
      ctx.moveTo(-rr, -rr * 0.5)
      ctx.lineTo(rr, -rr * 0.6)
      ctx.lineTo(rr * 0.7, rr)
      ctx.lineTo(-rr * 0.8, rr * 0.6)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
      break
    }
    case 'water': {
      const len = rand(r * 0.4, r * 0.9)
      const shade = Math.round(rand(90, 160))
      ctx.strokeStyle = `rgba(${Math.round(shade * 0.5)}, ${Math.round(shade * 0.8)}, ${shade}, 0.55)`
      ctx.lineWidth = Math.max(1, r * 0.06)
      ctx.beginPath()
      ctx.moveTo(ox - len / 2, oy)
      ctx.quadraticCurveTo(ox, oy - len * 0.35, ox + len / 2, oy)
      ctx.stroke()
      break
    }
    case 'snow': {
      const rr = rand(r * 0.08, r * 0.2)
      ctx.fillStyle = `rgba(255, 255, 255, ${rand(0.3, 0.6)})`
      ctx.beginPath()
      ctx.arc(ox, oy, rr, 0, Math.PI * 2)
      ctx.fill()
      break
    }
  }
}

function baseTint(texture: TextureId) {
  switch (texture) {
    case 'grass':
      return 'rgba(60, 96, 44, 0.16)'
    case 'dirt':
      return 'rgba(96, 68, 42, 0.16)'
    case 'sand':
      return 'rgba(201, 176, 119, 0.18)'
    case 'stone':
      return 'rgba(110, 110, 114, 0.16)'
    case 'water':
      return 'rgba(58, 111, 154, 0.2)'
    case 'snow':
      return 'rgba(232, 237, 242, 0.22)'
  }
}

function paintAt(ctx: CanvasRenderingContext2D, texture: TextureId | 'eraser', x: number, y: number, r: number) {
  if (texture === 'eraser') {
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, 'rgba(0,0,0,1)')
    grad.addColorStop(0.7, 'rgba(0,0,0,0.9)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    return
  }
  ctx.fillStyle = baseTint(texture)
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  const dabCount = Math.max(2, Math.round(r / 6))
  for (let i = 0; i < dabCount; i++) stampDab(ctx, texture, x, y, r)
}

type Props = {
  worldW: number
  worldH: number
  backgroundImageUrl: string
  existingPaintUrl: string
  onApply: (blob: Blob) => void | Promise<void>
  onCancel: () => void
}

/**
 * Freehand ground-texture painting: an actual raster layer, unconstrained by the grid,
 * exported as a transparent PNG and stored as BattleMap.paintUrl. Rendered back in
 * MapBoard between the background image and the mechanical terrain overlay.
 */
export function TerrainPaintTool({ worldW, worldH, backgroundImageUrl, existingPaintUrl, onApply, onCancel }: Props) {
  const { t } = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [texture, setTexture] = useState<TextureId | 'eraser'>('grass')
  const [brushIdx, setBrushIdx] = useState(1)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const drawing = useRef(false)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)

  const displayScale = Math.min(1, PREVIEW_MAX / worldW)
  const dispW = worldW * displayScale
  const dispH = worldH * displayScale
  const brushR = BRUSH_SIZES[brushIdx]

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = worldW
    canvas.height = worldH
    if (!existingPaintUrl) {
      setLoaded(true)
      return
    }
    let cancelled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (cancelled) return
      const ctx = canvas.getContext('2d')
      ctx?.drawImage(img, 0, 0, worldW, worldH)
      setLoaded(true)
    }
    img.onerror = () => {
      if (!cancelled) setLoaded(true)
    }
    img.src = existingPaintUrl
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function canvasPoint(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    const r = canvas?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    return { x: (e.clientX - r.left) / displayScale, y: (e.clientY - r.top) / displayScale }
  }

  function strokeTo(p: { x: number; y: number }) {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const from = lastPoint.current ?? p
    const dist = Math.hypot(p.x - from.x, p.y - from.y)
    const step = Math.max(3, brushR / 4)
    const steps = Math.max(1, Math.round(dist / step))
    for (let i = 0; i <= steps; i++) {
      const x = from.x + ((p.x - from.x) * i) / steps
      const y = from.y + ((p.y - from.y) * i) / steps
      paintAt(ctx, texture, x, y, brushR)
    }
    lastPoint.current = p
  }

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    lastPoint.current = null
    strokeTo(canvasPoint(e))
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    strokeTo(canvasPoint(e))
  }

  function onPointerUp() {
    drawing.current = false
    lastPoint.current = null
  }

  function clearCanvas() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    if (!confirm(t('mapPaint.confirmClear'))) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  async function save() {
    const canvas = canvasRef.current
    if (!canvas) return
    setSaving(true)
    canvas.toBlob(async (blob) => {
      if (blob) await onApply(blob)
      setSaving(false)
    }, 'image/png')
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">{t('mapPaint.hint')}</p>
      <div className="flex flex-wrap gap-1.5">
        {TEXTURE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            title={t(`mapPaint.texture.${id}`)}
            onClick={() => setTexture(id)}
            className={cn(
              'flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs',
              texture === id ? 'border-gold bg-gold/10' : 'border-line hover:border-gold/40',
            )}
          >
            <span className="h-3.5 w-3.5 rounded-full border border-black/30" style={{ background: TEXTURE_SWATCH[id] }} />
            {t(`mapPaint.texture.${id}`)}
          </button>
        ))}
        <button
          type="button"
          title={t('mapPaint.eraser')}
          onClick={() => setTexture('eraser')}
          className={cn(
            'flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs',
            texture === 'eraser' ? 'border-gold bg-gold/10' : 'border-line hover:border-gold/40',
          )}
        >
          {t('mapPaint.eraser')}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-muted">{t('mapPaint.brushSize')}</span>
        {BRUSH_SIZES.map((size, i) => (
          <button
            key={size}
            type="button"
            onClick={() => setBrushIdx(i)}
            aria-label={t('mapPaint.brushSize')}
            className={cn('flex h-9 w-9 items-center justify-center rounded-md border', brushIdx === i ? 'border-gold bg-gold/10' : 'border-line hover:border-gold/40')}
          >
            <span className="rounded-full bg-ink/70" style={{ width: 6 + i * 6, height: 6 + i * 6 }} />
          </button>
        ))}
      </div>
      <div
        className="relative touch-none select-none overflow-hidden rounded-md border border-line bg-[#0a0806]"
        style={{ width: dispW, height: dispH }}
      >
        {backgroundImageUrl && (
          <img src={backgroundImageUrl} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-fill opacity-70" />
        )}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 cursor-crosshair"
          style={{ width: dispW, height: dispH, opacity: loaded ? 1 : 0 }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        />
        {!loaded && <div className="absolute inset-0 grid place-items-center text-xs text-muted">{t('mapPaint.loading')}</div>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={saving} onClick={save}>
          {t('mapPaint.save')}
        </Button>
        <Button variant="outline" onClick={clearCanvas}>
          {t('mapPaint.clearCanvas')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('mapAlign.cancel')}
        </Button>
      </div>
    </div>
  )
}
