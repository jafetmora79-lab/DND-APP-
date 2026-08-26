import { useEffect, useRef, useState } from 'react'
import { Circle, Group, Layer, Rect, Shape, Stage, Text, Image as KImage } from 'react-konva'
import useImage from 'use-image'
import { conditionRingColor, type BattleMap, type FogState, type MapToken } from '@/lib/types'
import { hpBarFill, initials, pixelToCell, tokenOccupiesBlocked } from '@/lib/utils'
import { inkOnToken } from '@/lib/token-look'

export type MapTool = 'select' | 'reveal' | 'hide' | 'block' | 'open'

type Props = {
  map: BattleMap
  tokens: MapToken[]
  fog: FogState
  isDm: boolean
  selectedId?: string | null
  highlightIds?: string[]
  tool?: MapTool
  onSelect?: (id: string | null) => void
  onMove?: (id: string, x: number, y: number) => void
  onFog?: (fog: FogState) => void
  onBlocked?: (blocked: number[]) => void
  onCellClick?: (col: number, row: number) => void
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
}: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [scale, setScale] = useState(0.7)
  const [pos, setPos] = useState({ x: 20, y: 20 })
  const painting = useRef(false)
  const lastPaint = useRef(-1)
  const dragOrigin = useRef<Record<string, { x: number; y: number }>>({})
  const pointerDown = useRef<{ x: number; y: number } | null>(null)

  const worldW = map.gridCols * map.gridSize
  const worldH = map.gridRows * map.gridSize
  const blocked = map.blocked ?? []
  const paintingTerrain = tool === 'block' || tool === 'open'
  const paintingFog = tool === 'reveal' || tool === 'hide'

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

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
    next[i] = tool === 'block' ? 1 : 0
    onBlocked(next)
  }

  function paintAt(x: number, y: number) {
    if (paintingFog) paintFog(x, y)
    if (paintingTerrain) paintTerrain(x, y)
  }

  return (
    <div ref={wrap} className="relative h-full w-full overflow-hidden bg-[#0a0806]">
      <Stage
        width={size.w}
        height={size.h}
        scaleX={scale}
        scaleY={scale}
        x={pos.x}
        y={pos.y}
        draggable={tool === 'select'}
        onDragEnd={(e) => {
          if (e.target === e.target.getStage()) setPos({ x: e.target.x(), y: e.target.y() })
        }}
        onWheel={(e) => {
          e.evt.preventDefault()
          const old = scale
          const next = Math.min(2.4, Math.max(0.25, old * (e.evt.deltaY > 0 ? 0.92 : 1.08)))
          const ptr = e.target.getStage()?.getPointerPosition()
          if (!ptr) {
            setScale(next)
            return
          }
          const mousePointTo = { x: (ptr.x - pos.x) / old, y: (ptr.y - pos.y) / old }
          setScale(next)
          setPos({ x: ptr.x - mousePointTo.x * next, y: ptr.y - mousePointTo.y * next })
        }}
        onMouseDown={(e) => {
          const ptr = e.target.getStage()?.getPointerPosition()
          pointerDown.current = ptr ? { x: ptr.x, y: ptr.y } : null
          if (e.target.findAncestor('.token')) return
          const cls = e.target.getClassName()
          if (cls === 'Circle' || cls === 'Text' || cls === 'Group') return
          if (tool === 'select' && !onCellClick) onSelect?.(null)
          if (paintingFog || paintingTerrain) {
            painting.current = true
            lastPaint.current = -1
            const w = worldFromEvent(e)
            if (w) paintAt(w.x, w.y)
          }
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
        onMouseUp={() => {
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
              ctx.fillStyle = 'rgba(96, 28, 22, 0.48)'
              ctx.strokeStyle = 'rgba(196, 69, 60, 0.85)'
              ctx.lineWidth = 1.5
              for (let i = 0; i < blocked.length; i++) {
                if (blocked[i] !== 1) continue
                const c = i % map.gridCols
                const r = Math.floor(i / map.gridCols)
                const x = c * map.gridSize
                const y = r * map.gridSize
                ctx.fillRect(x, y, map.gridSize, map.gridSize)
                ctx.beginPath()
                ctx.moveTo(x + 5, y + 5)
                ctx.lineTo(x + map.gridSize - 5, y + map.gridSize - 5)
                ctx.moveTo(x + map.gridSize - 5, y + 5)
                ctx.lineTo(x + 5, y + map.gridSize - 5)
                ctx.stroke()
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
            const hidden = fog.enabled && !isDm && !fog.revealed[cellAt(t.x, t.y)]
            if (hidden || (!isDm && !t.visibleToPlayers)) return null
            const selected = selectedId === t.refId
            const highlighted = highlightIds.includes(t.refId)
            const hpMax = t.hpMax ?? 0
            const hpCurrent = t.hpCurrent ?? hpMax
            const barW = Math.max(28, r * 1.8)
            const ratio = hpMax > 0 ? Math.max(0, Math.min(1, hpCurrent / hpMax)) : 0
            const rings = (t.conditions ?? []).slice(0, 4)
            const showHud = Boolean(t.label) || hpMax > 0 || t.ac != null
            const downed = Boolean(t.statusLabel) || (t.conditions ?? []).includes('Unconscious')
            return (
              <Group
                key={t.id}
                name="token"
                x={t.x}
                y={t.y}
                opacity={downed ? 0.82 : 1}
                draggable={isDm && tool === 'select'}
                onClick={() => onSelect?.(t.refId)}
                onTap={() => onSelect?.(t.refId)}
                onDragStart={() => {
                  dragOrigin.current[t.id] = { x: t.x, y: t.y }
                }}
                onDragEnd={(e) => {
                  const gx = Math.round((e.target.x() - map.gridSize / 2) / map.gridSize) * map.gridSize + map.gridSize / 2
                  const gy = Math.round((e.target.y() - map.gridSize / 2) / map.gridSize) * map.gridSize + map.gridSize / 2
                  const { col, row } = pixelToCell(gx, gy, map.gridSize)
                  if (tokenOccupiesBlocked(blocked, col, row, map.gridCols, map.gridRows, t.sizeSquares)) {
                    const origin = dragOrigin.current[t.id]
                    if (origin) e.target.position(origin)
                    return
                  }
                  e.target.position({ x: gx, y: gy })
                  onMove?.(t.id, gx, gy)
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
    </div>
  )
}
