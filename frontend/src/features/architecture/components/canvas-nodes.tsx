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
import { FileText, LogOut, Maximize2, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Focus } from '../lib/canvas-links'
import type {
  ArchitectureConnection,
  ArchitectureNode,
} from '../lib/canvas-model'
import type { CatalogEntry } from '../lib/catalog'
import { MIN_CONTAINER } from '../lib/layout'
import { isWebAddress } from '../lib/web-address'
import { CatalogIcon } from './catalog-icon'
import { RepositoryJump } from './repository-jump'

/** What the custom nodes and edges need from the editor, without passing functions through node data. */
export type CanvasContextValue = {
  readOnly: boolean
  catalog: Map<string, CatalogEntry>
  containers: Map<string, ArchitectureNode>
  /** People who have an element selected, by element id; `named` on the first element each person selected. */
  peerSelections: Map<string, PeerMark[]>
  /** The element the Eraser would remove on click. */
  erasing: string | null
  shouldResize: (id: string, params: ResizeParams) => boolean
  onResize: (id: string, params: ResizeParams) => void
  onResizeEnd: (id: string, params: ResizeParams) => void
  takeOut: (id: string) => void
  /** What stands out while one System is selected, or null. */
  focus: Focus | null
  /** The container a dragged element is about to leave. */
  leaving: string | null
  onDelete: (id: string) => void
  /** Show the linked documents of the selected element in the side panel. */
  openDocuments: () => void
  fit: (id: string) => void
  familyOf: (protocol: string) => string
}

export type PeerMark = { name: string; color: string; named: boolean }

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
  {
    element: ArchitectureNode
    /** Of a Host or Group: the smallest size it may be resized to. */
    min?: { w: number; h: number }
    /** Of a selected Host or Group: it holds something and is not already as small as it can be around it. */
    canFit?: boolean
  },
  'host' | 'group' | 'system'
>
export type SlotNode = Node<Record<string, never>, 'slot'>

function PeerOutline({ id }: { id: string }) {
  const { peerSelections } = useCanvas()
  const peers = peerSelections.get(id)
  if (!peers?.length) return null
  const named = peers.filter((p) => p.named)
  return (
    <>
      <span
        aria-hidden
        data-peer-outline
        className='pointer-events-none absolute -inset-[5px] rounded-[9px] border-2'
        style={{ borderColor: peers[0]!.color }}
      />
      {named.length > 0 && (
        <span
          className='pointer-events-none absolute -top-[22px] left-0 rounded-[2px] px-1 text-[10px] leading-4 font-medium text-white'
          style={{ background: named[0]!.color }}
        >
          {named.map((p) => p.name).join(', ')}
        </span>
      )}
    </>
  )
}

/** The red outline on what the Eraser would remove. */
function EraseMark({ id }: { id: string }) {
  const { erasing } = useCanvas()
  if (erasing !== id) return null
  return (
    <span
      aria-hidden
      data-erasing
      className='pointer-events-none absolute -inset-[3px] rounded-[8px] border-2 border-destructive'
    />
  )
}

const toolbarButton =
  'nodrag inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-input bg-card px-2 text-xs font-medium shadow-sm hover:border-signal hover:text-signal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal'

/** Floats above the selected element: Fit to contents for a container, Take out when it sits inside one, the repository of a System that has one, Delete for a System. */
function ElementToolbar({
  id,
  element,
  selected,
  canFit = false,
}: {
  id: string
  element: ArchitectureNode
  selected: boolean
  canFit?: boolean
}) {
  const { readOnly, containers, takeOut, fit, onDelete } = useCanvas()
  // A tool bar on every element would subscribe each one to the canvas store.
  if (!selected) return null
  const parent = element.parentId ? containers.get(element.parentId) : undefined
  const fitting = !readOnly && element.kind !== 'system' && canFit
  const takingOut = !readOnly && Boolean(parent)
  const deletable = !readOnly && element.kind === 'system'
  const repoUrl = element.kind === 'system' ? (element.repoUrl ?? '') : ''
  const jumping = isWebAddress(repoUrl)
  if (!takingOut && !fitting && !jumping && !deletable) return null
  return (
    <NodeToolbar
      isVisible={selected}
      position={Position.Top}
      align='end'
      offset={8}
      className='flex gap-1.5'
    >
      {fitting && (
        <button type='button' className={toolbarButton} onClick={() => fit(id)}>
          <Maximize2 className='size-3.5' strokeWidth={1.5} aria-hidden />
          Fit to contents
        </button>
      )}
      {jumping && (
        <RepositoryJump
          url={repoUrl}
          name={element.name}
          className={toolbarButton}
        />
      )}
      {parent && takingOut && (
        <button
          type='button'
          className={toolbarButton}
          title={`Take out of ${parent.name || 'this container'}`}
          aria-label={`Take ${element.name || 'this element'} out of ${parent.name || 'its container'}`}
          onClick={() => takeOut(id)}
        >
          <LogOut className='size-3.5' strokeWidth={1.5} aria-hidden />
          Take out
        </button>
      )}
      {deletable && (
        <button
          type='button'
          className={cn(
            toolbarButton,
            'text-destructive hover:border-destructive hover:text-destructive'
          )}
          aria-label={`Delete ${element.name || 'this system'}`}
          onClick={() => onDelete(id)}
        >
          <Trash2 className='size-3.5' strokeWidth={1.5} aria-hidden />
          Delete system
        </button>
      )}
    </NodeToolbar>
  )
}

export function SystemNode({ id, data, selected }: NodeProps<ElementNode>) {
  const { readOnly, catalog, focus, openDocuments } = useCanvas()
  const element = data.element
  const entry = element.catalog ? catalog.get(element.catalog) : undefined
  const external = entry?.subkind === 'external'
  const linked = Boolean(focus?.nodes.has(id)) && !selected
  const dimmed = focus !== null && !focus.nodes.has(id)
  return (
    <div
      className={cn(
        'relative flex h-[50px] w-[132px] items-center gap-2 rounded-[6px] border bg-card px-2 text-left transition-opacity',
        external ? 'border-dashed border-input' : 'border-input',
        linked && 'border-signal',
        dimmed && 'opacity-40',
        selected && 'border-signal ring-1 ring-signal'
      )}
      data-element={id}
    >
      <PeerOutline id={id} />
      <EraseMark id={id} />
      <ElementToolbar id={id} element={element} selected={Boolean(selected)} />
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
        <button
          type='button'
          className='nodrag nopan absolute -top-2 -right-2 inline-flex cursor-pointer items-center gap-0.5 rounded-[2px] border border-border bg-card px-1 font-mono text-[10px] text-muted-foreground hover:border-signal hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal'
          title={`${element.links.length} linked document${element.links.length === 1 ? '' : 's'}`}
          onClick={openDocuments}
        >
          <FileText className='size-2.5' aria-hidden /> {element.links.length}
        </button>
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
  const { readOnly, catalog, leaving, shouldResize, onResize, onResizeEnd } =
    useCanvas()
  const element = data.element
  const entry = element.catalog ? catalog.get(element.catalog) : undefined
  const min = data.min ?? MIN_CONTAINER
  return (
    <div
      className={cn(
        'relative h-full w-full rounded-[6px] border',
        kind === 'group'
          ? 'border-dotted border-input'
          : 'border-dashed border-input bg-muted/40',
        selected && 'border-solid border-signal',
        // A dragged element is about to leave this container.
        leaving === id &&
          'border-warn outline-2 outline-offset-2 outline-warn outline-dashed'
      )}
      data-element={id}
    >
      <PeerOutline id={id} />
      <EraseMark id={id} />
      <ElementToolbar
        id={id}
        element={element}
        selected={Boolean(selected)}
        canFit={data.canFit}
      />
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

/** Above the Systems and the linked edges drawn over them. */
const LINKED_LABEL_Z = 40

export function ConnectionEdge(
  props: EdgeProps & { data?: { connection: ArchitectureConnection } }
) {
  const { familyOf, peerSelections, erasing, focus } = useCanvas()
  const linked = Boolean(focus?.edges.has(props.id))
  const dimmed = focus !== null && !linked
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
  const stroke =
    erasing === props.id
      ? 'var(--destructive)'
      : props.selected || linked
        ? 'var(--signal)'
        : (peer?.color ?? 'var(--muted-foreground)')
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        interactionWidth={16}
        style={{
          stroke,
          strokeWidth: 1.5,
          ...familyStyle[family],
          ...(linked ? { strokeWidth: 2.25, opacity: 1 } : {}),
          ...(dimmed ? { opacity: 0.15 } : {}),
        }}
      />
      <EdgeLabelRenderer>
        <div
          className={cn(
            'nodrag nopan pointer-events-none absolute rounded-[2px] border bg-card px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap',
            props.selected || linked
              ? 'border-signal text-foreground'
              : 'border-border text-muted-foreground',
            dimmed && 'opacity-15'
          )}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            // The label layer sits under the nodes; a linked label lifts above them.
            ...(linked ? { zIndex: LINKED_LABEL_Z } : {}),
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
