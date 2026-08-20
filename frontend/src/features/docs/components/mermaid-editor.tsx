import React, { useRef, useState } from 'react'
import { handleEditorPairingKeyDown } from '../lib/editor-pairing'
import { MermaidPreview } from './previews/mermaid-preview'

interface MermaidEditorProps {
  content: string
  onChange: (newContent: string) => void
}

interface HistoryEntry {
  text: string
  cursor: number
}

export function MermaidEditor({ content, onChange }: MermaidEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([
    { text: content, cursor: 0 },
  ])
  const [historyIndex, setHistoryIndex] = useState(0)

  const pushHistory = (newText: string, cursor: number) => {
    setHistory((prev) => {
      const next = prev.slice(0, historyIndex + 1)
      return [...next, { text: newText, cursor }]
    })
    setHistoryIndex((prev) => prev + 1)
  }

  const applyChange = (
    newText: string,
    cursorStart?: number,
    cursorEnd?: number
  ) => {
    onChange(newText)
    const targetStart = cursorStart ?? newText.length
    const targetEnd = cursorEnd ?? targetStart
    pushHistory(newText, targetEnd)

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(targetStart, targetEnd)
      }
    }, 0)
  }

  const handleUndo = () => {
    if (historyIndex > 0) {
      const nextIdx = historyIndex - 1
      const entry = history[nextIdx]
      setHistoryIndex(nextIdx)
      onChange(entry.text)
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          textareaRef.current.setSelectionRange(entry.cursor, entry.cursor)
        }
      }, 0)
    }
  }

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const nextIdx = historyIndex + 1
      const entry = history[nextIdx]
      setHistoryIndex(nextIdx)
      onChange(entry.text)
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          textareaRef.current.setSelectionRange(entry.cursor, entry.cursor)
        }
      }, 0)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isCmdOrCtrl = e.metaKey || e.ctrlKey

    if (isCmdOrCtrl && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) {
        handleRedo()
      } else {
        handleUndo()
      }
      return
    }

    if (isCmdOrCtrl && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      handleRedo()
      return
    }

    if (textareaRef.current) {
      const handled = handleEditorPairingKeyDown(
        e,
        textareaRef.current,
        (newContent, cursorStart, cursorEnd) => {
          applyChange(newContent, cursorStart, cursorEnd)
        }
      )
      if (handled) return
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      const textarea = textareaRef.current
      if (!textarea) return

      const start = textarea.selectionStart
      const end = textarea.selectionEnd

      if (e.shiftKey) {
        const textBefore = content.substring(0, start)
        const lineStart = textBefore.lastIndexOf('\n') + 1
        const lineEnd =
          content.indexOf('\n', end) === -1
            ? content.length
            : content.indexOf('\n', end)
        const selectedBlock = content.substring(lineStart, lineEnd)

        const unindented = selectedBlock
          .split('\n')
          .map((line) => line.replace(/^ {1,2}/, ''))
          .join('\n')

        const newContent =
          content.substring(0, lineStart) + unindented + content.substring(lineEnd)
        const diff = selectedBlock.length - unindented.length
        applyChange(newContent, Math.max(lineStart, start - 2), Math.max(lineStart, end - diff))
      } else if (start !== end) {
        const textBefore = content.substring(0, start)
        const lineStart = textBefore.lastIndexOf('\n') + 1
        const lineEnd =
          content.indexOf('\n', end) === -1
            ? content.length
            : content.indexOf('\n', end)
        const selectedBlock = content.substring(lineStart, lineEnd)

        const indented = selectedBlock
          .split('\n')
          .map((line) => '  ' + line)
          .join('\n')

        const newContent =
          content.substring(0, lineStart) + indented + content.substring(lineEnd)
        const linesCount = selectedBlock.split('\n').length
        applyChange(newContent, start + 2, end + linesCount * 2)
      } else {
        const newContent =
          content.substring(0, start) + '  ' + content.substring(start)
        applyChange(newContent, start + 2, start + 2)
      }
    }
  }

  return (
    <div className='grid h-[calc(100vh-3.5rem)] w-full grid-cols-1 divide-y divide-border lg:grid-cols-2 lg:divide-x lg:divide-y-0'>
      <div className='flex h-full flex-col bg-muted/10 p-4'>
        <div className='mb-2 flex items-center justify-between text-xs text-muted-foreground font-medium'>
          <span>MERMAID CODE EDITOR</span>
          <span>Mermaid Syntax</span>
        </div>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => {
            const nextVal = e.target.value
            onChange(nextVal)
            pushHistory(nextVal, e.target.selectionStart)
          }}
          onKeyDown={handleKeyDown}
          placeholder='graph TD&#10;  A[Start] --> B[Process]'
          className='h-full w-full resize-none rounded-lg border border-purple-500/30 bg-background p-4 font-mono text-xs leading-relaxed text-foreground shadow-2xs outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/40'
        />
      </div>

      <div className='flex h-full flex-col bg-background'>
        <div className='border-b border-border/60 bg-muted/20 px-4 py-2 text-xs font-medium text-muted-foreground'>
          LIVE FLOWCHART RENDERER
        </div>
        <div className='flex-1 overflow-hidden'>
          <MermaidPreview content={content} />
        </div>
      </div>
    </div>
  )
}
