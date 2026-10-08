import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  useStoreApi,
  ViewportPortal,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type ResizeParams,
} from '@xyflow/react'
import '@xyflow/react/dist/base.css'
import './architecture-canvas.css'
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
import {
  elementsInBox,
  everything,
  toggled,
  type Selected,
} from '../lib/canvas-selection'
import {
  afterUse,
  toolForKey,
  toolsFor,
  type CanvasTool,
} from '../lib/canvas-tools'
import { familyOf, suggestedProtocols, type CatalogEntry } from '../lib/catalog'
import { anchorAt, type PinAnchor } from '../lib/comment-pins'
import { LABEL, minSize, PAD, type Point, type Rect } from '../lib/layout'
import {
  CanvasContext,
  ConnectionEdge,
  GroupNode,
  HostNode,
  SlotNode,
  SystemNode,
  type CanvasContextValue,
  type PeerMark,
} from './canvas-nodes'
import { CanvasToolbar } from './canvas-toolbar'
import { paletteDrag } from './palette-drag'

const nodeTypes = {
  host: HostNode,
  group: GroupNode,
  system: SystemNode,
  slot: SlotNode,
}
const edgeTypes = { connection: ConnectionEdge }

/** What is selected on the canvas; empty when nothing is. */
export type Selection = Selected[]

const LOCK_KEY = 'architecture-tool-lock'

// The lock is a convenience on this device; without storage it lasts until reload.
function readLock() {
  try {
    return localStorage.getItem(LOCK_KEY) === 'true'
  } catch {
    return false
  }
}
function writeLock(locked: boolean) {
  try {
    localStorage.setItem(LOCK_KEY, String(locked))
  } catch {
    // Blocked storage: the lock still holds for this visit.
  }
}

/** A touch screen without a mouse: one finger pans and never draws a selection box. */
const coarsePointer = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(pointer: coarse)').matches &&
  !window.matchMedia?.('(pointer: fine)').matches

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
  /** Elements move and connect only with the Cursor tool, for editors. */
  editable: boolean
): Node[] {
  const selected = new Set(selection.map((s) => s.id))
  return sortParentsFirst(canvas.nodes).map((n) => ({
    id: n.id,
    type: n.kind,
    position: { x: n.x, y: n.y },
    parentId: n.parentId ?? undefined,
    data: { element: n },
    selected: selected.has(n.id),
    draggable: editable,
    connectable: editable && n.kind === 'system',
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
  const selected = new Set(selection.map((s) => s.id))
  return canvas.connections.map((c) => ({
    id: c.id,
    source: c.source,
    target: c.target,
    type: 'connection',
    data: { connection: c },
    selected: selected.has(c.id),
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
  /** May start comment threads (editors and commenters). */
  canComment: boolean
  selection: Selection
  onSelect: (selection: Selection) => void
  peers: Peer[]
  onPointer: (point: { x: number; y: number } | null) => void
  /** A Connection was just drawn; `screen` is where the pointer let go. */
  onConnected: (connectionID: string, screen: { x: number; y: number }) => void
  onAdd: (item: PaletteItem, point: { x: number; y: number }) => void
  onDelete: (elements: Selected[]) => void
  /** The Comment tool was used on an element; `screen` is where it was clicked. */
  onComment?: (anchor: PinAnchor, screen: Point) => void
  onUndo: () => void
  onRedo: () => void
  /** Called at the start and end of a gesture, so one gesture is one undo step. */
  onGesture: () => void
  canAdd: boolean
  focusNodeID?: string
  /** Drawn on the canvas, above the elements (comment pins). */
  children?: ReactNode
}

export function ArchitectureCanvas(props: ArchitectureCanvasProps) {
  const { doc, canvas, readOnly, selection } = props
  const flow = useReactFlow()
  const catalogIndex = useMemo(
    () => new Map((props.catalog ?? []).map((e) => [e.slug, e])),
    [props.catalog]
  )
  const [tool, setToolState] = useState<CanvasTool>('cursor')
  const [locked, setLocked] = useState(readLock)
  // Space held down: Hand until it is let go.
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [erasing, setErasing] = useState<string | null>(null)
  const [coarse] = useState(coarsePointer)
  const tools = toolsFor({ canEdit: !readOnly, canComment: props.canComment })
  // A tool no longer offered (an editor became a viewer) falls back to Cursor.
  const chosen: CanvasTool = tools.includes(tool) ? tool : 'cursor'
  const active: CanvasTool = spaceHeld ? 'hand' : chosen
  const editable = !readOnly && active === 'cursor'
  const setTool = (next: CanvasTool) => {
    setToolState(next)
    setErasing(null)
  }
  /** After one use of a tool: Eraser and Comment go back to Cursor unless locked. */
  const used = () => setTool(afterUse(chosen, locked))
  const toggleLock = () => {
    setLocked((current) => {
      writeLock(!current)
      return !current
    })
  }

  const [nodes, setNodes] = useState<Node[]>(() =>
    toFlowNodes(canvas, selection, editable)
  )
  const [slot, setSlot] = useState<Rect | null>(null)
  const dragging = useRef(new Set<string>())
  const lastWrite = useRef(0)
  const lastPointer = useRef({ x: 0, y: 0 })

  // The Yjs state is the record; local node state only runs ahead of it during a drag or resize.
  useEffect(() => {
    setNodes((current) => {
      const held = new Map(current.map((n) => [n.id, n]))
      // Merge into the nodes React Flow already measured: a node without its
      // measured size is hidden until it is measured again, so replacing them
      // on every change (a drag writes every 50 ms) made the canvas blink.
      return toFlowNodes(canvas, selection, editable).map((n) => {
        const previous = held.get(n.id)
        if (!previous) return n
        return {
          ...previous,
          ...n,
          measured: previous.measured,
          dragging: previous.dragging,
          // Elements being dragged follow the pointer, not the echo of their own writes.
          position: dragging.current.has(n.id) ? previous.position : n.position,
        }
      })
    })
  }, [canvas, selection, editable])

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
    const map = new Map<string, PeerMark[]>()
    for (const peer of props.peers)
      peer.selection.forEach((id, index) =>
        map.set(id, [
          ...(map.get(id) ?? []),
          // The name tag goes on the first element each person selected.
          { name: peer.name, color: peer.color, named: index === 0 },
        ])
      )
    return map
  }, [props.peers])

  const context: CanvasContextValue = useMemo(
    () => ({
      readOnly,
      catalog: catalogIndex,
      containers,
      peerSelections,
      erasing,
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
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      readOnly,
      catalogIndex,
      containers,
      peerSelections,
      erasing,
      canvas,
      doc,
      props.catalog,
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

  const onNodeDragStart = useCallback(
    (_: unknown, _node: Node, moving: Node[]) => {
      dragging.current = new Set(moving.map((n) => n.id))
      props.onGesture()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  /** Where a dragged element is written: inside a container it stops at the padding. */
  const patchOf = useCallback(
    (node: Node) => {
      const inside = canvas.nodes.find((n) => n.id === node.id)?.parentId
      return {
        id: node.id,
        x: Math.round(inside ? Math.max(PAD, node.position.x) : node.position.x),
        y: Math.round(
          inside ? Math.max(LABEL, node.position.y) : node.position.y
        ),
      }
    },
    [canvas]
  )

  const onNodeDrag = useCallback(
    (event: MouseEvent | TouchEvent, node: Node, moving: Node[]) => {
      if (!doc) return
      const pointer = flow.screenToFlowPosition(screenPoint(event))
      const element = canvas.nodes.find((n) => n.id === node.id)
      // Only one element at a time drops into a container.
      if (element && !element.parentId && moving.length === 1) {
        const landing = landingFor(canvas, element.kind, pointer, element.id)
        setSlot(landing.container ? landing.rect : null)
      }
      // Others see the elements move; at most one write every 50 ms.
      const now = performance.now()
      if (now - lastWrite.current > 50) {
        lastWrite.current = now
        applyPatches(doc, moving.map(patchOf))
      }
    },
    [doc, canvas, flow, patchOf]
  )

  const onNodeDragStop = useCallback(
    (event: MouseEvent | TouchEvent, node: Node, moving: Node[]) => {
      dragging.current = new Set()
      setSlot(null)
      if (!doc) return
      if (moving.length > 1) {
        // Several elements move together and each stays in its own container.
        applyPatches(doc, moving.map(patchOf))
      } else {
        const pointer = flow.screenToFlowPosition(screenPoint(event))
        dropElement(doc, canvas, node.id, node.position, pointer)
      }
      props.onGesture()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, canvas, flow, patchOf]
  )

  /** A click on an element, by tool: select, erase or comment. */
  const clickWith = (event: ReactMouseEvent, item: Selected) => {
    if (active === 'hand') return
    if (active === 'eraser') {
      props.onDelete([item])
      used()
      return
    }
    if (active === 'comment') {
      const screen = { x: event.clientX, y: event.clientY }
      const box = (event.target as HTMLElement)
        .closest('.react-flow__node')
        ?.getBoundingClientRect()
      props.onComment?.(
        item.kind === 'node' && box
          ? anchorAt(item.id, screen, {
              x: box.x,
              y: box.y,
              w: box.width,
              h: box.height,
            })
          : { kind: 'element', elementId: item.id },
        screen
      )
      used()
      return
    }
    props.onSelect(event.shiftKey ? toggled(selection, item) : [item])
  }

  // The selection box: React Flow draws it; what it takes follows our rules.
  const store = useStoreApi()
  const boxed = useRef('')
  const followBox = (event: { clientX: number; clientY: number }) => {
    const { userSelectionRect, userSelectionActive } = store.getState()
    if (!userSelectionRect || !userSelectionActive) return
    const end = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const next = elementsInBox(canvas, {
      x: userSelectionRect.startX,
      y: userSelectionRect.startY,
      w: end.x - userSelectionRect.startX,
      h: end.y - userSelectionRect.startY,
    })
    const key = next.map((s) => s.id).join()
    if (key === boxed.current) return
    boxed.current = key
    props.onSelect(next)
  }

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
      props.onSelect([{ kind: 'edge', id }])
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
    const key = event.key.toLowerCase()
    if (event.code === 'Space' && !mod) {
      // Space on a focused button presses it; elsewhere it holds Hand.
      if (target?.closest?.('button, a')) return
      event.preventDefault()
      if (!event.repeat) setSpaceHeld(true)
    } else if (mod && key === 'z') {
      event.preventDefault()
      if (event.shiftKey) props.onRedo()
      else props.onUndo()
    } else if (mod && key === 'y') {
      event.preventDefault()
      props.onRedo()
    } else if (mod && key === 'a') {
      event.preventDefault()
      props.onSelect(everything(canvas))
    } else if (
      (event.key === 'Delete' || event.key === 'Backspace') &&
      selection.length &&
      !readOnly
    ) {
      event.preventDefault()
      props.onDelete(selection)
    } else if (event.key === 'Escape') {
      setTool('cursor')
      props.onSelect([])
    } else if (!mod && !event.altKey) {
      if (key === 'l' && !readOnly) toggleLock()
      const next = toolForKey(event.key)
      if (next && tools.includes(next)) setTool(next)
    }
  }
  const onKeyUp = (event: globalThis.KeyboardEvent) => {
    if (event.code === 'Space') setSpaceHeld(false)
  }

  const keyHandlers = useRef({ down: onKeyDown, up: onKeyUp })
  useEffect(() => {
    keyHandlers.current = { down: onKeyDown, up: onKeyUp }
  })
  useEffect(() => {
    const down = (event: globalThis.KeyboardEvent) =>
      keyHandlers.current.down(event)
    const up = (event: globalThis.KeyboardEvent) => keyHandlers.current.up(event)
    // Space let go in another window must not leave Hand stuck on.
    const blur = () => setSpaceHeld(false)
    document.addEventListener('keydown', down)
    document.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      document.removeEventListener('keydown', down)
      document.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  // Jump to an element named in the link ("Used in" on a document page).
  const focused = useRef(false)
  useEffect(() => {
    if (focused.current || !props.focusNodeID) return
    const node = canvas.nodes.find((n) => n.id === props.focusNodeID)
    if (!node) return
    focused.current = true
    props.onSelect([{ kind: 'node', id: node.id }])
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
        className='architecture-canvas relative h-full w-full'
        data-tool={active}
        onDragOver={onDragOver}
        onDragLeave={() => setSlot(null)}
        onDrop={onDrop}
        onPointerDownCapture={(event) => {
          // Pressing an element outside the selection selects it alone first, so
          // only that element moves, not the earlier selection with it.
          if (active !== 'cursor' || event.shiftKey || event.button !== 0)
            return
          const id = (event.target as HTMLElement)
            .closest('.react-flow__node')
            ?.getAttribute('data-id')
          if (!id || id === '__slot' || selection.some((s) => s.id === id))
            return
          setNodes((current) =>
            current.map((n) => ({ ...n, selected: n.id === id }))
          )
          props.onSelect([{ kind: 'node', id }])
        }}
        onPointerMove={(event) => {
          lastPointer.current = { x: event.clientX, y: event.clientY }
          followBox(event)
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
          onNodeClick={(event, node) =>
            node.id !== '__slot' &&
            clickWith(event, { kind: 'node', id: node.id })
          }
          onEdgeClick={(event, edge) =>
            clickWith(event, { kind: 'edge', id: edge.id })
          }
          onNodeMouseEnter={(_, node) =>
            active === 'eraser' && setErasing(node.id)
          }
          onNodeMouseLeave={() => setErasing(null)}
          onEdgeMouseEnter={(_, edge) =>
            active === 'eraser' && setErasing(edge.id)
          }
          onEdgeMouseLeave={() => setErasing(null)}
          onPaneClick={() => active === 'cursor' && props.onSelect([])}
          onSelectionStart={() => {
            boxed.current = ''
          }}
          nodesDraggable={editable}
          nodesConnectable={editable}
          elementsSelectable={active !== 'hand'}
          // Cursor: a drag on empty canvas draws a selection box and the middle
          // button pans. Every other tool, and touch, pans with the drag.
          selectionOnDrag={active === 'cursor' && !coarse}
          panOnDrag={active === 'cursor' && !coarse ? [1] : true}
          selectionMode={SelectionMode.Full}
          panActivationKeyCode={null}
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
          <Panel position='bottom-center'>
            <CanvasToolbar
              tools={tools}
              active={active}
              onTool={setTool}
              lock={
                readOnly ? undefined : { locked, onToggle: toggleLock }
              }
            />
          </Panel>
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
          {props.children}
        </ReactFlow>
      </div>
    </CanvasContext.Provider>
  )
}
