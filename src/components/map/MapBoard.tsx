import { useEffect, useRef, useState } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import { Circle, Group, Layer, Rect, Shape, Stage, Text, Image as KImage } from 'react-konva'
import useImage from 'use-image'
import { conditionRingColor, type BattleMap, type FogState, type MapToken } from '@/lib/types'
import { tokenHiddenFromPlayers } from '@/lib/combat'
import { clampMapScale, fitMapView, touchDistance, zoomAtPoint } from '@/lib/map-view'
import { hpBarFill, initials, pixelToCell, TERRAIN, tokenOccupiesBlocked } from '@/lib/utils'
import { inkOnToken } from '@/lib/token-look'

export type MapTool =
  | 'select'
  | 'reveal'
  | 'hide'
  | 'block'
  | 'open'
  | 'hole'
  | 'difficult'
  | 'slippery'
  | 'fire'
  | 'water'
  | 'half-cover'
  | 'three-quarter-cover'

const TERRAIN_TOOL: Partial<Record<MapTool, number>> = {
  open: TERRAIN.OPEN,
  block: TERRAIN.WALL,
  hole: TERRAIN.HOLE,
  difficult: TERRAIN.DIFFICULT,
  slippery: TERRAIN.SLIPPERY,
  fire: TERRAIN.FIRE,
  water: TERRAIN.WATER,
  'half-cover': TERRAIN.HALF_COVER,
  'three-quarter-cover': TERRAIN.THREE_QUARTER_COVER,
}

type Props = {
  map: BattleMap
  tokens: MapToken[]
  fog: FogState
  isDm: boolean
  selectedId?: string | null
  highlightIds?: string[]
  tool?: MapTool
  onSelect?: (id: string | null) => void
  onMove?: (id: string, x: number, y: number) => void | Promise<void>
  onFog?: (fog: FogState) => void
  onBlocked?: (blocked: number[]) => void
  onCellClick?: (col: number, row: number) => void
  /** Combatant ids the current user may drag. DM can drag every token when onMove is set. */
  dragRefIds?: string[]
}

function MapImage({ url, width, height }: { url: string; width: number; height: number }) {
  const [img] = useImage(url, 'anonymous')
  if (!img) return null
  return <KImage image={img} width={width} height={height} listening={false} />
}

export function MapBoard({
  map,
  tokens,
  fog,
  isDm,
  selectedId,
  highlightIds = [],
  tool = 'select',
  onSelect,
  onMove,
  onFog,
  onBlocked,
  onCellClick,
  dragRefIds = [],
}: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const painting = useRef(false)
  const lastPaint = useRef(-1)
  const dragOrigin = useRef<Record<string, { x: number; y: number }>>({})
  const pointerDown = useRef<{ x: number; y: number } | null>(null)
  const userZoomed = useRef(false)
  const pinch = useRef<{ dist: number; scale: number; pos: { x: number; y: number } } | null>(null)

  const worldW = map.gridCols * map.gridSize
  const worldH = map.gridRows * map.gridSize
  const blocked = map.blocked ?? []
  const paintingTerrain = Boolean(TERRAIN_TOOL[tool] != null || tool === 'open' || tool === 'block')
  const paintingFog = tool === 'reveal' || tool === 'hide'


  function applyView(next: { scale: number; x: number; y: number }) {
    setScale(next.scale)
    setPos({ x: next.x, y: next.y })
  }

  function fitNow() {
    if (size.w < 8 || size.h < 8) return
    userZoomed.current = false
    const view = fitMapView(size.w, size.h, worldW, worldH)
    setScale(view.scale)
    setPos({ x: view.x, y: view.y })
  }

  function zoomBy(factor: number, point?: { x: number; y: number }) {
    if (size.w < 8 || size.h < 8) return
    userZoomed.current = true
    const origin = point ?? { x: size.w / 2, y: size.h / 2 }
    const next = clampMapScale(scale * factor, size.w, size.h, worldW, worldH)
    applyView(zoomAtPoint(scale, next, pos, origin))
  }

  function stagePointFromTouches(touches: TouchList) {
    const el = wrap.current
    if (!el || touches.length === 0) return null
    const rect = el.getBoundingClientRect()
    const n = Math.min(touches.length, 2)
    let x = 0
    let y = 0
    for (let i = 0; i < n; i++) {
      x += touches[i].clientX - rect.left
      y += touches[i].clientY - rect.top
    }
    return { x: x / n, y: y / n }
  }

  useEffect(() => {
    userZoomed.current = false
  }, [map.id, worldW, worldH])

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    const blockPinchScroll = (ev: TouchEvent) => {
      if (ev.touches.length >= 2) ev.preventDefault()
    }
    const blockWheelZoom = (ev: WheelEvent) => ev.preventDefault()
    el.addEventListener('touchmove', blockPinchScroll, { passive: false })
    el.addEventListener('wheel', blockWheelZoom, { passive: false })
    return () => {
      ro.disconnect()
      el.removeEventListener('touchmove', blockPinchScroll)
      el.removeEventListener('wheel', blockWheelZoom)
    }
  }, [])

  useEffect(() => {
    if (size.w < 8 || size.h < 8) return
    if (userZoomed.current) {
      setScale((s) => clampMapScale(s, size.w, size.h, worldW, worldH))
      return
    }
    const view = fitMapView(size.w, size.h, worldW, worldH)
    setScale(view.scale)
    setPos({ x: view.x, y: view.y })
  }, [size.w, size.h, worldW, worldH, map.id])

  function cellAt(x: number, y: number) {
    const c = Math.floor(x / map.gridSize)
    const r = Math.floor(y / map.gridSize)
    if (c < 0 || r < 0 || c >= map.gridCols || r >= map.gridRows) return -1
    return r * map.gridCols + c
  }

  function worldFromEvent(e: { target: { getStage: () => { getPointerPosition: () => { x: number; y: number } | null } | null } }) {
    const p = e.target.getStage()?.getPointerPosition()
    if (!p) return null
    return { x: (p.x - pos.x) / scale, y: (p.y - pos.y) / scale }
  }

  function paintFog(x: number, y: number) {
    if (!isDm || !fog.enabled || !paintingFog || !onFog) return
    const i = cellAt(x, y)
    if (i < 0) return
    const next = fog.revealed.slice()
    if (next.length !== fog.cols * fog.rows) {
      next.length = fog.cols * fog.rows
      next.fill(fog.enabled ? 0 : 1)
    }
    next[i] = tool === 'reveal' ? 1 : 0
    onFog({ ...fog, revealed: next })
  }

  function paintTerrain(x: number, y: number) {
    if (!isDm || !paintingTerrain || !onBlocked) return
    const i = cellAt(x, y)
    if (i < 0 || i === lastPaint.current) return
    lastPaint.current = i
    const next = blocked.slice()
    if (next.length !== map.gridCols * map.gridRows) {
      next.length = map.gridCols * map.gridRows
      next.fill(0)
    }
    next[i] = TERRAIN_TOOL[tool] ?? 0
    onBlocked(next)
  }

  function paintAt(x: number, y: number) {
    if (paintingFog) paintFog(x, y)
    if (paintingTerrain) paintTerrain(x, y)
  }

  return (
    <div ref={wrap} className="relative h-full min-h-0 w-full touch-none overflow-hidden bg-[#0a0806]">
      <Stage
        width={Math.max(1, size.w)}
        height={Math.max(1, size.h)}
        scaleX={scale}
        scaleY={scale}
        x={pos.x}
        y={pos.y}
        draggable={tool === 'select'}
        onDragStart={(e) => {
          if (pinch.current && e.target === e.target.getStage()) e.target.stopDrag()
        }}
        onDragEnd={(e) => {
          if (e.target === e.target.getStage()) setPos({ x: e.target.x(), y: e.target.y() })
        }}
        onWheel={(e) => {
          e.evt.preventDefault()
          const old = scale
          const factor = e.evt.deltaY > 0 ? 0.92 : 1.08
          const next = clampMapScale(old * factor, size.w, size.h, worldW, worldH)
          const ptr = e.target.getStage()?.getPointerPosition()
          userZoomed.current = true
          if (!ptr) {
            applyView({ scale: next, x: pos.x, y: pos.y })
            return
          }
          applyView(zoomAtPoint(old, next, pos, ptr))
        }}
        onMouseDown={(e) => {
          const ptr = e.target.getStage()?.getPointerPosition()
          pointerDown.current = ptr ? { x: ptr.x, y: ptr.y } : null
          if (paintingFog || paintingTerrain) {
            painting.current = true
            lastPaint.current = -1
            const w = worldFromEvent(e)
            if (w) paintAt(w.x, w.y)
            return
          }
          if (e.target.findAncestor('.token')) return
          const cls = e.target.getClassName()
          if (cls === 'Circle' || cls === 'Text' || cls === 'Group') return
          if (tool === 'select' && !onCellClick) onSelect?.(null)
        }}
        onTouchStart={(e) => {
          if (e.evt.touches.length >= 2) {
            painting.current = false
            const dist = touchDistance(e.evt.touches[0], e.evt.touches[1])
            pinch.current = { dist, scale, pos: { ...pos } }
            const stage = e.target.getStage()
            if (stage && stage.isDragging()) stage.stopDrag()
            return
          }
          pinch.current = null
          if (!(paintingFog || paintingTerrain)) return
          painting.current = true
          lastPaint.current = -1
          const w = worldFromEvent(e)
          if (w) paintAt(w.x, w.y)
        }}
        onClick={(e) => {
          if (!onCellClick || tool !== 'select') return
          if (e.target.findAncestor('.token')) return
          const cls = e.target.getClassName()
          if (cls === 'Circle' || cls === 'Text' || cls === 'Group') return
          const ptr = e.target.getStage()?.getPointerPosition()
          const start = pointerDown.current
          if (start && ptr && Math.hypot(ptr.x - start.x, ptr.y - start.y) > 6) return
          const w = worldFromEvent(e)
          if (!w) return
          const col = Math.floor(w.x / map.gridSize)
          const row = Math.floor(w.y / map.gridSize)
          if (col < 0 || row < 0 || col >= map.gridCols || row >= map.gridRows) return
          onCellClick(col, row)
        }}
        onMouseMove={(e) => {
          if (!painting.current) return
          const w = worldFromEvent(e)
          if (w) paintAt(w.x, w.y)
        }}
        onTouchMove={(e) => {
          if (e.evt.touches.length >= 2) {
            e.evt.preventDefault()
            painting.current = false
            const a = e.evt.touches[0]
            const b = e.evt.touches[1]
            const dist = touchDistance(a, b)
            const start = pinch.current
            const center = stagePointFromTouches(e.evt.touches)
            if (dist < 8 || !center) return
            if (!start) {
              pinch.current = { dist, scale, pos: { ...pos } }
              return
            }
            userZoomed.current = true
            const next = clampMapScale(start.scale * (dist / start.dist), size.w, size.h, worldW, worldH)
            applyView(zoomAtPoint(start.scale, next, start.pos, center))
            return
          }
          if (!painting.current) return
          const w = worldFromEvent(e)
          if (w) paintAt(w.x, w.y)
        }}
        onMouseUp={() => {
          painting.current = false
          lastPaint.current = -1
        }}
        onTouchEnd={(e) => {
          if (e.evt.touches.length < 2) pinch.current = null
          painting.current = false
          lastPaint.current = -1
        }}
        onMouseLeave={() => {
          painting.current = false
          lastPaint.current = -1
        }}
      >
        <Layer>
          <Rect x={0} y={0} width={worldW} height={worldH} fill="#16110c" listening={paintingFog || paintingTerrain} />
          {map.imageUrl ? <MapImage url={map.imageUrl} width={worldW} height={worldH} /> : null}
          <Shape
            listening={false}
            width={worldW}
            height={worldH}
            sceneFunc={(ctx, shape) => {
              const g = map.gridSize
              for (let i = 0; i < blocked.length; i++) {
                const code = blocked[i]
                if (!code) continue
                const c = i % map.gridCols
                const r = Math.floor(i / map.gridCols)
                const x = c * g
                const y = r * g
                if (code === TERRAIN.WALL) {
                  ctx.fillStyle = 'rgba(96, 28, 22, 0.48)'
                  ctx.strokeStyle = 'rgba(196, 69, 60, 0.85)'
                  ctx.lineWidth = 1.5
                  ctx.fillRect(x, y, g, g)
                  ctx.beginPath()
                  ctx.moveTo(x + 5, y + 5)
                  ctx.lineTo(x + g - 5, y + g - 5)
                  ctx.moveTo(x + g - 5, y + 5)
                  ctx.lineTo(x + 5, y + g - 5)
                  ctx.stroke()
                } else if (code === TERRAIN.HOLE) {
                  ctx.fillStyle = 'rgba(8, 6, 4, 0.82)'
                  ctx.fillRect(x, y, g, g)
                  ctx.strokeStyle = 'rgba(40, 32, 24, 0.95)'
                  ctx.lineWidth = 2
                  ctx.strokeRect(x + 4, y + 4, g - 8, g - 8)
                } else if (code === TERRAIN.DIFFICULT) {
                  ctx.fillStyle = 'rgba(120, 78, 32, 0.32)'
                  ctx.fillRect(x, y, g, g)
                  ctx.fillStyle = 'rgba(90, 58, 24, 0.55)'
                  for (let d = 8; d < g; d += 10) {
                    ctx.fillRect(x + d, y + 6, 3, g - 12)
                  }
                } else if (code === TERRAIN.SLIPPERY) {
                  ctx.fillStyle = 'rgba(160, 210, 230, 0.28)'
                  ctx.fillRect(x, y, g, g)
                  ctx.strokeStyle = 'rgba(200, 230, 245, 0.7)'
                  ctx.lineWidth = 1
                  ctx.beginPath()
                  ctx.moveTo(x + 6, y + g - 8)
                  ctx.lineTo(x + g - 8, y + 6)
                  ctx.stroke()
                } else if (code === TERRAIN.FIRE) {
                  ctx.fillStyle = 'rgba(196, 69, 60, 0.28)'
                  ctx.fillRect(x, y, g, g)
                  ctx.fillStyle = 'rgba(232, 140, 48, 0.7)'
                  ctx.beginPath()
                  ctx.moveTo(x + g / 2, y + 8)
                  ctx.lineTo(x + g - 10, y + g - 10)
                  ctx.lineTo(x + 10, y + g - 10)
                  ctx.closePath()
                  ctx.fill()
                } else if (code === TERRAIN.WATER) {
                  ctx.fillStyle = 'rgba(56, 110, 168, 0.32)'
                  ctx.fillRect(x, y, g, g)
                  ctx.strokeStyle = 'rgba(120, 170, 220, 0.75)'
                  ctx.lineWidth = 1.25
                  ctx.beginPath()
                  ctx.moveTo(x + 6, y + g / 2)
                  ctx.quadraticCurveTo(x + g / 2, y + g / 2 - 6, x + g - 6, y + g / 2)
                  ctx.stroke()
                } else if (code === TERRAIN.HALF_COVER) {
                  ctx.fillStyle = 'rgba(46, 92, 46, 0.28)'
                  ctx.fillRect(x, y, g, g)
                  ctx.fillStyle = 'rgba(90, 58, 24, 0.85)'
                  ctx.fillRect(x + g / 2 - 3, y + g - 18, 6, 14)
                  ctx.fillStyle = 'rgba(62, 130, 62, 0.82)'
                  ctx.beginPath()
                  ctx.arc(x + g / 2, y + g / 2 - 4, Math.max(8, g * 0.28), 0, Math.PI * 2)
                  ctx.fill()
                } else if (code === TERRAIN.THREE_QUARTER_COVER) {
                  ctx.fillStyle = 'rgba(90, 62, 36, 0.34)'
                  ctx.fillRect(x, y, g, g)
                  ctx.fillStyle = 'rgba(120, 82, 42, 0.88)'
                  ctx.fillRect(x + 8, y + g / 2 - 2, g / 2, g / 2 - 8)
                  ctx.fillStyle = 'rgba(158, 108, 54, 0.92)'
                  ctx.fillRect(x + g / 2 - 8, y + 10, g / 2 - 2, g / 2)
                  ctx.strokeStyle = 'rgba(40, 24, 12, 0.7)'
                  ctx.lineWidth = 1
                  ctx.strokeRect(x + 8, y + g / 2 - 2, g / 2, g / 2 - 8)
                  ctx.strokeRect(x + g / 2 - 8, y + 10, g / 2 - 2, g / 2)
                }
              }
              ctx.fillStrokeShape(shape)
            }}
          />
        </Layer>
        <Layer listening={false}>
          {fog.enabled && (
            <Shape
              sceneFunc={(ctx, shape) => {
                ctx.fillStyle = isDm ? 'rgba(8,6,4,0.62)' : '#070504'
                const revealed = fog.revealed
                for (let r = 0; r < fog.rows; r++) {
                  for (let c = 0; c < fog.cols; c++) {
                    const i = r * fog.cols + c
                    if (!revealed[i]) ctx.fillRect(c * map.gridSize, r * map.gridSize, map.gridSize, map.gridSize)
                  }
                }
                ctx.fillStrokeShape(shape)
              }}
              width={worldW}
              height={worldH}
            />
          )}
          <Shape
            listening={false}
            width={worldW}
            height={worldH}
            sceneFunc={(ctx, shape) => {
              const trace = () => {
                ctx.beginPath()
                for (let x = 0; x <= map.gridCols; x++) {
                  const px = x * map.gridSize + 0.5
                  ctx.moveTo(px, 0)
                  ctx.lineTo(px, worldH)
                }
                for (let y = 0; y <= map.gridRows; y++) {
                  const py = y * map.gridSize + 0.5
                  ctx.moveTo(0, py)
                  ctx.lineTo(worldW, py)
                }
              }
              ctx.strokeStyle = 'rgba(8, 6, 4, 0.92)'
              ctx.lineWidth = 3
              ctx.lineCap = 'square'
              trace()
              ctx.stroke()
              ctx.strokeStyle = 'rgba(255, 244, 214, 0.95)'
              ctx.lineWidth = 1.25
              trace()
              ctx.stroke()
              ctx.fillStrokeShape(shape)
            }}
          />
        </Layer>
        <Layer>
          {tokens.map((t) => {
            const r = (t.sizeSquares * map.gridSize) / 2 - 4
            if (tokenHiddenFromPlayers(t, fog, map.gridSize, isDm)) return null
            const selected = selectedId === t.refId
            const highlighted = highlightIds.includes(t.refId)
            const hpMax = t.hpMax ?? 0
            const hpCurrent = t.hpCurrent ?? hpMax
            const barW = Math.max(28, r * 1.8)
            const ratio = hpMax > 0 ? Math.max(0, Math.min(1, hpCurrent / hpMax)) : 0
            const rings = (t.conditions ?? []).slice(0, 4)
            const showHud = Boolean(t.label) || hpMax > 0 || t.ac != null
            const downed = Boolean(t.statusLabel) || (t.conditions ?? []).includes('Unconscious')
            const canDrag = Boolean(onMove) && tool === 'select' && (isDm || dragRefIds.includes(t.refId))
            return (
              <Group
                key={t.id}
                name="token"
                x={t.x}
                y={t.y}
                opacity={downed ? 0.82 : 1}
                listening={!paintingFog && !paintingTerrain}
                draggable={canDrag}
                onClick={() => onSelect?.(t.refId)}
                onTap={() => onSelect?.(t.refId)}
                onDragStart={() => {
                  dragOrigin.current[t.id] = { x: t.x, y: t.y }
                }}
                onDragEnd={async (e) => {
                  const gx = Math.round((e.target.x() - map.gridSize / 2) / map.gridSize) * map.gridSize + map.gridSize / 2
                  const gy = Math.round((e.target.y() - map.gridSize / 2) / map.gridSize) * map.gridSize + map.gridSize / 2
                  const { col, row } = pixelToCell(gx, gy, map.gridSize)
                  const origin = dragOrigin.current[t.id]
                  if (tokenOccupiesBlocked(blocked, col, row, map.gridCols, map.gridRows, t.sizeSquares)) {
                    if (origin) e.target.position(origin)
                    return
                  }
                  e.target.position({ x: gx, y: gy })
                  try {
                    await onMove?.(t.id, gx, gy)
                  } catch {
                    if (origin) e.target.position(origin)
                  }
                }}
              >
                {showHud && (
                  <>
                    <Text
                      text={t.label || ''}
                      y={-r - 30}
                      width={Math.max(72, r * 3)}
                      offsetX={Math.max(72, r * 3) / 2}
                      align="center"
                      fontSize={11}
                      fontFamily="Cinzel"
                      fill="#d6b16a"
                      listening={false}
                    />
                    <Text
                      text={[hpMax > 0 ? `${hpCurrent}/${hpMax}` : '', t.ac != null ? `AC ${t.ac}` : '']
                        .filter(Boolean)
                        .join('  ')}
                      y={-r - 16}
                      width={Math.max(72, r * 3)}
                      offsetX={Math.max(72, r * 3) / 2}
                      align="center"
                      fontSize={9}
                      fontFamily="Inter"
                      fill="#e8ddc8"
                      listening={false}
                    />
                    {hpMax > 0 && (
                      <>
                        <Rect x={-barW / 2} y={-r - 7} width={barW} height={4} fill="#1a1410" cornerRadius={2} listening={false} />
                        <Rect
                          x={-barW / 2}
                          y={-r - 7}
                          width={barW * ratio}
                          height={4}
                          fill={hpBarFill(hpCurrent, hpMax)}
                          cornerRadius={2}
                          listening={false}
                        />
                      </>
                    )}
                  </>
                )}
                {selected && <Circle radius={r + 6} stroke="#d6b16a" strokeWidth={2} listening={false} />}
                {highlighted && !selected && (
                  <Circle radius={r + 7} stroke="#86efac" strokeWidth={2} dash={[6, 4]} listening={false} />
                )}
                {rings.map((cond, i) => (
                  <Circle
                    key={`${cond}-${i}`}
                    radius={r + 3 + i * 3}
                    stroke={conditionRingColor(cond)}
                    strokeWidth={2.5}
                    listening={false}
                  />
                ))}
                <Circle
                  radius={r}
                  fill={t.color2 ? undefined : t.color}
                  fillLinearGradientStartPoint={t.color2 ? { x: -r, y: -r } : undefined}
                  fillLinearGradientEndPoint={t.color2 ? { x: r, y: r } : undefined}
                  fillLinearGradientColorStops={t.color2 ? [0, t.color, 1, t.color2] : undefined}
                  stroke="#11100E"
                  strokeWidth={2}
                />
                <Text
                  text={initials(t.label || '?')}
                  width={r * 2}
                  height={r * 2}
                  offsetX={r}
                  offsetY={r}
                  align="center"
                  verticalAlign="middle"
                  fontSize={Math.max(11, r * 0.52)}
                  fontFamily="Cinzel"
                  fontStyle="bold"
                  fill={inkOnToken(t.color)}
                  listening={false}
                />
                {t.statusLabel && (
                  <Text
                    text={t.statusLabel}
                    y={r + 4}
                    width={Math.max(72, r * 3)}
                    offsetX={Math.max(72, r * 3) / 2}
                    align="center"
                    fontSize={9}
                    fontFamily="Inter"
                    fill={t.statusLabel === 'Dead' ? '#c4453c' : '#818cf8'}
                    listening={false}
                  />
                )}
              </Group>
            )
          })}
        </Layer>
        {isDm && (
          <Layer listening={false}>
            <Rect x={0} y={0} width={worldW} height={worldH} stroke="rgba(212,180,90,0.15)" />
          </Layer>
        )}
      </Stage>
      <div className="pointer-events-none absolute bottom-3 right-3 z-10 flex flex-col gap-1">
        <button
          type="button"
          className="pointer-events-auto grid h-9 w-9 place-items-center rounded-md border border-line bg-panel/90 text-ink shadow"
          aria-label="Zoom in"
          onClick={() => zoomBy(1.2)}
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="pointer-events-auto grid h-9 w-9 place-items-center rounded-md border border-line bg-panel/90 text-ink shadow"
          aria-label="Zoom out"
          onClick={() => zoomBy(1 / 1.2)}
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="pointer-events-auto grid h-9 w-9 place-items-center rounded-md border border-line bg-panel/90 text-ink shadow"
          aria-label="Fit map"
          onClick={fitNow}
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
