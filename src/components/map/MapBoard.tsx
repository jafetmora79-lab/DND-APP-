import { useEffect, useRef, useState } from 'react'
import { Circle, Group, Layer, Rect, Shape, Stage, Text, Image as KImage } from 'react-konva'
import useImage from 'use-image'
import type { BattleMap, FogState, MapToken } from '@/lib/types'
import { initials, pixelToCell, tokenOccupiesBlocked } from '@/lib/utils'

export type MapTool = 'select' | 'reveal' | 'hide' | 'block' | 'open'

type Props = {
  map: BattleMap
  tokens: MapToken[]
  fog: FogState
  isDm: boolean
  selectedId?: string | null
  tool?: MapTool
  onSelect?: (id: string | null) => void
  onMove?: (id: string, x: number, y: number) => void
  onFog?: (fog: FogState) => void
  onBlocked?: (blocked: number[]) => void
}

function MapImage({ url, width, height }: { url: string; width: number; height: number }) {
  const [img] = useImage(url, 'anonymous')
  if (!img) return null
  return <KImage image={img} width={width} height={height} listening={false} />
}

export function MapBoard({ map, tokens, fog, isDm, selectedId, tool = 'select', onSelect, onMove, onFog, onBlocked }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [scale, setScale] = useState(0.7)
  const [pos, setPos] = useState({ x: 20, y: 20 })
  const painting = useRef(false)
  const lastPaint = useRef(-1)
  const dragOrigin = useRef<Record<string, { x: number; y: number }>>({})

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
          const cls = e.target.getClassName()
          if (cls === 'Circle' || cls === 'Text' || cls === 'Group') return
          if (tool === 'select') onSelect?.(null)
          if (paintingFog || paintingTerrain) {
            painting.current = true
            lastPaint.current = -1
            const w = worldFromEvent(e)
            if (w) paintAt(w.x, w.y)
          }
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
            return (
              <Group
                key={t.id}
                x={t.x}
                y={t.y}
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
                {selectedId === t.refId && <Circle radius={r + 5} stroke="#f0d78c" strokeWidth={2} />}
                <Circle radius={r} fill={t.color} stroke="#120e0b" strokeWidth={2} />
                <Text
                  text={initials(t.label || '?')}
                  width={r * 2}
                  offsetX={r}
                  offsetY={8}
                  align="center"
                  fontSize={Math.max(10, r / 2)}
                  fontFamily="Cinzel"
                  fill="#120e0b"
                  listening={false}
                />
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
