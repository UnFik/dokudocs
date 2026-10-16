import { type Graph, type Step } from './api'
import { followPath } from './follow-path'

const CELL_W = 200
const CELL_H = 96
const NODE_W = 150
const NODE_H = 44
const PAD = 16

type Point = { x: number; y: number }

const visitLabel = (label: string, count: number) =>
  count === 0
    ? `${label}, not visited`
    : count === 1
      ? `${label}, visited`
      : `${label}, visited ${count} times`

/** The decision graph, with the places one request passed through and the ways it went drawn in colour. */
export function TraceGraph({ graph, steps }: { graph: Graph; steps: Step[] }) {
  const { visits, taken } = followPath(graph, steps)
  const centre = (id: string): Point => {
    const node = graph.nodes.find((n) => n.id === id)!
    return {
      x: PAD + node.x * CELL_W + NODE_W / 2,
      y: PAD + node.y * CELL_H + NODE_H / 2,
    }
  }
  const width =
    PAD * 2 + Math.max(...graph.nodes.map((n) => n.x)) * CELL_W + NODE_W
  const height =
    PAD * 2 + Math.max(...graph.nodes.map((n) => n.y)) * CELL_H + NODE_H
  return (
    <svg
      role='img'
      aria-label='Decision graph'
      viewBox={`0 0 ${width} ${height}`}
      className='w-full max-w-4xl'
    >
      <defs>
        <marker
          id='trace-arrow'
          viewBox='0 0 10 10'
          refX='9'
          refY='5'
          markerWidth='7'
          markerHeight='7'
          orient='auto-start-reverse'
        >
          <path d='M0 0L10 5L0 10z' className='fill-current' />
        </marker>
      </defs>
      {graph.edges.map((edge) => {
        const from = centre(edge.from)
        const to = centre(edge.to)
        const used = taken.has(`${edge.from}>${edge.to}`)
        return (
          <g
            key={`${edge.from}>${edge.to}`}
            className={used ? 'text-primary' : 'text-muted-foreground/40'}
          >
            <line
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke='currentColor'
              strokeWidth={used ? 2.5 : 1}
              markerEnd='url(#trace-arrow)'
            />
            {edge.label ? (
              <text
                x={(from.x + to.x) / 2}
                y={(from.y + to.y) / 2 - 4}
                textAnchor='middle'
                className='fill-current text-[10px]'
              >
                {edge.label}
              </text>
            ) : null}
          </g>
        )
      })}
      {graph.nodes.map((node) => {
        const count = visits.get(node.id) ?? 0
        const c = centre(node.id)
        return (
          <g
            key={node.id}
            aria-label={visitLabel(node.label, count)}
            transform={`translate(${c.x - NODE_W / 2} ${c.y - NODE_H / 2})`}
            className={count > 0 ? 'text-primary' : 'text-muted-foreground/50'}
          >
            <rect
              width={NODE_W}
              height={NODE_H}
              rx={node.kind === 'decision' ? 22 : 8}
              strokeWidth={count > 0 ? 2.5 : 1}
              stroke='currentColor'
              className={count > 0 ? 'fill-primary/10' : 'fill-background'}
            />
            <text
              x={NODE_W / 2}
              y={NODE_H / 2 + 4}
              textAnchor='middle'
              className='fill-foreground text-xs'
            >
              {node.label}
            </text>
            {count > 1 ? (
              <text
                x={NODE_W - 6}
                y={-4}
                textAnchor='end'
                className='fill-primary text-[11px] font-semibold'
              >
                ×{count}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}
