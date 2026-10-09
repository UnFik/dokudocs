import {
  Eraser,
  Hand,
  Lock,
  LockOpen,
  MessageSquarePlus,
  MousePointer2,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { lockKey, toolKeys, type CanvasTool } from '../lib/canvas-tools'

const labels: Record<CanvasTool, { name: string; icon: LucideIcon }> = {
  hand: { name: 'Hand', icon: Hand },
  cursor: { name: 'Cursor', icon: MousePointer2 },
  eraser: { name: 'Eraser', icon: Eraser },
  comment: { name: 'Comment', icon: MessageSquarePlus },
}

function ToolButton(props: {
  label: string
  shortcut: string
  pressed: boolean
  icon: LucideIcon
  disabled?: boolean
  onClick: () => void
}) {
  const Icon = props.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type='button'
          aria-label={props.label}
          aria-pressed={props.pressed}
          aria-keyshortcuts={props.shortcut}
          disabled={props.disabled}
          onClick={props.onClick}
          className={cn(
            'inline-flex size-9 items-center justify-center rounded-[4px] text-muted-foreground transition-colors duration-[120ms] hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none pointer-coarse:size-11',
            props.pressed && 'bg-muted text-signal hover:text-signal'
          )}
        >
          <Icon className='size-4' strokeWidth={1.5} aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side='top' className='flex items-center gap-2'>
        {props.label}
        <kbd className='font-mono text-[10.5px] opacity-80'>
          {props.shortcut}
        </kbd>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The tool bar at the bottom of the canvas: Lock, then the tools this person may
 * use. Locked, the canvas only pans and zooms, so the tools wait until unlocked.
 */
export function CanvasToolbar(props: {
  tools: CanvasTool[]
  active: CanvasTool
  onTool: (tool: CanvasTool) => void
  /** Absent for people who cannot change the canvas. */
  lock?: { locked: boolean; onToggle: () => void }
}) {
  return (
    <div
      role='toolbar'
      aria-label='Canvas tools'
      aria-orientation='horizontal'
      className='nopan nodrag flex items-center gap-0.5 rounded-[6px] border border-border bg-card p-1 shadow-sm'
    >
      {props.lock && (
        <>
          <ToolButton
            label='Lock canvas'
            shortcut={lockKey}
            pressed={props.lock.locked}
            icon={props.lock.locked ? Lock : LockOpen}
            onClick={props.lock.onToggle}
          />
          <span aria-hidden className='mx-1 h-5 w-px bg-border' />
        </>
      )}
      {props.tools.map((tool) => (
        <ToolButton
          key={tool}
          label={labels[tool].name}
          shortcut={toolKeys[tool]}
          pressed={!props.lock?.locked && props.active === tool}
          disabled={props.lock?.locked}
          icon={labels[tool].icon}
          onClick={() => props.onTool(tool)}
        />
      ))}
    </div>
  )
}
