import { useRef } from 'react'
import { ChevronDown, Edit3, Eye, FilePenLine } from 'lucide-react'
import type { MarkdownPreviewMode } from '@/stores/editor-preference-store'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

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

/** The current mode on a button; the menu lists all three and says why one is unavailable. */
export function EditorModeTabs({
  mode,
  states,
  onChange,
}: {
  mode: EditorMode
  states: ModeTabStates
  onChange: (mode: EditorMode) => void
}) {
  const current = tabs.find((tab) => tab.mode === mode) ?? tabs[0]!
  const CurrentIcon = current.icon
  const chose = useRef(false)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type='button'
          variant='outline'
          size='sm'
          aria-label={`Editor mode: ${current.label}`}
          className='h-11 gap-1.5 text-[13px] md:h-8'
        >
          <CurrentIcon className='size-3.5' aria-hidden />
          {current.label}
          <ChevronDown className='size-3.5 opacity-60' aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        className='w-64'
        // After a choice the page takes focus back (the editor), not this button.
        onCloseAutoFocus={(event) => {
          if (chose.current) event.preventDefault()
          chose.current = false
        }}
      >
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(value) => {
            chose.current = true
            onChange(value as EditorMode)
          }}
        >
          {tabs.map(({ mode: tabMode, label, icon: Icon }) => {
            const reason = states[tabMode].disabledReason
            return (
              <DropdownMenuRadioItem
                key={tabMode}
                value={tabMode}
                disabled={Boolean(reason)}
                aria-label={label}
                aria-describedby={reason ? `mode-${tabMode}-reason` : undefined}
                className='min-h-11 flex-col items-start gap-0 md:min-h-8'
              >
                <span className='flex items-center gap-2'>
                  <Icon className='size-3.5' aria-hidden />
                  {label}
                </span>
                {reason ? (
                  <span
                    id={`mode-${tabMode}-reason`}
                    className='text-xs text-muted-foreground'
                  >
                    {reason}
                  </span>
                ) : null}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
