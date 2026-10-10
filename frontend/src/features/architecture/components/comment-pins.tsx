import { useState, type CSSProperties } from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useStore, ViewportPortal } from '@xyflow/react'
import { toast } from 'sonner'
import { createDocumentComment, type CommentThread } from '@/lib/domain-api'
import { formatRelativeTime } from '@/lib/time-utils'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { CommentText } from '@/components/comment-text'
import { MentionTextarea } from '@/components/mention-textarea'
import type { ArchitectureJSON } from '../lib/canvas-model'
import { pinPoint, type PinAnchor } from '../lib/comment-pins'
import type { Point } from '../lib/layout'
import { commentsKey, Thread, useCanvasComments } from './element-comments'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('') || '?'

const replyCount = (n: number) => `${n} repl${n === 1 ? 'y' : 'ies'}`

/**
 * Pins keep their size on screen whatever the zoom, sit with their centre on
 * the commented point, and stay above the elements (React Flow lifts a
 * selected node by 1000).
 */
const placed = (at: Point, zoom: number, lift = 0): CSSProperties => ({
  transform: `translate(${at.x}px, ${at.y}px) scale(${1 / zoom}) translateY(${-lift}px)`,
  transformOrigin: '0 0',
  zIndex: 2000,
})

function elementName(canvas: ArchitectureJSON, id: string) {
  const node = canvas.nodes.find((n) => n.id === id)
  if (node) return node.name || 'Untitled'
  return canvas.connections.some((c) => c.id === id)
    ? 'a Connection'
    : 'an element'
}

function Pin(props: {
  thread: CommentThread
  at: Point
  zoom: number
  /** Screen pixels above the point: a Connection's pin clears its protocol label. */
  lift: number
  on: string
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceID: string
  documentID: string
  userID: string
  canComment: boolean
  onChanged: () => void
}) {
  const { thread } = props
  const [hover, setHover] = useState(false)
  const name = thread.authorName || 'Someone'
  const replies = thread.replies.length
  const label = `Comment by ${name}${replies ? `, ${replyCount(replies)}` : ''}, on ${props.on}`
  return (
    <div
      className='nopan nodrag nowheel pointer-events-auto absolute'
      style={placed(props.at, props.zoom, props.lift)}
    >
      <Popover open={props.open} onOpenChange={props.onOpenChange}>
        {/* The preview renders outside the canvas, so the canvas edge never cuts it. */}
        <TooltipPrimitive.Provider delayDuration={0}>
          <TooltipPrimitive.Root open={hover && !props.open}>
            <TooltipPrimitive.Trigger asChild>
              <PopoverTrigger asChild>
                <button
                  type='button'
                  aria-label={label}
                  data-thread={thread.id}
                  onPointerEnter={() => setHover(true)}
                  onPointerLeave={() => setHover(false)}
                  onFocus={() => setHover(true)}
                  onBlur={() => setHover(false)}
                  className={cn(
                    'relative inline-flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-card text-[10.5px] font-semibold text-foreground transition-colors duration-[120ms] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal motion-reduce:transition-none',
                    props.open
                      ? 'border-signal ring-2 ring-signal'
                      : 'border-input',
                    thread.resolvedAt && 'text-muted-foreground'
                  )}
                >
                  {initials(name)}
                  {replies > 0 && (
                    <span
                      aria-hidden
                      className='absolute -top-1.5 -right-2 rounded-[2px] border border-border bg-card px-1 font-mono text-[9.5px] leading-3.5 tabular-nums'
                    >
                      {replies}
                    </span>
                  )}
                </button>
              </PopoverTrigger>
            </TooltipPrimitive.Trigger>
            <TooltipPrimitive.Portal>
              <TooltipPrimitive.Content
                side='right'
                align='start'
                sideOffset={8}
                collisionPadding={8}
                className='z-50 w-56 rounded-[6px] border border-border bg-card p-2 text-[12px] text-foreground shadow-sm'
              >
                <div className='flex items-baseline justify-between gap-2'>
                  <span className='font-medium'>{name}</span>
                  <span className='font-mono text-[10.5px] text-muted-foreground'>
                    {formatRelativeTime(thread.createdAt)}
                  </span>
                </div>
                <p className='line-clamp-2 whitespace-pre-line'>
                  <CommentText
                    content={thread.content.split('\n').slice(0, 2).join('\n')}
                  />
                </p>
                {replies > 0 && (
                  <p className='font-mono text-[10.5px] text-muted-foreground'>
                    {replyCount(replies)}
                  </p>
                )}
              </TooltipPrimitive.Content>
            </TooltipPrimitive.Portal>
          </TooltipPrimitive.Root>
        </TooltipPrimitive.Provider>
        <PopoverContent
          aria-label={`Comment by ${name} on ${props.on}`}
          side='right'
          align='start'
          className='w-72 p-2'
        >
          <Thread
            as='div'
            thread={thread}
            workspaceID={props.workspaceID}
            documentID={props.documentID}
            canComment={props.canComment}
            userID={props.userID}
            onChanged={props.onChanged}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

/** The pin of a thread being started, with the box to write it. */
function DraftPin(props: {
  anchor: PinAnchor
  at: Point
  zoom: number
  on: string
  workspaceID: string
  documentID: string
  onDone: (threadID?: string) => void
  onChanged: () => void
}) {
  const [draft, setDraft] = useState('')
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: (threadID: string) =>
      createDocumentComment(props.workspaceID, props.documentID, {
        threadID,
        // The element's name at the time, so the thread still reads if the element goes.
        selectedText: props.on.slice(0, 500),
        content: draft.trim(),
        anchor: props.anchor,
      }),
    onSuccess: async (_result, threadID) => {
      await queryClient.invalidateQueries({
        queryKey: commentsKey(props.workspaceID, props.documentID),
      })
      props.onChanged()
      props.onDone(threadID)
    },
    onError: (error) =>
      toast.error(`The comment was not sent: ${error.message}`),
  })
  const fieldID = `new-pin-${props.anchor.elementId}`
  return (
    <div
      className='nopan nodrag nowheel pointer-events-auto absolute'
      style={placed(props.at, props.zoom)}
    >
      <Popover open onOpenChange={(open) => !open && props.onDone()}>
        <PopoverAnchor asChild>
          <span
            aria-hidden
            className='block size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-signal bg-card'
          />
        </PopoverAnchor>
        <PopoverContent
          aria-label={`New comment on ${props.on}`}
          side='right'
          align='start'
          className='w-72 p-2'
        >
          <form
            className='flex flex-col gap-1.5'
            onSubmit={(event) => {
              event.preventDefault()
              if (draft.trim()) create.mutate(crypto.randomUUID())
            }}
          >
            <label
              htmlFor={fieldID}
              className='font-mono text-[11px] text-muted-foreground'
            >
              New comment on {props.on}
            </label>
            <MentionTextarea
              id={fieldID}
              workspaceID={props.workspaceID}
              documentID={props.documentID}
              autoFocus
              value={draft}
              onValueChange={setDraft}
              placeholder={`Ask or note something about ${props.on}`}
              maxLength={2000}
              className='min-h-16 text-[12.5px]'
            />
            <div className='flex gap-1.5'>
              <Button
                type='submit'
                size='sm'
                variant='outline'
                disabled={!draft.trim() || create.isPending}
              >
                Comment
              </Button>
              <Button
                type='button'
                size='sm'
                variant='ghost'
                onClick={() => props.onDone()}
              >
                Cancel
              </Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  )
}

/**
 * The comment threads of a canvas as pins on their elements. Rendered inside
 * the canvas, so pins move with the elements and the view.
 */
export function CommentPins(props: {
  workspaceID: string
  documentID: string
  userID: string
  canvas: ArchitectureJSON
  canComment: boolean
  showResolved: boolean
  /** A thread being started with the Comment tool. */
  draft: PinAnchor | null
  onDraftDone: (threadID?: string) => void
  /** The thread whose pin is open. */
  active: string | null
  onActive: (threadID: string | null) => void
  onChanged: () => void
}) {
  const comments = useCanvasComments(props.workspaceID, props.documentID)
  const zoom = useStore((state) => state.transform[2])
  const { canvas } = props
  // Tab order follows the elements, then the age of the thread.
  const order = new Map(
    [...canvas.nodes, ...canvas.connections].map((e, index) => [e.id, index])
  )
  const pins = (comments.data ?? [])
    .filter((t) => t.elementAnchor && (props.showResolved || !t.resolvedAt))
    .map((thread) => ({ thread, at: pinPoint(canvas, thread.elementAnchor!) }))
    .filter((p): p is { thread: CommentThread; at: Point } => Boolean(p.at))
    .sort(
      (a, b) =>
        (order.get(a.thread.elementAnchor!.elementId) ?? 0) -
          (order.get(b.thread.elementAnchor!.elementId) ?? 0) ||
        a.thread.createdAt.localeCompare(b.thread.createdAt)
    )
  const draftAt = props.draft ? pinPoint(canvas, props.draft) : null
  return (
    <ViewportPortal>
      {pins.map(({ thread, at }) => (
        <Pin
          key={thread.id}
          thread={thread}
          at={at}
          zoom={zoom}
          lift={
            canvas.connections.some(
              (c) => c.id === thread.elementAnchor!.elementId
            )
              ? 22
              : 0
          }
          on={elementName(canvas, thread.elementAnchor!.elementId)}
          open={props.active === thread.id}
          onOpenChange={(open) => props.onActive(open ? thread.id : null)}
          workspaceID={props.workspaceID}
          documentID={props.documentID}
          userID={props.userID}
          canComment={props.canComment}
          onChanged={props.onChanged}
        />
      ))}
      {props.draft && draftAt && (
        <DraftPin
          key={`${props.draft.elementId}-${props.draft.x}-${props.draft.y}`}
          anchor={props.draft}
          at={draftAt}
          zoom={zoom}
          on={elementName(canvas, props.draft.elementId)}
          workspaceID={props.workspaceID}
          documentID={props.documentID}
          onDone={props.onDraftDone}
          onChanged={props.onChanged}
        />
      )}
    </ViewportPortal>
  )
}
