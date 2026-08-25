import { useEffect, useRef, useState } from 'react'
import { Circle, Group, Layer, Line, Rect, Shape, Stage, Text, Image as KImage } from 'react-konva'
import useImage from 'use-image'
import type { BattleMap, FogState, MapToken } from '@/lib/types'
import { initials } from '@/lib/utils'

type Tool = 'select' | 'reveal' | 'hide'

type Props = {
  map: BattleMap
  tokens: MapToken[]
  fog: FogState
  isDm: boolean
  selectedId?: string | null
  tool?: Tool
  onSelect?: (id: string | null) => void
  onMove?: (id: string, x: number, y: number) => void
  onFog?: (fog: FogState) => void
}

function MapImage({ url, width, height }: { url: string; width: number; height: number }) {
  const [img] = useImage(url, 'anonymous')
  return <KImage image={img} width={width} height={height} listening={false} />
}

export function MapBoard({ map, tokens, fog, isDm, selectedId, tool = 'select', onSelect, onMove, onFog }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [scale, setScale] = useState(0.7)
  const [pos, setPos] = useState({ x: 20, y: 20 })
  const painting = useRef(false)

  const worldW = map.gridCols * map.gridSize
  const worldH = map.gridRows * map.gridSize

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

  function paint(x: number, y: number) {
    if (!isDm || !fog.enabled || (tool !== 'reveal' && tool !== 'hide') || !onFog) return
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

  const gridLines: number[][] = []
  for (let x = 0; x <= map.gridCols; x++) gridLines.push([x * map.gridSize, 0, x * map.gridSize, worldH])
  for (let y = 0; y <= map.gridRows; y++) gridLines.push([0, y * map.gridSize, worldW, y * map.gridSize])

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
          if (e.target !== e.target.getStage() && e.target.getClassName() !== 'Image' && e.target.getClassName() !== 'Shape') return
          if (tool === 'select') onSelect?.(null)
          if (tool === 'reveal' || tool === 'hide') {
            painting.current = true
            const st = e.target.getStage()
            const p = st?.getPointerPosition()
            if (!p) return
            paint((p.x - pos.x) / scale, (p.y - pos.y) / scale)
          }
        }}
        onMouseMove={(e) => {
          if (!painting.current) return
          const st = e.target.getStage()
          const p = st?.getPointerPosition()
          if (!p) return
          paint((p.x - pos.x) / scale, (p.y - pos.y) / scale)
        }}
        onMouseUp={() => {
          painting.current = false
        }}
      >
        <Layer>
          <MapImage url={map.imageUrl} width={worldW} height={worldH} />
          {gridLines.map((pts, i) => (
            <Line key={i} points={pts} stroke="rgba(243,230,208,0.18)" strokeWidth={1} listening={false} />
          ))}
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
                onDragEnd={(e) => {
                  const gx = Math.round((e.target.x() - map.gridSize / 2) / map.gridSize) * map.gridSize + map.gridSize / 2
                  const gy = Math.round((e.target.y() - map.gridSize / 2) / map.gridSize) * map.gridSize + map.gridSize / 2
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
