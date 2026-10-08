import { createContext, useContext } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  NodeResizer,
  NodeToolbar,
  Position,
  useInternalNode,
  type InternalNode,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ResizeParams,
} from '@xyflow/react'
import { FileText, LogOut, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  ArchitectureConnection,
  ArchitectureNode,
} from '../lib/canvas-model'
import type { CatalogEntry } from '../lib/catalog'
import { CatalogIcon } from './catalog-icon'

/** What the custom nodes and edges need from the editor, without passing functions through node data. */
export type CanvasContextValue = {
  readOnly: boolean
  catalog: Map<string, CatalogEntry>
  containers: Map<string, ArchitectureNode>
  /** People who have an element selected, by element id. */
  peerSelections: Map<string, { name: string; color: string }[]>
  minSizeOf: (id: string) => { w: number; h: number }
  shouldResize: (id: string, params: ResizeParams) => boolean
  onResize: (id: string, params: ResizeParams) => void
  onResizeEnd: (id: string, params: ResizeParams) => void
  takeOut: (id: string) => void
  familyOf: (protocol: string) => string
  commentCounts: Map<string, number>
}

export const CanvasContext = createContext<CanvasContextValue | null>(null)

function useCanvas() {
  const value = useContext(CanvasContext)
  if (!value)
    throw new Error(
      'canvas nodes must be rendered inside the Architecture canvas'
    )
  return value
}

export type ElementNode = Node<
  { element: ArchitectureNode },
  'host' | 'group' | 'system'
>
export type SlotNode = Node<Record<string, never>, 'slot'>

function PeerOutline({ id }: { id: string }) {
  const { peerSelections } = useCanvas()
  const peers = peerSelections.get(id)
  if (!peers?.length) return null
  return (
    <>
      <span
        aria-hidden
        className='pointer-events-none absolute -inset-[5px] rounded-[9px] border-2'
        style={{ borderColor: peers[0]!.color }}
      />
      <span
        className='pointer-events-none absolute -top-[22px] left-0 rounded-[2px] px-1 text-[10px] leading-4 font-medium text-white'
        style={{ background: peers[0]!.color }}
      >
        {peers.map((p) => p.name).join(', ')}
      </span>
    </>
  )
}

function TakeOutToolbar({
  id,
  element,
  selected,
}: {
  id: string
  element: ArchitectureNode
  selected: boolean
}) {
  const { readOnly, containers, takeOut } = useCanvas()
  const parent = element.parentId ? containers.get(element.parentId) : undefined
  if (readOnly || !parent) return null
  return (
    <NodeToolbar
      isVisible={selected}
      position={Position.Top}
      align='end'
      offset={8}
    >
      <button
        type='button'
        className='nodrag inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-input bg-card px-2 text-xs font-medium shadow-sm hover:border-signal hover:text-signal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal'
        title={`Take out of ${parent.name || 'this container'}`}
        aria-label={`Take ${element.name || 'this element'} out of ${parent.name || 'its container'}`}
        onClick={() => takeOut(id)}
      >
        <LogOut className='size-3.5' strokeWidth={1.5} aria-hidden />
        Take out
      </button>
    </NodeToolbar>
  )
}

export function SystemNode({ id, data, selected }: NodeProps<ElementNode>) {
  const { readOnly, catalog, commentCounts } = useCanvas()
  const comments = commentCounts.get(id) ?? 0
  const element = data.element
  const entry = element.catalog ? catalog.get(element.catalog) : undefined
  const external = entry?.subkind === 'external'
  return (
    <div
      className={cn(
        'relative flex h-[50px] w-[132px] items-center gap-2 rounded-[6px] border bg-card px-2 text-left',
        external ? 'border-dashed border-input' : 'border-input',
        selected && 'border-signal ring-1 ring-signal'
      )}
      data-element={id}
    >
      <PeerOutline id={id} />
      <TakeOutToolbar id={id} element={element} selected={Boolean(selected)} />
      <CatalogIcon
        slug={element.catalog}
        subkind={entry?.subkind ?? 'job'}
        size={20}
      />
      <span className='min-w-0'>
        <span className='block truncate text-[12.5px] leading-tight font-medium'>
          {element.name || 'Untitled'}
        </span>
        <span className='block truncate font-mono text-[10.5px] text-muted-foreground'>
          {entry?.name ?? element.catalog ?? 'no type'}
        </span>
      </span>
      {element.links.length > 0 && (
        <span
          className='absolute -top-2 -right-2 inline-flex items-center gap-0.5 rounded-[2px] border border-border bg-card px-1 font-mono text-[10px] text-muted-foreground'
          title={`${element.links.length} linked document${element.links.length === 1 ? '' : 's'}`}
        >
          <FileText className='size-2.5' aria-hidden /> {element.links.length}
        </span>
      )}
      {comments > 0 && (
        <span
          className='absolute -right-2 -bottom-2 inline-flex items-center gap-0.5 rounded-[2px] border border-border bg-card px-1 font-mono text-[10px] text-muted-foreground'
          title={`${comments} open comment${comments === 1 ? '' : 's'}`}
        >
          <MessageSquare className='size-2.5' aria-hidden /> {comments}
        </span>
      )}
      <Handle
        type='target'
        position={Position.Left}
        className='!size-2.5 !border-input !bg-card'
        isConnectable={!readOnly}
      />
      <Handle
        type='source'
        position={Position.Right}
        className='!size-3 !border-[1.5px] !border-input !bg-card hover:!border-signal hover:!bg-signal'
        isConnectable={!readOnly}
        aria-label={`Draw a connection from ${element.name}`}
      />
    </div>
  )
}

function ContainerNode({
  id,
  data,
  selected,
  kind,
}: NodeProps<ElementNode> & { kind: 'host' | 'group' }) {
  const { readOnly, catalog, minSizeOf, shouldResize, onResize, onResizeEnd } =
    useCanvas()
  const element = data.element
  const entry = element.catalog ? catalog.get(element.catalog) : undefined
  const min = minSizeOf(id)
  return (
    <div
      className={cn(
        'relative h-full w-full rounded-[6px] border',
        kind === 'group'
          ? 'border-dotted border-input'
          : 'border-dashed border-input bg-muted/40',
        selected && 'border-solid border-signal'
      )}
      data-element={id}
    >
      <PeerOutline id={id} />
      <TakeOutToolbar id={id} element={element} selected={Boolean(selected)} />
      {!readOnly && (
        <NodeResizer
          isVisible={Boolean(selected)}
          minWidth={min.w}
          minHeight={min.h}
          color='var(--signal)'
          handleClassName='!size-2.5 !rounded-[2px]'
          shouldResize={(_event, params) => shouldResize(id, params)}
          onResize={(_event, params) => onResize(id, params)}
          onResizeEnd={(_event, params) => onResizeEnd(id, params)}
        />
      )}
      <div className='absolute top-1.5 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 text-[11.5px] text-muted-foreground'>
        {kind === 'host' && (
          <CatalogIcon
            slug={element.catalog}
            subkind={entry?.subkind ?? 'compute'}
            size={16}
          />
        )}
        <span className='truncate'>
          {element.name || (kind === 'group' ? 'Group' : 'Host')}
        </span>
      </div>
    </div>
  )
}

export const HostNode = (props: NodeProps<ElementNode>) => (
  <ContainerNode {...props} kind='host' />
)
export const GroupNode = (props: NodeProps<ElementNode>) => (
  <ContainerNode {...props} kind='group' />
)

/** Where an element will land when it is dropped into a container. */
export function SlotNode({ width, height }: NodeProps<SlotNode>) {
  return (
    <div
      aria-hidden
      className='rounded-[6px] border-[1.5px] border-dashed border-signal bg-signal/10'
      style={{ width, height }}
    />
  )
}

export type ConnectionEdgeType = {
  id: string
  source: string
  target: string
  data: { connection: ArchitectureConnection }
}

const familyStyle: Record<string, React.CSSProperties> = {
  request: {},
  stream: { strokeWidth: 2.5 },
  message: { strokeDasharray: '6 4' },
  data: { strokeDasharray: '1 4', strokeLinecap: 'round', strokeWidth: 2 },
  telemetry: { strokeDasharray: '2 3', strokeWidth: 1, opacity: 0.75 },
}

/** The middle of the side of a node that faces the other node, so a line never loops back. */
function facingSide(node: InternalNode, other: InternalNode) {
  const a = node.internals.positionAbsolute
  const b = other.internals.positionAbsolute
  const w = node.measured.width ?? 0
  const h = node.measured.height ?? 0
  const dx = b.x + (other.measured.width ?? 0) / 2 - (a.x + w / 2)
  const dy = b.y + (other.measured.height ?? 0) / 2 - (a.y + h / 2)
  if (Math.abs(dx) * h > Math.abs(dy) * w)
    return dx > 0
      ? { x: a.x + w, y: a.y + h / 2, position: Position.Right }
      : { x: a.x, y: a.y + h / 2, position: Position.Left }
  return dy > 0
    ? { x: a.x + w / 2, y: a.y + h, position: Position.Bottom }
    : { x: a.x + w / 2, y: a.y, position: Position.Top }
}

export function ConnectionEdge(
  props: EdgeProps & { data?: { connection: ArchitectureConnection } }
) {
  const { familyOf, peerSelections } = useCanvas()
  const connection = props.data?.connection
  const sourceNode = useInternalNode(props.source)
  const targetNode = useInternalNode(props.target)
  const ends =
    sourceNode && targetNode
      ? {
          s: facingSide(sourceNode, targetNode),
          t: facingSide(targetNode, sourceNode),
        }
      : null
  const [path, labelX, labelY] = getBezierPath(
    ends
      ? {
          sourceX: ends.s.x,
          sourceY: ends.s.y,
          sourcePosition: ends.s.position,
          targetX: ends.t.x,
          targetY: ends.t.y,
          targetPosition: ends.t.position,
        }
      : props
  )
  const family = connection ? familyOf(connection.protocol) : 'request'
  const peer = peerSelections.get(props.id)?.[0]
  const stroke = props.selected
    ? 'var(--signal)'
    : (peer?.color ?? 'var(--muted-foreground)')
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        interactionWidth={16}
        style={{ stroke, strokeWidth: 1.5, ...familyStyle[family] }}
      />
      <EdgeLabelRenderer>
        <div
          className={cn(
            'nodrag nopan pointer-events-none absolute rounded-[2px] border bg-card px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap',
            props.selected
              ? 'border-signal text-signal'
              : 'border-border text-muted-foreground'
          )}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          {connection
            ? `${connection.protocol}${connection.label ? ` · ${connection.label}` : ''}`
            : ''}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
