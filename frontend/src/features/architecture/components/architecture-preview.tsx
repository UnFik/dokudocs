import { useMemo } from 'react'
import * as Y from 'yjs'
import { cn } from '@/lib/utils'
import { toLayoutNodes } from '../lib/canvas-actions'
import type { Change } from '../lib/canvas-diff'
import {
  architectureToJSON,
  seedArchitecture,
  type ArchitectureJSON,
} from '../lib/canvas-model'
import { absoluteRect } from '../lib/layout'

const changeColor: Record<Change, string> = {
  added: 'var(--ok)',
  removed: 'var(--destructive)',
  changed: 'var(--warn)',
}

/**
 * Reads `content_json` that may come from an older or a damaged document, the
 * same way the service does: seeded into a Yjs state and read back.
 */
export function parseCanvas(value: unknown): ArchitectureJSON {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(
      doc,
      seedArchitecture(value && typeof value === 'object' ? value : null)
    )
    return architectureToJSON(doc)
  } finally {
    doc.destroy()
  }
}

/**
 * A still drawing of a canvas: revision previews, versions, thumbnails and the
 * public view. With `diff`, added, removed and changed elements are outlined.
 */
export function ArchitecturePreview({
  canvas,
  diff,
  className,
  label = 'Architecture diagram',
  compact = false,
}: {
  canvas: ArchitectureJSON
  diff?: Map<string, Change>
  className?: string
  label?: string
  compact?: boolean
}) {
  const drawing = useMemo(() => {
    const layout = toLayoutNodes(canvas)
    const rects = new Map(
      canvas.nodes.map((n) => [n.id, absoluteRect(layout, n.id)])
    )
    const all = [...rects.values()]
    const minX = Math.min(0, ...all.map((r) => r.x)) - 20
    const minY = Math.min(0, ...all.map((r) => r.y)) - 30
    const maxX = Math.max(200, ...all.map((r) => r.x + r.w)) + 20
    const maxY = Math.max(120, ...all.map((r) => r.y + r.h)) + 20
    return { rects, viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}` }
  }, [canvas])

  if (!canvas.nodes.length) {
    return (
      <p className={cn('text-xs text-muted-foreground', className)}>
        This canvas is empty.
      </p>
    )
  }
  const containers = canvas.nodes.filter((n) => n.kind !== 'system')
  const systems = canvas.nodes.filter((n) => n.kind === 'system')
  return (
    <svg
      viewBox={drawing.viewBox}
      className={cn('h-auto w-full', className)}
      role='img'
      aria-label={label}
    >
      <defs>
        <marker
          id='architecture-preview-arrow'
          viewBox='0 0 10 10'
          refX='9'
          refY='5'
          markerWidth='6'
          markerHeight='6'
          orient='auto-start-reverse'
        >
          <path d='M0,0 L10,5 L0,10 z' fill='var(--muted-foreground)' />
        </marker>
      </defs>
      {containers.map((n) => {
        const r = drawing.rects.get(n.id)!
        const change = diff?.get(n.id)
        return (
          <g key={n.id}>
            <rect
              x={r.x}
              y={r.y}
              width={r.w}
              height={r.h}
              rx={6}
              fill={n.kind === 'group' ? 'none' : 'var(--muted)'}
              fillOpacity={0.4}
              stroke={change ? changeColor[change] : 'var(--input)'}
              strokeWidth={change ? 2.5 : 1}
              strokeDasharray={
                change ? undefined : n.kind === 'group' ? '2 3' : '5 4'
              }
            />
            {!compact && (
              <text
                x={r.x + 8}
                y={r.y + 18}
                fontSize={12}
                fill='var(--muted-foreground)'
              >
                {n.name}
              </text>
            )}
          </g>
        )
      })}
      {canvas.connections.map((c) => {
        const a = drawing.rects.get(c.source)
        const b = drawing.rects.get(c.target)
        if (!a || !b) return null
        const change = diff?.get(c.id)
        return (
          <line
            key={c.id}
            x1={a.x + a.w}
            y1={a.y + a.h / 2}
            x2={b.x}
            y2={b.y + b.h / 2}
            stroke={change ? changeColor[change] : 'var(--muted-foreground)'}
            strokeWidth={change ? 2.5 : 1.5}
            strokeDasharray={change === 'removed' ? '4 3' : undefined}
            markerEnd='url(#architecture-preview-arrow)'
          />
        )
      })}
      {systems.map((n) => {
        const r = drawing.rects.get(n.id)!
        const change = diff?.get(n.id)
        return (
          <g key={n.id}>
            <rect
              x={r.x}
              y={r.y}
              width={r.w}
              height={r.h}
              rx={6}
              fill='var(--card)'
              stroke={change ? changeColor[change] : 'var(--input)'}
              strokeWidth={change ? 2.5 : 1}
              strokeDasharray={change === 'removed' ? '4 3' : undefined}
            />
            {!compact && (
              <text
                x={r.x + 10}
                y={r.y + 30}
                fontSize={12.5}
                fontWeight={500}
                fill='var(--foreground)'
              >
                {n.name.length > 18 ? `${n.name.slice(0, 17)}…` : n.name}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

export function DiffLegend() {
  return (
    <ul
      className='flex flex-wrap gap-3 text-xs'
      aria-label='What the colours mean'
    >
      {(['added', 'changed', 'removed'] as const).map((change) => (
        <li key={change} className='flex items-center gap-1.5'>
          <span
            aria-hidden
            className='size-2 rounded-[1px]'
            style={{ background: changeColor[change] }}
          />
          {change}
        </li>
      ))}
    </ul>
  )
}
