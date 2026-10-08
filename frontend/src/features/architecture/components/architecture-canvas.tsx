import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react'
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  useReactFlow,
  ViewportPortal,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type ResizeParams,
} from '@xyflow/react'
import '@xyflow/react/dist/base.css'
import type * as Y from 'yjs'
import type { Peer } from '../hooks/use-architecture-session'
import {
  boxHoldsChildren,
  dropElement,
  landingFor,
  resizeElement,
  takeOutElement,
  toLayoutNodes,
  type PaletteItem,
} from '../lib/canvas-actions'
import { addConnection, applyPatches } from '../lib/canvas-doc'
import type { ArchitectureJSON, ArchitectureNode } from '../lib/canvas-model'
import { familyOf, suggestedProtocols, type CatalogEntry } from '../lib/catalog'
import { LABEL, minSize, PAD, type Rect } from '../lib/layout'
import {
  CanvasContext,
  ConnectionEdge,
  GroupNode,
  HostNode,
  SlotNode,
  SystemNode,
  type CanvasContextValue,
} from './canvas-nodes'
import { paletteDrag } from './palette-drag'

const nodeTypes = {
  host: HostNode,
  group: GroupNode,
  system: SystemNode,
  slot: SlotNode,
}
const edgeTypes = { connection: ConnectionEdge }

export type Selection = { kind: 'node' | 'edge'; id: string } | null

/** Screen point of a drag event from a mouse or a touch. */
function screenPoint(event: MouseEvent | TouchEvent) {
  if ('changedTouches' in event) {
    const touch = event.changedTouches[0]
    return { x: touch?.clientX ?? 0, y: touch?.clientY ?? 0 }
  }
  return { x: event.clientX, y: event.clientY }
}

function sortParentsFirst(nodes: ArchitectureNode[]) {
  const byID = new Map(nodes.map((n) => [n.id, n]))
  const depth = (n: ArchitectureNode) => {
    let d = 0
    for (
      let p = n.parentId ? byID.get(n.parentId) : undefined;
      p;
      p = p.parentId ? byID.get(p.parentId) : undefined
    )
      d++
    return d
  }
  return [...nodes].sort((a, b) => depth(a) - depth(b))
}

function toFlowNodes(
  canvas: ArchitectureJSON,
  selection: Selection,
  readOnly: boolean
): Node[] {
  return sortParentsFirst(canvas.nodes).map((n) => ({
    id: n.id,
    type: n.kind,
    position: { x: n.x, y: n.y },
    parentId: n.parentId ?? undefined,
    data: { element: n },
    selected: selection?.kind === 'node' && selection.id === n.id,
    draggable: !readOnly,
    connectable: !readOnly && n.kind === 'system',
    // Containers sit under what they hold; React Flow draws children above their parent.
    zIndex: n.kind === 'system' ? 10 : 0,
    ...(n.kind === 'system'
      ? {}
      : {
          width: n.w ?? 200,
          height: n.h ?? 130,
          style: { width: n.w ?? 200, height: n.h ?? 130 },
        }),
    ariaLabel: `${n.kind} ${n.name}`,
  }))
}

function toFlowEdges(canvas: ArchitectureJSON, selection: Selection): Edge[] {
  return canvas.connections.map((c) => ({
    id: c.id,
    source: c.source,
    target: c.target,
    type: 'connection',
    data: { connection: c },
    selected: selection?.kind === 'edge' && selection.id === c.id,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    ariaLabel: `Connection over ${c.protocol}`,
    zIndex: 5,
  }))
}

export type ArchitectureCanvasProps = {
  doc: Y.Doc | null
  canvas: ArchitectureJSON
  catalog: CatalogEntry[] | undefined
  readOnly: boolean
  selection: Selection
  onSelect: (selection: Selection) => void
  peers: Peer[]
  onPointer: (point: { x: number; y: number } | null) => void
  /** A Connection was just drawn; `screen` is where the pointer let go. */
  onConnected: (connectionID: string, screen: { x: number; y: number }) => void
  onAdd: (item: PaletteItem, point: { x: number; y: number }) => void
  onDelete: (selection: NonNullable<Selection>) => void
  onUndo: () => void
  onRedo: () => void
  /** Called at the start and end of a gesture, so one gesture is one undo step. */
  onGesture: () => void
  canAdd: boolean
  focusNodeID?: string
  /** Open comment threads by element id, for the badge on each node. */
  commentCounts?: Map<string, number>
}

export function ArchitectureCanvas(props: ArchitectureCanvasProps) {
  const { doc, canvas, readOnly, selection } = props
  const flow = useReactFlow()
  const catalogIndex = useMemo(
    () => new Map((props.catalog ?? []).map((e) => [e.slug, e])),
    [props.catalog]
  )
  const [nodes, setNodes] = useState<Node[]>(() =>
    toFlowNodes(canvas, selection, readOnly)
  )
  const [slot, setSlot] = useState<Rect | null>(null)
  const dragging = useRef<string | null>(null)
  const lastWrite = useRef(0)
  const lastPointer = useRef({ x: 0, y: 0 })

  // The Yjs state is the record; local node state only runs ahead of it during a drag or resize.
  useEffect(() => {
    setNodes((current) => {
      const held = new Map(current.map((n) => [n.id, n]))
      // Merge into the nodes React Flow already measured: a node without its
      // measured size is hidden until it is measured again, so replacing them
      // on every change (a drag writes every 50 ms) made the canvas blink.
      return toFlowNodes(canvas, selection, readOnly).map((n) => {
        const previous = held.get(n.id)
        if (!previous) return n
        return {
          ...previous,
          ...n,
          measured: previous.measured,
          dragging: previous.dragging,
          // The element being dragged follows the pointer, not the echo of its own writes.
          position: n.id === dragging.current ? previous.position : n.position,
        }
      })
    })
  }, [canvas, selection, readOnly])

  const edges = useMemo(
    () => toFlowEdges(canvas, selection),
    [canvas, selection]
  )
  const displayNodes = useMemo(
    () =>
      slot
        ? [
            ...nodes,
            {
              id: '__slot',
              type: 'slot',
              position: { x: slot.x, y: slot.y },
              data: {},
              width: slot.w,
              height: slot.h,
              selectable: false,
              draggable: false,
              zIndex: 20,
            } as Node,
          ]
        : nodes,
    [nodes, slot]
  )

  const containers = useMemo(
    () =>
      new Map(
        canvas.nodes.filter((n) => n.kind !== 'system').map((n) => [n.id, n])
      ),
    [canvas]
  )
  const peerSelections = useMemo(() => {
    const map = new Map<string, { name: string; color: string }[]>()
    for (const peer of props.peers)
      if (peer.selection)
        map.set(peer.selection, [
          ...(map.get(peer.selection) ?? []),
          { name: peer.name, color: peer.color },
        ])
    return map
  }, [props.peers])

  const context: CanvasContextValue = useMemo(
    () => ({
      readOnly,
      catalog: catalogIndex,
      containers,
      peerSelections,
      minSizeOf: (id) => minSize(toLayoutNodes(canvas), id),
      shouldResize: (id, params) =>
        boxHoldsChildren(canvas, id, {
          x: params.x,
          y: params.y,
          w: params.width,
          h: params.height,
        }),
      onResize: (id, params) => {
        // Keep the children still on screen while the top-left corner moves.
        const node = canvas.nodes.find((n) => n.id === id)
        if (!node) return
        const dx = params.x - node.x
        const dy = params.y - node.y
        setNodes((current) =>
          current.map((n) => {
            const child = canvas.nodes.find(
              (c) => c.id === n.id && c.parentId === id
            )
            return child
              ? { ...n, position: { x: child.x - dx, y: child.y - dy } }
              : n
          })
        )
      },
      onResizeEnd: (id, params: ResizeParams) => {
        if (!doc) return
        props.onGesture()
        resizeElement(doc, canvas, id, {
          x: params.x,
          y: params.y,
          w: params.width,
          h: params.height,
        })
        props.onGesture()
      },
      takeOut: (id) => {
        if (!doc) return
        props.onGesture()
        takeOutElement(doc, canvas, id)
        props.onGesture()
      },
      familyOf: (protocol) => familyOf(props.catalog, protocol),
      commentCounts: props.commentCounts ?? new Map(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      readOnly,
      catalogIndex,
      containers,
      peerSelections,
      canvas,
      doc,
      props.catalog,
      props.commentCounts,
    ]
  )

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((current) => {
      const parents = new Map(current.map((n) => [n.id, n.parentId]))
      // Every change is applied (sizes React Flow measured included); selection
      // and removal stay with the editor, which owns them.
      const kept = changes
        .filter((c) => c.type !== 'select' && c.type !== 'remove')
        .map((c) =>
          c.type === 'position' && c.position && parents.get(c.id)
            ? {
                ...c,
                // Inside a container an element stops at the padding; it can only leave with "Take out".
                position: {
                  x: Math.max(PAD, c.position.x),
                  y: Math.max(LABEL, c.position.y),
                },
              }
            : c
        )
      return applyNodeChanges(kept, current)
    })
  }, [])

  const onNodeDragStart = useCallback((_: unknown, node: Node) => {
    dragging.current = node.id
    props.onGesture()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onNodeDrag = useCallback(
    (event: MouseEvent | TouchEvent, node: Node) => {
      if (!doc) return
      const pointer = flow.screenToFlowPosition(screenPoint(event))
      const element = canvas.nodes.find((n) => n.id === node.id)
      if (element && !element.parentId) {
        const landing = landingFor(canvas, element.kind, pointer, element.id)
        setSlot(landing.container ? landing.rect : null)
      }
      // Others see the element move; at most one write every 50 ms.
      const now = performance.now()
      if (now - lastWrite.current > 50) {
        lastWrite.current = now
        const x = element?.parentId
          ? Math.max(PAD, node.position.x)
          : node.position.x
        const y = element?.parentId
          ? Math.max(LABEL, node.position.y)
          : node.position.y
        applyPatches(doc, [{ id: node.id, x: Math.round(x), y: Math.round(y) }])
      }
    },
    [doc, canvas, flow]
  )

  const onNodeDragStop = useCallback(
    (event: MouseEvent | TouchEvent, node: Node) => {
      dragging.current = null
      setSlot(null)
      if (!doc) return
      const pointer = flow.screenToFlowPosition(screenPoint(event))
      dropElement(doc, canvas, node.id, node.position, pointer)
      props.onGesture()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, canvas, flow]
  )

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      const source = canvas.nodes.find((n) => n.id === c.source)
      const target = canvas.nodes.find((n) => n.id === c.target)
      return Boolean(
        source &&
        target &&
        source.id !== target.id &&
        source.kind === 'system' &&
        target.kind === 'system'
      )
    },
    [canvas]
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (!doc || !c.source || !c.target) return
      const target = canvas.nodes.find((n) => n.id === c.target)
      const subkind = target?.catalog
        ? catalogIndex.get(target.catalog)?.subkind
        : undefined
      props.onGesture()
      const id = addConnection(doc, {
        source: c.source,
        target: c.target,
        protocol: suggestedProtocols(subkind)[0]!,
      })
      props.onGesture()
      props.onSelect({ kind: 'edge', id })
      props.onConnected(id, lastPointer.current)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, canvas, catalogIndex]
  )

  const onDragOver = (event: DragEvent) => {
    const item = paletteDrag.current
    if (!item || readOnly || !props.canAdd) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    const point = flow.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    })
    const landing = landingFor(canvas, item.kind, point)
    setSlot(landing.container ? landing.rect : null)
  }

  const onDrop = (event: DragEvent) => {
    const item = paletteDrag.current
    setSlot(null)
    if (!item || readOnly || !props.canAdd) return
    event.preventDefault()
    paletteDrag.current = null
    props.onAdd(
      item,
      flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    )
  }

  // Shortcuts work wherever focus is on the page (a click on the empty canvas
  // focuses nothing), except while typing or inside a dialog.
  const onKeyDown = (event: globalThis.KeyboardEvent) => {
    const target = event.target as HTMLElement | null
    if (
      target?.closest?.(
        'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"]'
      )
    )
      return
    const mod = event.metaKey || event.ctrlKey
    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) props.onRedo()
      else props.onUndo()
    } else if (mod && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      props.onRedo()
    } else if (
      (event.key === 'Delete' || event.key === 'Backspace') &&
      selection &&
      !readOnly
    ) {
      event.preventDefault()
      props.onDelete(selection)
    } else if (event.key === 'Escape') {
      props.onSelect(null)
    }
  }

  const keyHandler = useRef(onKeyDown)
  useEffect(() => {
    keyHandler.current = onKeyDown
  })
  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => keyHandler.current(event)
    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  }, [])

  // Jump to an element named in the link ("Used in" on a document page).
  const focused = useRef(false)
  useEffect(() => {
    if (focused.current || !props.focusNodeID) return
    const node = canvas.nodes.find((n) => n.id === props.focusNodeID)
    if (!node) return
    focused.current = true
    props.onSelect({ kind: 'node', id: node.id })
    requestAnimationFrame(
      () =>
        void flow.fitView({
          nodes: [{ id: node.id }],
          maxZoom: 1.2,
          duration: 0,
        })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, props.focusNodeID])

  return (
    <CanvasContext.Provider value={context}>
      <div
        className='relative h-full w-full'
        onDragOver={onDragOver}
        onDragLeave={() => setSlot(null)}
        onDrop={onDrop}
        onPointerMove={(event) => {
          lastPointer.current = { x: event.clientX, y: event.clientY }
          props.onPointer(
            flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
          )
        }}
        onPointerLeave={() => props.onPointer(null)}
      >
        <ReactFlow
          nodes={displayNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onNodeClick={(_, node) =>
            node.id !== '__slot' &&
            props.onSelect({ kind: 'node', id: node.id })
          }
          onEdgeClick={(_, edge) =>
            props.onSelect({ kind: 'edge', id: edge.id })
          }
          onPaneClick={() => props.onSelect(null)}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          elementsSelectable
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          fitView
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          aria-label='Architecture canvas'
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={16}
            size={1}
            color='var(--border)'
          />
          <Controls showInteractive={false} position='bottom-left' />
          <ViewportPortal>
            {props.peers
              .filter((p) => p.pointer)
              .map((p) => (
                <div
                  key={p.clientID}
                  className='pointer-events-none absolute'
                  style={{
                    transform: `translate(${p.pointer!.x}px, ${p.pointer!.y}px)`,
                  }}
                  aria-hidden
                >
                  <svg width='14' height='14' viewBox='0 0 14 14'>
                    <path d='M1 1 L13 6 L7 7.5 L5.5 13 Z' fill={p.color} />
                  </svg>
                  <span
                    className='ml-3 rounded-[2px] px-1 text-[10px] font-medium text-white'
                    style={{ background: p.color }}
                  >
                    {p.name}
                  </span>
                </div>
              ))}
          </ViewportPortal>
        </ReactFlow>
      </div>
    </CanvasContext.Provider>
  )
}
