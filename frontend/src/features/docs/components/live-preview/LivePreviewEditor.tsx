import { useRef } from 'react'
import { EditorState } from '@codemirror/state'
import {
  EditorView,
  keymap,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { Table, TaskList, Strikethrough, GFM } from '@lezer/markdown'
import { useMountEffect } from '@/hooks/use-mount-effect'
import { livePreviewPlugin } from './live-preview-plugin'
import { baseTheme, markdownHighlightStyle } from './theme'

interface LivePreviewEditorProps {
  content: string
  onChange: (value: string) => void
  readOnly?: boolean
  className?: string
}

export function LivePreviewEditor({
  content,
  onChange,
  readOnly = false,
  className = '',
}: LivePreviewEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const isUpdatingFromPropRef = useRef(false)
  const lastEmittedValueRef = useRef(content)

  useMountEffect(() => {
    if (!containerRef.current) return

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !isUpdatingFromPropRef.current) {
        const newValue = update.state.doc.toString()
        lastEmittedValueRef.current = newValue
        onChange(newValue)
      }
    })

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        markdown({
          extensions: [Table, TaskList, Strikethrough, GFM],
        }),
        markdownHighlightStyle,
        livePreviewPlugin,
        baseTheme,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        updateListener,
        EditorView.editable.of(!readOnly),
        EditorView.lineWrapping,
      ],
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  })

  if (viewRef.current) {
    if (content !== lastEmittedValueRef.current) {
      isUpdatingFromPropRef.current = true
      const view = viewRef.current
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: content,
        },
      })
      lastEmittedValueRef.current = content
      isUpdatingFromPropRef.current = false
    }
  }

  return (
    <div
      ref={containerRef}
      className={`h-full w-full overflow-auto bg-background text-foreground ${className}`}
    />
  )
}
