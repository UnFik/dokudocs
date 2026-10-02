import type { KeyboardEvent } from 'react'
import { Edit3, Eye, FilePenLine } from 'lucide-react'
import type { MarkdownPreviewMode } from '@/stores/editor-preference-store'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export type EditorMode = MarkdownPreviewMode

export type ModeTabState = { disabledReason: string | null }

export type ModeTabStates = Record<EditorMode, ModeTabState>

export function modeTabStates({
  canEdit,
  canSuggest,
  online,
  synced,
}: {
  canEdit: boolean
  canSuggest: boolean
  online: boolean
  synced: boolean
}): ModeTabStates {
  let suggest: string | null = null
  if (!canSuggest)
    suggest = 'Suggest needs comment or edit access to this document.'
  else if (!online)
    suggest =
      'Suggestions are sent to the server, so Suggest needs a connection.'
  else if (!synced)
    suggest = 'Suggest is available once the document has synced.'
  return {
    view: { disabledReason: null },
    edit: {
      disabledReason: canEdit
        ? null
        : 'Edit needs edit access to this document.',
    },
    suggest: { disabledReason: suggest },
  }
}

export function resolveMode(
  mode: EditorMode,
  allowed: { canEdit: boolean; suggestEnabled: boolean }
): EditorMode {
  if (mode === 'edit' && !allowed.canEdit) return 'view'
  if (mode === 'suggest' && !allowed.suggestEnabled)
    return allowed.canEdit ? 'edit' : 'view'
  return mode
}

const tabs: { mode: EditorMode; label: string; icon: typeof Eye }[] = [
  { mode: 'view', label: 'View', icon: Eye },
  { mode: 'edit', label: 'Edit', icon: Edit3 },
  { mode: 'suggest', label: 'Suggest', icon: FilePenLine },
]

export function EditorModeTabs({
  mode,
  states,
  onChange,
}: {
  mode: EditorMode
  states: ModeTabStates
  onChange: (mode: EditorMode) => void
}) {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    const enabled = tabs.filter((tab) => !states[tab.mode].disabledReason)
    const index = enabled.findIndex((tab) => tab.mode === mode)
    const next = enabled[(index + step + enabled.length) % enabled.length]
    if (!next) return
    event.preventDefault()
    onChange(next.mode)
    event.currentTarget
      .querySelector<HTMLElement>(`[data-mode="${next.mode}"]`)
      ?.focus()
  }

  return (
    <div
      role='tablist'
      aria-label='Editor mode'
      onKeyDown={move}
      className='inline-flex items-center rounded-sm border border-input p-0.5'
    >
      {tabs.map(({ mode: tabMode, label, icon: Icon }) => {
        const selected = tabMode === mode
        const reason = states[tabMode].disabledReason
        const button = (
          <button
            type='button'
            role='tab'
            data-mode={tabMode}
            aria-selected={selected}
            aria-disabled={reason ? true : undefined}
            tabIndex={selected || reason ? 0 : -1}
            onClick={() => {
              if (!reason) onChange(tabMode)
            }}
            className={cn(
              'inline-flex min-h-11 items-center gap-1.5 rounded-xs px-3 text-[13px] font-medium transition-colors md:min-h-8',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none',
              selected
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
              reason && 'cursor-not-allowed opacity-60 hover:bg-transparent'
            )}
          >
            <Icon className='size-3.5' aria-hidden />
            {label}
          </button>
        )
        return reason ? (
          <Tooltip key={tabMode}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent>{reason}</TooltipContent>
          </Tooltip>
        ) : (
          <span key={tabMode}>{button}</span>
        )
      })}
    </div>
  )
}
