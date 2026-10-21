import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

const textClass = 'w-full rounded-[4px] px-2 text-left text-[12.5px]'

/**
 * A field that reads as text and opens as an input when clicked, so a long
 * value takes its place in the panel instead of pushing the rest down. It writes
 * while typing, like the inputs it replaces. Enter (Ctrl+Enter in a multi-line
 * field) or leaving the field closes it and keeps the text; Escape puts the old
 * text back.
 */
export function InlineField({
  id,
  value,
  onChange,
  canEdit,
  placeholder,
  multiline = false,
  type = 'text',
}: {
  id: string
  value: string
  onChange: (value: string) => void
  canEdit: boolean
  placeholder?: string
  multiline?: boolean
  type?: 'text' | 'url'
}) {
  const [editing, setEditing] = useState(false)
  const start = useRef(value)
  const refocus = useRef(false)
  const button = useRef<HTMLButtonElement>(null)
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) {
      const el = field.current
      el?.focus()
      el?.setSelectionRange(el.value.length, el.value.length)
    } else if (refocus.current) {
      refocus.current = false
      button.current?.focus()
    }
  }, [editing])

  const display = cn(
    textClass,
    multiline ? 'line-clamp-2 py-1.5 whitespace-pre-line' : 'truncate py-[7px]',
    value ? '' : 'text-muted-foreground'
  )
  const shown = value || placeholder || ''

  if (!canEdit)
    return (
      <p id={id} className={cn(display, 'break-words')} title={value}>
        {shown}
      </p>
    )

  if (!editing)
    return (
      <button
        ref={button}
        id={id}
        type='button'
        // The field's label and its value, so a screen reader hears both.
        aria-labelledby={`${id}-label ${id}`}
        title={value || undefined}
        className={cn(
          display,
          'min-h-8 border border-transparent transition-colors hover:border-input hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-signal'
        )}
        onClick={() => {
          start.current = value
          setEditing(true)
        }}
      >
        {shown}
      </button>
    )

  const close = (keepFocus: boolean) => {
    refocus.current = keepFocus
    setEditing(false)
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onChange(start.current)
      close(true)
    } else if (
      event.key === 'Enter' &&
      (!multiline || event.ctrlKey || event.metaKey)
    ) {
      event.preventDefault()
      close(true)
    }
  }
  const shared = {
    id,
    ref: field,
    value,
    placeholder,
    onBlur: () => close(false),
    onKeyDown,
  }
  return multiline ? (
    <Textarea
      {...shared}
      onChange={(e) => onChange(e.target.value)}
      className='min-h-16 text-[12.5px]'
    />
  ) : (
    <Input
      {...shared}
      type={type}
      onChange={(e) => onChange(e.target.value)}
      className='h-8 text-[12.5px]'
    />
  )
}
