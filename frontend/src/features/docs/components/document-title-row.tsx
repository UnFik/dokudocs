import { forwardRef, useEffect, useState } from 'react'

/** The title as the first line of the page. Enter or Arrow Down moves into the text. */
export const DocumentTitleRow = forwardRef<
  HTMLInputElement,
  {
    title: string
    readOnly: boolean
    onCommit: (title: string) => void
    onEnterBody: () => void
  }
>(function DocumentTitleRow({ title, readOnly, onCommit, onEnterBody }, ref) {
  const [value, setValue] = useState(title)
  useEffect(() => setValue(title), [title])

  const commit = () => {
    const next = value.trim()
    if (!next) {
      setValue(title)
      return
    }
    if (next !== title) onCommit(next)
  }

  return (
    <input
      ref={ref}
      aria-label='Document title'
      className='mb-1 w-full border-0 bg-transparent p-0 text-center text-3xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground read-only:cursor-default'
      value={value}
      readOnly={readOnly}
      placeholder='Untitled'
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter' || event.key === 'ArrowDown') {
          event.preventDefault()
          onEnterBody()
        } else if (event.key === 'Escape') {
          setValue(title)
        }
      }}
    />
  )
})
