import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Bold,
  ChevronRight,
  Code2,
  CornerDownLeft,
  FileText,
  Heading1,
  Heading2,
  HelpCircle,
  Italic,
  Link as LinkIcon,
  Maximize2,
  Minimize2,
  Quote,
  Redo2,
  Search,
  Table as TableIcon,
  Undo2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { handleEditorPairingKeyDown } from '../lib/editor-pairing'
import { MarkdownPreview } from './previews/markdown-preview'

interface MarkdownEditorProps {
  content: string
  onChange: (newContent: string) => void
}

interface HistoryEntry {
  text: string
  cursor: number
}

interface SearchMatch {
  start: number
  end: number
}

function countLines(text: string): number {
  let count = 1
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) count++
  }
  return count
}

function computeTextStats(text: string) {
  let lines = 1
  let words = 0
  let inWord = false

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 10) {
      lines++
    }
    if (code > 32) {
      if (!inWord) {
        inWord = true
        words++
      }
    } else {
      inWord = false
    }
  }

  return { lines, words, chars: text.length }
}

function generateGutterText(count: number): string {
  let res = ''
  for (let i = 1; i <= count; i++) {
    res += i + '\n'
  }
  return res
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function highlightMarkdownSearch(
  text: string,
  matches?: SearchMatch[],
  activeIndex?: number
): string {
  if (!matches || matches.length === 0) {
    return escapeHtml(text)
  }

  let result = ''
  let lastIndex = 0

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    if (match.start > lastIndex) {
      result += escapeHtml(text.substring(lastIndex, match.start))
    }

    const isActive = i === activeIndex
    const matchText = escapeHtml(text.substring(match.start, match.end))
    result += `<mark class="${
      isActive
        ? 'bg-emerald-500/40 text-foreground ring-1.5 ring-emerald-500 rounded-xs'
        : 'bg-amber-400/40 dark:bg-amber-400/30 text-foreground rounded-xs'
    }">${matchText}</mark>`

    lastIndex = match.end
  }

  if (lastIndex < text.length) {
    result += escapeHtml(text.substring(lastIndex))
  }

  return result
}

export function MarkdownEditor({ content, onChange }: MarkdownEditorProps) {
  const mainContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const gutterPreRef = useRef<HTMLPreElement>(null)
  const gutterContainerRef = useRef<HTMLDivElement>(null)
  const highlightOverlayRef = useRef<HTMLPreElement>(null)
  const previewScrollRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)

  const [previewContent, setPreviewContent] = useState(content)
  const [stats, setStats] = useState(() => computeTextStats(content))
  const [cursorCoords, setCursorCoords] = useState<{ line: number; col: number }>({
    line: 1,
    col: 1,
  })

  const [syncScroll, setSyncScroll] = useState<boolean>(true)
  const [splitPercent, setSplitPercent] = useState<number>(50)
  const [isResizing, setIsResizing] = useState<boolean>(false)
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false)

  const [showFindReplace, setShowFindReplace] = useState(false)
  const [showReplaceRow, setShowReplaceRow] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [matchWholeWord, setMatchWholeWord] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isFullscreen])

  const historyRef = useRef<HistoryEntry[]>([{ text: content, cursor: 0 }])
  const historyIndexRef = useRef<number>(0)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const isScrollingFromEditor = useRef(false)
  const isScrollingFromPreview = useRef(false)
  const rafEditorRef = useRef<number | null>(null)
  const rafPreviewRef = useRef<number | null>(null)

  const parentDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const historyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const lastLineCountRef = useRef<number>(stats.lines)
  const lastLoadedContentRef = useRef<string>(content)

  const searchRegex = useMemo(() => {
    if (!searchQuery) return null
    try {
      let pattern = searchQuery
      if (!useRegex) {
        pattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      }
      if (matchWholeWord) {
        pattern = `\\b${pattern}\\b`
      }
      const flags = matchCase ? 'g' : 'gi'
      return new RegExp(pattern, flags)
    } catch {
      return null
    }
  }, [searchQuery, matchCase, matchWholeWord, useRegex])

  const searchMatches = useMemo<SearchMatch[]>(() => {
    if (!searchRegex || !content) return []
    const matches: SearchMatch[] = []
    let match: RegExpExecArray | null
    const regex = new RegExp(searchRegex.source, searchRegex.flags)
    while ((match = regex.exec(content)) !== null) {
      if (match[0].length === 0) {
        regex.lastIndex++
        continue
      }
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
      })
    }
    return matches
  }, [content, searchRegex])

  useEffect(() => {
    if (currentMatchIndex >= searchMatches.length) {
      setCurrentMatchIndex(Math.max(0, searchMatches.length - 1))
    }
  }, [searchMatches.length, currentMatchIndex])

  const highlightedHtml = useMemo(() => {
    return highlightMarkdownSearch(
      content,
      showFindReplace ? searchMatches : undefined,
      showFindReplace ? currentMatchIndex : undefined
    )
  }, [content, showFindReplace, searchMatches, currentMatchIndex])

  const updateGutterFast = useCallback((text: string) => {
    const lines = countLines(text)
    if (lines !== lastLineCountRef.current) {
      lastLineCountRef.current = lines
      if (gutterPreRef.current) {
        gutterPreRef.current.textContent = generateGutterText(lines)
      }
    }
  }, [])

  useEffect(() => {
    if (content !== lastLoadedContentRef.current) {
      lastLoadedContentRef.current = content
      if (textareaRef.current && textareaRef.current.value !== content) {
        textareaRef.current.value = content
      }
      setPreviewContent(content)
      const newStats = computeTextStats(content)
      setStats(newStats)
      lastLineCountRef.current = newStats.lines
      if (gutterPreRef.current) {
        gutterPreRef.current.textContent = generateGutterText(newStats.lines)
      }
    }
  }, [content])

  useEffect(() => {
    if (gutterPreRef.current) {
      gutterPreRef.current.textContent = generateGutterText(stats.lines)
    }
  }, [stats.lines])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!mainContainerRef.current) return
      const rect = mainContainerRef.current.getBoundingClientRect()
      const rawPercent = ((e.clientX - rect.left) / rect.width) * 100
      const clamped = Math.min(Math.max(rawPercent, 20), 80)
      setSplitPercent(clamped)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])

  const updateHistoryState = useCallback(() => {
    setCanUndo(historyIndexRef.current > 0)
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1)
  }, [])

  const pushToHistoryImmediate = useCallback(
    (newText: string, newCursor: number) => {
      if (historyDebounceRef.current) {
        clearTimeout(historyDebounceRef.current)
        historyDebounceRef.current = null
      }

      if (historyRef.current[historyIndexRef.current]?.text === newText) return

      const nextHistory = historyRef.current.slice(0, historyIndexRef.current + 1)
      nextHistory.push({ text: newText, cursor: newCursor })
      if (nextHistory.length > 50) {
        nextHistory.shift()
      }
      historyRef.current = nextHistory
      historyIndexRef.current = nextHistory.length - 1
      updateHistoryState()
    },
    [updateHistoryState]
  )

  const pushToHistoryDebounced = useCallback(
    (newText: string, newCursor: number) => {
      if (historyDebounceRef.current) {
        clearTimeout(historyDebounceRef.current)
      }

      historyDebounceRef.current = setTimeout(() => {
        pushToHistoryImmediate(newText, newCursor)
        historyDebounceRef.current = null
      }, 500)
    },
    [pushToHistoryImmediate]
  )

  const flushPendingHistory = useCallback(() => {
    if (historyDebounceRef.current) {
      clearTimeout(historyDebounceRef.current)
      historyDebounceRef.current = null
      if (textareaRef.current) {
        const curText = textareaRef.current.value
        const curPos = textareaRef.current.selectionStart
        if (historyRef.current[historyIndexRef.current]?.text !== curText) {
          const nextHistory = historyRef.current.slice(0, historyIndexRef.current + 1)
          nextHistory.push({ text: curText, cursor: curPos })
          if (nextHistory.length > 50) nextHistory.shift()
          historyRef.current = nextHistory
          historyIndexRef.current = nextHistory.length - 1
          updateHistoryState()
        }
      }
    }
  }, [updateHistoryState])

  const updateCursorInfo = useCallback((currentText: string, pos: number) => {
    const textBefore = currentText.substring(0, pos)
    const lineNum = textBefore.split('\n').length
    const currentLineText = textBefore.split('\n').pop() || ''
    setCursorCoords({ line: lineNum, col: currentLineText.length + 1 })
  }, [])

  const handleNativeInput = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    const currentText = textarea.value
    const cursorPos = textarea.selectionStart

    updateGutterFast(currentText)
    setPreviewContent(currentText)

    if (parentDebounceRef.current) {
      clearTimeout(parentDebounceRef.current)
    }
    parentDebounceRef.current = setTimeout(() => {
      lastLoadedContentRef.current = currentText
      onChange(currentText)
      setStats(computeTextStats(currentText))
      updateCursorInfo(currentText, cursorPos)
    }, 150)

    pushToHistoryDebounced(currentText, cursorPos)
  }, [onChange, pushToHistoryDebounced, updateCursorInfo, updateGutterFast])

  const applyProgrammaticChange = useCallback(
    (newText: string, nextCursorStart: number, nextCursorEnd: number = nextCursorStart) => {
      if (textareaRef.current) {
        textareaRef.current.value = newText
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(nextCursorStart, nextCursorEnd)
      }

      updateGutterFast(newText)
      lastLoadedContentRef.current = newText
      onChange(newText)
      setPreviewContent(newText)
      setStats(computeTextStats(newText))
      updateCursorInfo(newText, nextCursorEnd)
      pushToHistoryImmediate(newText, nextCursorEnd)
    },
    [onChange, pushToHistoryImmediate, updateCursorInfo, updateGutterFast]
  )

  const handleUndo = useCallback(() => {
    flushPendingHistory()
    if (historyIndexRef.current > 0) {
      historyIndexRef.current -= 1
      const entry = historyRef.current[historyIndexRef.current]
      if (textareaRef.current) {
        textareaRef.current.value = entry.text
        textareaRef.current.setSelectionRange(entry.cursor, entry.cursor)
        textareaRef.current.focus()
      }
      updateGutterFast(entry.text)
      lastLoadedContentRef.current = entry.text
      onChange(entry.text)
      setPreviewContent(entry.text)
      setStats(computeTextStats(entry.text))
      updateCursorInfo(entry.text, entry.cursor)
      updateHistoryState()
    }
  }, [flushPendingHistory, onChange, updateCursorInfo, updateGutterFast, updateHistoryState])

  const handleRedo = useCallback(() => {
    flushPendingHistory()
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current += 1
      const entry = historyRef.current[historyIndexRef.current]
      if (textareaRef.current) {
        textareaRef.current.value = entry.text
        textareaRef.current.setSelectionRange(entry.cursor, entry.cursor)
        textareaRef.current.focus()
      }
      updateGutterFast(entry.text)
      lastLoadedContentRef.current = entry.text
      onChange(entry.text)
      setPreviewContent(entry.text)
      setStats(computeTextStats(entry.text))
      updateCursorInfo(entry.text, entry.cursor)
      updateHistoryState()
    }
  }, [flushPendingHistory, onChange, updateCursorInfo, updateGutterFast, updateHistoryState])

  const handleCut = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd

    if (start === end) {
      e.preventDefault()
      const textBefore = content.substring(0, start)
      const lineStart = textBefore.lastIndexOf('\n') + 1
      const nextNewline = content.indexOf('\n', start)
      const lineEnd = nextNewline === -1 ? content.length : nextNewline + 1
      const lineText = content.substring(lineStart, lineEnd)

      e.clipboardData.setData(
        'text/plain',
        lineText.endsWith('\n') ? lineText : lineText + '\n'
      )

      const newContent =
        content.substring(0, lineStart) + content.substring(lineEnd)
      applyProgrammaticChange(newContent, Math.min(lineStart, newContent.length), Math.min(lineStart, newContent.length))
    }
  }

  const handleCopy = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd

    if (start === end) {
      e.preventDefault()
      const textBefore = content.substring(0, start)
      const lineStart = textBefore.lastIndexOf('\n') + 1
      const nextNewline = content.indexOf('\n', start)
      const lineEnd = nextNewline === -1 ? content.length : nextNewline
      const lineText = content.substring(lineStart, lineEnd) + '\n'

      e.clipboardData.setData('text/plain', lineText)
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const pastedText =
      e.clipboardData.getData('text/plain') ||
      e.clipboardData.getData('text')

    if (!pastedText) return

    if (start === end && pastedText.endsWith('\n')) {
      e.preventDefault()
      const curContent = content
      const nextNewline = curContent.indexOf('\n', start)
      const lineEnd = nextNewline === -1 ? curContent.length : nextNewline

      const insertion = '\n' + pastedText.replace(/\n$/, '')
      const newContent =
        curContent.substring(0, lineEnd) +
        insertion +
        curContent.substring(lineEnd)

      const nextCursor = lineEnd + insertion.length
      applyProgrammaticChange(newContent, nextCursor, nextCursor)
    }
  }

  const deleteCurrentLine = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    const pos = textarea.selectionStart

    const textBefore = content.substring(0, pos)
    const lineStart = textBefore.lastIndexOf('\n') + 1
    const nextNewline = content.indexOf('\n', pos)
    const lineEnd = nextNewline === -1 ? content.length : nextNewline + 1

    const newContent =
      content.substring(0, lineStart) + content.substring(lineEnd)
    const nextCursor = Math.min(lineStart, newContent.length)
    applyProgrammaticChange(newContent, nextCursor, nextCursor)
  }

  const duplicateCurrentLine = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    const pos = textarea.selectionStart

    const textBefore = content.substring(0, pos)
    const lineStart = textBefore.lastIndexOf('\n') + 1
    const nextNewline = content.indexOf('\n', pos)
    const lineEnd = nextNewline === -1 ? content.length : nextNewline
    const currentLineText = content.substring(lineStart, lineEnd)

    const newContent =
      content.substring(0, lineEnd) +
      '\n' +
      currentLineText +
      content.substring(lineEnd)

    const nextCursor = lineEnd + 1 + (pos - lineStart)
    applyProgrammaticChange(newContent, nextCursor, nextCursor)
  }

  const moveCurrentLine = (direction: 'up' | 'down') => {
    const textarea = textareaRef.current
    if (!textarea) return
    const pos = textarea.selectionStart

    const linesArray = content.split('\n')
    const textBefore = content.substring(0, pos)
    const currentLineIndex = textBefore.split('\n').length - 1

    if (direction === 'up' && currentLineIndex === 0) return
    if (direction === 'down' && currentLineIndex === linesArray.length - 1) return

    const targetIndex =
      direction === 'up' ? currentLineIndex - 1 : currentLineIndex + 1

    const temp = linesArray[currentLineIndex]
    linesArray[currentLineIndex] = linesArray[targetIndex]
    linesArray[targetIndex] = temp

    const newContent = linesArray.join('\n')
    const newTextBefore = linesArray.slice(0, targetIndex).join('\n')
    const nextCursor =
      targetIndex === 0
        ? 0
        : newTextBefore.length + 1 + (pos - textBefore.lastIndexOf('\n') - 1)

    applyProgrammaticChange(
      newContent,
      Math.min(nextCursor, newContent.length),
      Math.min(nextCursor, newContent.length)
    )
  }

  const selectCurrentLine = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    const pos = textarea.selectionStart
    const textBefore = content.substring(0, pos)
    const lineStart = textBefore.lastIndexOf('\n') + 1
    const nextNewline = content.indexOf('\n', pos)
    const lineEnd = nextNewline === -1 ? content.length : nextNewline

    textarea.setSelectionRange(lineStart, lineEnd)
  }

  const toggleComment = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd

    const textBefore = content.substring(0, start)
    const lineStart = textBefore.lastIndexOf('\n') + 1
    const nextNewline = content.indexOf('\n', end)
    const lineEnd = nextNewline === -1 ? content.length : nextNewline

    const selectedBlock = content.substring(lineStart, lineEnd)
    const blockLines = selectedBlock.split('\n')

    const allCommented = blockLines.every(
      (line) =>
        line.trim().startsWith('<!--') && line.trim().endsWith('-->')
    )

    const modifiedBlock = blockLines
      .map((line) => {
        if (allCommented) {
          return line.replace(/^(\s*)<!--\s?/, '$1').replace(/\s?-->$/, '')
        } else {
          return `<!-- ${line} -->`
        }
      })
      .join('\n')

    const newContent =
      content.substring(0, lineStart) +
      modifiedBlock +
      content.substring(lineEnd)

    const nextEnd = lineStart + modifiedBlock.length
    applyProgrammaticChange(newContent, nextEnd, nextEnd)
  }

  const handleTextareaScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget
    if (gutterContainerRef.current) {
      gutterContainerRef.current.scrollTop = target.scrollTop
    }
    if (highlightOverlayRef.current) {
      highlightOverlayRef.current.scrollTop = target.scrollTop
      highlightOverlayRef.current.scrollLeft = target.scrollLeft
    }

    if (!syncScroll || isScrollingFromPreview.current) return

    if (rafEditorRef.current !== null) {
      cancelAnimationFrame(rafEditorRef.current)
    }

    rafEditorRef.current = requestAnimationFrame(() => {
      isScrollingFromEditor.current = true
      const preview = previewScrollRef.current

      if (preview) {
        const maxScrollEditor = target.scrollHeight - target.clientHeight
        if (maxScrollEditor > 0) {
          const ratio = target.scrollTop / maxScrollEditor
          const maxScrollPreview = preview.scrollHeight - preview.clientHeight
          preview.scrollTop = ratio * maxScrollPreview
        }
      }

      setTimeout(() => {
        isScrollingFromEditor.current = false
      }, 30)
    })
  }

  const handlePreviewScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (!syncScroll || isScrollingFromEditor.current) return

    const target = e.currentTarget
    if (rafPreviewRef.current !== null) {
      cancelAnimationFrame(rafPreviewRef.current)
    }

    rafPreviewRef.current = requestAnimationFrame(() => {
      isScrollingFromPreview.current = true
      const textarea = textareaRef.current

      if (textarea) {
        const maxScrollPreview = target.scrollHeight - target.clientHeight
        if (maxScrollPreview > 0) {
          const ratio = target.scrollTop / maxScrollPreview
          const maxScrollEditor = textarea.scrollHeight - textarea.clientHeight
          textarea.scrollTop = ratio * maxScrollEditor
          if (gutterContainerRef.current) {
            gutterContainerRef.current.scrollTop = textarea.scrollTop
          }
          if (highlightOverlayRef.current) {
            highlightOverlayRef.current.scrollTop = textarea.scrollTop
            highlightOverlayRef.current.scrollLeft = textarea.scrollLeft
          }
        }
      }

      setTimeout(() => {
        isScrollingFromPreview.current = false
      }, 30)
    })
  }

  const wrapSelection = (prefix: string, suffix: string = prefix, placeholder: string = 'text') => {
    const textarea = textareaRef.current
    if (!textarea) return

    const curText = textarea.value
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = curText.substring(start, end)

    const insertText = selected || placeholder
    const newContent =
      curText.substring(0, start) +
      prefix +
      insertText +
      suffix +
      curText.substring(end)

    const nextCursorStart = selected
      ? start + prefix.length + insertText.length + suffix.length
      : start + prefix.length
    const nextCursorEnd = selected
      ? nextCursorStart
      : start + prefix.length + insertText.length

    applyProgrammaticChange(newContent, nextCursorStart, nextCursorEnd)
  }

  const prefixLineSelection = (prefix: string) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const curText = textarea.value
    const start = textarea.selectionStart
    const end = textarea.selectionEnd

    const textBefore = curText.substring(0, start)
    const lineStart = textBefore.lastIndexOf('\n') + 1
    const nextNewline = curText.indexOf('\n', end)
    const lineEnd = nextNewline === -1 ? curText.length : nextNewline

    const selectedBlock = curText.substring(lineStart, lineEnd)
    const blockLines = selectedBlock.split('\n')

    const modifiedBlock = blockLines
      .map((line) => {
        if (line.startsWith(prefix)) {
          return line.slice(prefix.length)
        }
        return prefix + line
      })
      .join('\n')

    const newContent =
      curText.substring(0, lineStart) +
      modifiedBlock +
      curText.substring(lineEnd)

    const nextEnd = lineStart + modifiedBlock.length
    applyProgrammaticChange(newContent, nextEnd, nextEnd)
  }

  const scrollToMatch = (
    matchPos: number,
    matchEnd: number,
    focusEditor = false
  ) => {
    if (!textareaRef.current) return
    if (focusEditor) {
      textareaRef.current.focus()
    }
    textareaRef.current.setSelectionRange(matchPos, matchEnd)
    updateCursorInfo(content, matchPos)

    const linesBefore = content.substring(0, matchPos).split('\n').length
    const lineHeight = 24
    const targetScrollTop = Math.max(0, (linesBefore - 4) * lineHeight)
    textareaRef.current.scrollTop = targetScrollTop
    if (gutterContainerRef.current) gutterContainerRef.current.scrollTop = targetScrollTop
    if (highlightOverlayRef.current)
      highlightOverlayRef.current.scrollTop = targetScrollTop
  }

  const handleNextMatch = () => {
    if (searchMatches.length === 0) return
    const nextIdx = (currentMatchIndex + 1) % searchMatches.length
    setCurrentMatchIndex(nextIdx)
    const match = searchMatches[nextIdx]
    scrollToMatch(match.start, match.end, false)
  }

  const handlePrevMatch = () => {
    if (searchMatches.length === 0) return
    const prevIdx =
      (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length
    setCurrentMatchIndex(prevIdx)
    const match = searchMatches[prevIdx]
    scrollToMatch(match.start, match.end, false)
  }

  const handleReplaceOne = () => {
    if (searchMatches.length === 0 || !searchMatches[currentMatchIndex]) return
    const match = searchMatches[currentMatchIndex]
    const before = content.substring(0, match.start)
    const after = content.substring(match.end)
    const newContent = before + replaceQuery + after
    applyProgrammaticChange(newContent, match.start + replaceQuery.length)
  }

  const handleReplaceAll = () => {
    if (!searchRegex || searchMatches.length === 0) return
    const newContent = content.replace(searchRegex, replaceQuery)
    applyProgrammaticChange(newContent, textareaRef.current?.selectionStart || 0)
  }

  const openFind = (replaceMode = false) => {
    if (textareaRef.current) {
      const selStart = textareaRef.current.selectionStart
      const selEnd = textareaRef.current.selectionEnd
      if (selStart !== selEnd) {
        const selected = content.substring(selStart, selEnd)
        if (selected && !selected.includes('\n')) {
          setSearchQuery(selected)
        }
      }
    }
    setShowFindReplace(true)
    if (replaceMode) {
      setShowReplaceRow(true)
      setTimeout(() => {
        replaceInputRef.current?.focus()
        replaceInputRef.current?.select()
      }, 0)
    } else {
      setTimeout(() => {
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }, 0)
    }
  }

  const closeFind = () => {
    setShowFindReplace(false)
    textareaRef.current?.focus()
  }

  const handleSearchInputKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeFind()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) {
        handlePrevMatch()
      } else {
        handleNextMatch()
      }
      return
    }
    if (e.altKey && e.key.toLowerCase() === 'c') {
      e.preventDefault()
      setMatchCase((prev) => !prev)
      return
    }
    if (e.altKey && e.key.toLowerCase() === 'w') {
      e.preventDefault()
      setMatchWholeWord((prev) => !prev)
      return
    }
    if (e.altKey && e.key.toLowerCase() === 'r') {
      e.preventDefault()
      setUseRegex((prev) => !prev)
      return
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'h') {
      e.preventDefault()
      setShowReplaceRow((prev) => !prev)
      if (!showReplaceRow) {
        setTimeout(() => replaceInputRef.current?.focus(), 0)
      }
      return
    }
  }

  const handleReplaceInputKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeFind()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if ((e.metaKey || e.ctrlKey) && e.altKey) {
        handleReplaceAll()
      } else {
        handleReplaceOne()
      }
      return
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

    if (isCmdOrCtrl && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      openFind(false)
      return
    }

    if (isCmdOrCtrl && e.key.toLowerCase() === 'h') {
      e.preventDefault()
      openFind(true)
      return
    }

    if (isCmdOrCtrl && e.key.toLowerCase() === 'b') {
      e.preventDefault()
      wrapSelection('**', '**', 'bold text')
      return
    }

    if (isCmdOrCtrl && e.key.toLowerCase() === 'i') {
      e.preventDefault()
      wrapSelection('*', '*', 'italic text')
      return
    }

    if (isCmdOrCtrl && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      wrapSelection('[', '](https://example.com)', 'link text')
      return
    }

    if (
      isCmdOrCtrl &&
      (e.key === '/' ||
        e.key === '?' ||
        e.code === 'Slash' ||
        e.code === 'NumpadDivide' ||
        e.keyCode === 191 ||
        e.which === 191)
    ) {
      e.preventDefault()
      toggleComment()
      return
    }

    if (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      deleteCurrentLine()
      return
    }

    if (isCmdOrCtrl && e.key.toLowerCase() === 'l') {
      e.preventDefault()
      selectCurrentLine()
      return
    }

    if (isCmdOrCtrl && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      duplicateCurrentLine()
      return
    }

    if (e.altKey && e.shiftKey && e.key === 'ArrowDown') {
      e.preventDefault()
      duplicateCurrentLine()
      return
    }

    if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault()
      moveCurrentLine('up')
      return
    }

    if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault()
      moveCurrentLine('down')
      return
    }

    if (textareaRef.current) {
      const handled = handleEditorPairingKeyDown(
        e,
        textareaRef.current,
        (newContent, cursorStart, cursorEnd) => {
          applyProgrammaticChange(
            newContent,
            cursorStart ?? newContent.length,
            cursorEnd ?? cursorStart ?? newContent.length
          )
        }
      )
      if (handled) return
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      const textarea = textareaRef.current
      if (!textarea) return

      const curText = textarea.value
      const start = textarea.selectionStart
      const end = textarea.selectionEnd

      if (e.shiftKey) {
        const textBefore = curText.substring(0, start)
        const lineStart = textBefore.lastIndexOf('\n') + 1
        const lineEnd =
          curText.indexOf('\n', end) === -1
            ? curText.length
            : curText.indexOf('\n', end)
        const selectedBlock = curText.substring(lineStart, lineEnd)

        const unindented = selectedBlock
          .split('\n')
          .map((line) => line.replace(/^ {1,2}/, ''))
          .join('\n')

        const newContent =
          curText.substring(0, lineStart) +
          unindented +
          curText.substring(lineEnd)
        const nextPos = start - 2 < lineStart ? lineStart : start - 2
        applyProgrammaticChange(newContent, nextPos, nextPos)
      } else {
        const newContent =
          curText.substring(0, start) + '  ' + curText.substring(end)
        applyProgrammaticChange(newContent, start + 2, start + 2)
      }
      return
    }

    if (e.key === 'Enter') {
      const textarea = textareaRef.current
      if (!textarea) return
      const curText = textarea.value
      const start = textarea.selectionStart
      const textBefore = curText.substring(0, start)
      const currentLine = textBefore.split('\n').pop() || ''

      const listMatch = currentLine.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/)
      if (listMatch) {
        if (!listMatch[3].trim()) {
          e.preventDefault()
          const lineStart = textBefore.lastIndexOf('\n') + 1
          const newContent =
            curText.substring(0, lineStart) + curText.substring(start)
          applyProgrammaticChange(newContent, lineStart, lineStart)
          return
        }

        e.preventDefault()
        const indent = listMatch[1]
        const bullet = /^\d+\./.test(listMatch[2])
          ? `${parseInt(listMatch[2]) + 1}. `
          : `${listMatch[2]} `
        const insertion = `\n${indent}${bullet}`
        const newContent =
          curText.substring(0, start) + insertion + curText.substring(start)
        applyProgrammaticChange(newContent, start + insertion.length, start + insertion.length)
        return
      }

      const taskMatch = currentLine.match(/^(\s*)-\s+\[[ x]\]\s+(.*)$/)
      if (taskMatch) {
        if (!taskMatch[2].trim()) {
          e.preventDefault()
          const lineStart = textBefore.lastIndexOf('\n') + 1
          const newContent =
            curText.substring(0, lineStart) + curText.substring(start)
          applyProgrammaticChange(newContent, lineStart, lineStart)
          return
        }

        e.preventDefault()
        const indent = taskMatch[1]
        const insertion = `\n${indent}- [ ] `
        const newContent =
          curText.substring(0, start) + insertion + curText.substring(start)
        applyProgrammaticChange(newContent, start + insertion.length, start + insertion.length)
        return
      }
    }
  }

  const insertTableTemplate = () => {
    const table = `\n| Column 1 | Column 2 | Column 3 |\n| :--- | :--- | :--- |\n| Data 1 | Data 2 | Data 3 |\n| Data 4 | Data 5 | Data 6 |\n`
    const textarea = textareaRef.current
    if (!textarea) return
    const curText = textarea.value
    const start = textarea.selectionStart
    const newContent =
      curText.substring(0, start) + table + curText.substring(start)
    applyProgrammaticChange(newContent, start + table.length, start + table.length)
  }

  const insertCodeBlock = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    const curText = textarea.value
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = curText.substring(start, end)
    const block = `\n\`\`\`ts\n${selected || 'code here'}\n\`\`\`\n`
    const newContent =
      curText.substring(0, start) + block + curText.substring(end)
    applyProgrammaticChange(newContent, start + block.length, start + block.length)
  }

  return (
    <>
      <div
        ref={mainContainerRef}
        className={`flex flex-col lg:flex-row h-[calc(100vh-3.5rem)] w-full overflow-hidden divide-y divide-border lg:divide-y-0 ${
          isResizing ? 'select-none cursor-col-resize' : ''
        }`}
      >
        <div
          style={{ width: `${splitPercent}%` }}
          className='flex h-full flex-col bg-muted/10 overflow-hidden w-full lg:w-auto shrink-0 min-h-0'
        >
          <div className='flex items-center justify-between border-b border-border/80 bg-background/80 px-3 py-1.5 backdrop-blur-xs shrink-0'>
            <div className='flex items-center gap-1 flex-wrap'>
              <Button
                variant='ghost'
                size='icon'
                onClick={handleUndo}
                disabled={!canUndo}
                className='size-6 text-muted-foreground hover:text-foreground'
                title='Undo (⌘Z)'
              >
                <Undo2 className='size-3.5' />
              </Button>
              <Button
                variant='ghost'
                size='icon'
                onClick={handleRedo}
                disabled={!canRedo}
                className='size-6 text-muted-foreground hover:text-foreground'
                title='Redo (⌘Shift+Z / ⌘Y)'
              >
                <Redo2 className='size-3.5' />
              </Button>
              <div className='h-4 w-px bg-border/60 mx-1' />

              <Button
                variant='ghost'
                size='icon'
                onClick={() => prefixLineSelection('# ')}
                className='size-6 text-muted-foreground hover:text-foreground'
                title='Heading 1 (# )'
              >
                <Heading1 className='size-3.5' />
              </Button>
              <Button
                variant='ghost'
                size='icon'
                onClick={() => prefixLineSelection('## ')}
                className='size-6 text-muted-foreground hover:text-foreground'
                title='Heading 2 (## )'
              >
                <Heading2 className='size-3.5' />
              </Button>
              <Button
                variant='ghost'
                size='icon'
                onClick={() => wrapSelection('**', '**', 'bold text')}
                className='size-6 text-muted-foreground hover:text-foreground'
                title='Bold (⌘B)'
              >
                <Bold className='size-3.5' />
              </Button>
              <Button
                variant='ghost'
                size='icon'
                onClick={() => wrapSelection('*', '*', 'italic text')}
                className='size-6 text-muted-foreground hover:text-foreground'
                title='Italic (⌘I)'
              >
                <Italic className='size-3.5' />
              </Button>
              <div className='h-4 w-px bg-border/60 mx-1' />

              <Button
                variant='ghost'
                size='icon'
                onClick={insertCodeBlock}
                className='size-6 text-muted-foreground hover:text-foreground'
                title='Code Block (```)'
              >
                <Code2 className='size-3.5' />
              </Button>
              <Button
                variant='ghost'
                size='icon'
                onClick={() => prefixLineSelection('> ')}
                className='size-6 text-muted-foreground hover:text-foreground'
                title='Blockquote (> )'
              >
                <Quote className='size-3.5' />
              </Button>
              <Button
                variant='ghost'
                size='icon'
                onClick={insertTableTemplate}
                className='size-6 text-muted-foreground hover:text-foreground'
                title='Insert Table'
              >
                <TableIcon className='size-3.5' />
              </Button>
              <Button
                variant='ghost'
                size='icon'
                onClick={() => wrapSelection('[', '](https://example.com)', 'link text')}
                className='size-6 text-muted-foreground hover:text-foreground'
                title='Link (⌘K)'
              >
                <LinkIcon className='size-3.5' />
              </Button>
            </div>

            <div className='flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground'>
              <Button
                variant={showFindReplace ? 'secondary' : 'ghost'}
                size='icon'
                onClick={() => {
                  if (showFindReplace) {
                    closeFind()
                  } else {
                    openFind(false)
                  }
                }}
                className='size-6 text-muted-foreground hover:text-foreground'
                title='Find & Replace (⌘F)'
              >
                <Search className='size-3.5' />
              </Button>
              <Button
                variant='ghost'
                size='icon'
                onClick={() => setShowShortcutsHelp(true)}
                className='size-6 text-muted-foreground hover:text-foreground'
                title='Keyboard Shortcuts'
              >
                <HelpCircle className='size-3.5' />
              </Button>
            </div>
          </div>

          <div className='relative flex flex-1 overflow-hidden bg-background min-h-0'>
            <div
              ref={gutterContainerRef}
              className='select-none overflow-hidden border-r border-border/40 bg-muted/20 px-2.5 py-3 text-right font-mono text-xs text-muted-foreground/50 leading-6 shrink-0'
            >
              <pre ref={gutterPreRef} className='m-0 p-0 font-mono text-xs leading-6 select-none' />
            </div>

            <div className='relative flex-1 h-full overflow-hidden min-h-0'>
              <pre
                ref={highlightOverlayRef}
                aria-hidden='true'
                className={`pointer-events-none absolute inset-0 m-0 h-full w-full overflow-hidden p-3 font-mono text-xs leading-6 whitespace-pre select-none ${
                  showFindReplace ? 'text-foreground' : 'text-transparent'
                }`}
                dangerouslySetInnerHTML={{ __html: highlightedHtml + '\n' }}
              />

              <textarea
                ref={textareaRef}
                defaultValue={content}
                onInput={handleNativeInput}
                onKeyDown={handleKeyDown}
                onCut={handleCut}
                onCopy={handleCopy}
                onPaste={handlePaste}
                onScroll={handleTextareaScroll}
                onClick={() => {
                  if (textareaRef.current) {
                    updateCursorInfo(textareaRef.current.value, textareaRef.current.selectionStart)
                  }
                }}
                onKeyUp={() => {
                  if (textareaRef.current) {
                    updateCursorInfo(textareaRef.current.value, textareaRef.current.selectionStart)
                  }
                }}
                placeholder='# Write markdown documentation here...'
                spellCheck={false}
                autoCapitalize='off'
                autoComplete='off'
                autoCorrect='off'
                className={`absolute inset-0 h-full w-full resize-none bg-transparent p-3 font-mono text-xs leading-6 caret-foreground selection:bg-emerald-500/25 shadow-none outline-none focus:ring-0 whitespace-pre overflow-auto border-0 ${
                  showFindReplace ? 'text-transparent' : 'text-foreground'
                }`}
              />

              {showFindReplace && (
                <div className='absolute top-2.5 right-3 z-40 flex flex-col gap-1.5 rounded-lg border border-border/80 bg-background/95 p-1.5 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150 w-72 sm:w-88'>
                  <div className='flex items-center gap-1'>
                    <Button
                      variant='ghost'
                      size='icon'
                      onClick={() => setShowReplaceRow((prev) => !prev)}
                      className='size-6 text-muted-foreground hover:text-foreground shrink-0'
                      title={
                        showReplaceRow
                          ? 'Hide Replace (⌘H)'
                          : 'Show Replace (⌘H)'
                      }
                    >
                      <ChevronRight
                        className={`size-3.5 transition-transform ${
                          showReplaceRow ? 'rotate-90' : ''
                        }`}
                      />
                    </Button>

                    <div className='relative flex items-center flex-1 min-w-0'>
                      <Input
                        ref={searchInputRef}
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value)
                          setCurrentMatchIndex(0)
                        }}
                        onKeyDown={handleSearchInputKeyDown}
                        placeholder='Find'
                        className='h-7 pr-16 text-xs font-mono bg-muted/30 focus-visible:ring-1 focus-visible:ring-emerald-500 border-border/60'
                      />
                      <div className='absolute right-1 flex items-center gap-0.5 text-[10px]'>
                        <button
                          type='button'
                          onClick={() => setMatchCase((prev) => !prev)}
                          className={`px-1 py-0.5 rounded font-mono font-bold transition-colors ${
                            matchCase
                              ? 'bg-emerald-500 text-white'
                              : 'text-muted-foreground/60 hover:text-foreground'
                          }`}
                          title='Match Case (Alt+C)'
                        >
                          Aa
                        </button>
                        <button
                          type='button'
                          onClick={() => setMatchWholeWord((prev) => !prev)}
                          className={`px-1 py-0.5 rounded font-mono font-bold transition-colors ${
                            matchWholeWord
                              ? 'bg-emerald-500 text-white'
                              : 'text-muted-foreground/60 hover:text-foreground'
                          }`}
                          title='Match Whole Word (Alt+W)'
                        >
                          \b
                        </button>
                        <button
                          type='button'
                          onClick={() => setUseRegex((prev) => !prev)}
                          className={`px-1 py-0.5 rounded font-mono font-bold transition-colors ${
                            useRegex
                              ? 'bg-emerald-500 text-white'
                              : 'text-muted-foreground/60 hover:text-foreground'
                          }`}
                          title='Use Regular Expression (Alt+R)'
                        >
                          .*
                        </button>
                      </div>
                    </div>

                    <span className='font-mono text-[10px] text-muted-foreground px-1 shrink-0 select-none min-w-12 text-center'>
                      {searchQuery
                        ? searchMatches.length > 0
                          ? `${currentMatchIndex + 1} of ${
                              searchMatches.length
                            }`
                          : 'No results'
                        : ''}
                    </span>

                    <Button
                      variant='ghost'
                      size='icon'
                      onClick={handlePrevMatch}
                      disabled={searchMatches.length === 0}
                      className='size-6 text-muted-foreground hover:text-foreground shrink-0'
                      title='Previous Match (Shift+Enter)'
                    >
                      <ArrowUp className='size-3.5' />
                    </Button>
                    <Button
                      variant='ghost'
                      size='icon'
                      onClick={handleNextMatch}
                      disabled={searchMatches.length === 0}
                      className='size-6 text-muted-foreground hover:text-foreground shrink-0'
                      title='Next Match (Enter)'
                    >
                      <ArrowDown className='size-3.5' />
                    </Button>
                    <Button
                      variant='ghost'
                      size='icon'
                      onClick={closeFind}
                      className='size-6 text-muted-foreground hover:text-foreground shrink-0'
                      title='Close (Escape)'
                    >
                      <X className='size-3.5' />
                    </Button>
                  </div>

                  {showReplaceRow && (
                    <div className='flex items-center gap-1 pl-7 animate-in fade-in slide-in-from-top-1 duration-100'>
                      <div className='relative flex items-center flex-1 min-w-0'>
                        <Input
                          ref={replaceInputRef}
                          value={replaceQuery}
                          onChange={(e) => setReplaceQuery(e.target.value)}
                          onKeyDown={handleReplaceInputKeyDown}
                          placeholder='Replace'
                          className='h-7 text-xs font-mono bg-muted/30 focus-visible:ring-1 focus-visible:ring-emerald-500 border-border/60'
                        />
                      </div>

                      <Button
                        variant='ghost'
                        size='icon'
                        onClick={handleReplaceOne}
                        disabled={searchMatches.length === 0}
                        className='size-6 text-muted-foreground hover:text-foreground shrink-0'
                        title='Replace One (Enter in Replace)'
                      >
                        <CornerDownLeft className='size-3.5' />
                      </Button>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={handleReplaceAll}
                        disabled={searchMatches.length === 0}
                        className='h-6 px-1.5 text-[10px] font-mono text-muted-foreground hover:text-foreground shrink-0'
                        title='Replace All (⌘+Alt+Enter / Ctrl+Alt+Enter)'
                      >
                        All
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className='flex items-center justify-between border-t border-border/70 bg-muted/30 px-3 py-1.5 text-[11px] font-mono text-muted-foreground shrink-0'>
            <div className='flex items-center gap-3'>
              <span>
                {stats.words} {stats.words === 1 ? 'word' : 'words'} · {stats.chars} chars
              </span>
              <div className='h-3 w-px bg-border/80' />
              <span>
                Ln {cursorCoords.line}, Col {cursorCoords.col}
              </span>
              <div className='h-3 w-px bg-border/80' />
              <span>{stats.lines} lines</span>
            </div>

            <div className='flex items-center gap-2'>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => setSyncScroll((prev) => !prev)}
                className={`h-5.5 gap-1.5 px-2 text-[10px] font-medium transition-all ${
                  syncScroll
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
                title='Toggle bidirectional scroll sync between editor and preview'
              >
                <ArrowDownUp className='size-3' />
                <span>Sync Scroll</span>
                <span
                  className={`size-1.5 rounded-full ${
                    syncScroll ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/50'
                  }`}
                />
              </Button>
            </div>
          </div>
        </div>

        <div
          onMouseDown={(e) => {
            e.preventDefault()
            setIsResizing(true)
          }}
          className={`group relative hidden lg:flex w-1.5 cursor-col-resize items-center justify-center bg-border/60 hover:bg-primary/50 transition-colors z-20 select-none shrink-0 ${
            isResizing ? 'bg-primary ring-2 ring-primary/20' : ''
          }`}
        >
          <div className='absolute -inset-x-1.5 inset-y-0 cursor-col-resize' />
          <div className='h-8 w-0.5 rounded-full bg-muted-foreground/40 group-hover:bg-primary-foreground transition-colors' />
        </div>

        <div
          style={isFullscreen ? undefined : { width: `${100 - splitPercent}%` }}
          className={`flex h-full flex-col bg-background overflow-hidden w-full lg:w-auto shrink-0 flex-1 min-h-0 ${
            isFullscreen ? 'fixed inset-0 z-50 h-screen w-screen' : ''
          }`}
        >
          <div className='flex items-center justify-between border-b border-border/60 bg-muted/20 px-4 py-2 text-xs font-medium text-muted-foreground shrink-0'>
            <div className='flex items-center gap-2'>
              <FileText className='size-3.5 text-blue-500' />
              <span>LIVE PREVIEW</span>
            </div>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setIsFullscreen((prev) => !prev)}
              className='h-6 gap-1.5 px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground'
              title={isFullscreen ? 'Exit Fullscreen (Esc)' : 'Fullscreen Preview'}
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className='size-3.5' />
                  <span>Exit Fullscreen</span>
                </>
              ) : (
                <>
                  <Maximize2 className='size-3.5' />
                  <span>Fullscreen</span>
                </>
              )}
            </Button>
          </div>
          <div className='flex-1 overflow-hidden min-h-0'>
            <MarkdownPreview
              content={previewContent}
              scrollRef={previewScrollRef}
              onScroll={handlePreviewScroll}
            />
          </div>
        </div>
      </div>

      <Dialog open={showShortcutsHelp} onOpenChange={setShowShortcutsHelp}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle className='text-base font-bold'>
              Markdown Editor Keyboard Shortcuts
            </DialogTitle>
          </DialogHeader>
          <div className='space-y-2 text-xs'>
            <div className='flex items-center justify-between border-b border-border/40 py-1.5'>
              <span className='text-muted-foreground'>Undo</span>
              <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                ⌘ + Z / Ctrl + Z
              </kbd>
            </div>
            <div className='flex items-center justify-between border-b border-border/40 py-1.5'>
              <span className='text-muted-foreground'>Redo</span>
              <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                ⌘ + Shift + Z / ⌘ + Y
              </kbd>
            </div>
            <div className='flex items-center justify-between border-b border-border/40 py-1.5'>
              <span className='text-muted-foreground'>Bold / Italic / Link</span>
              <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                ⌘ + B / ⌘ + I / ⌘ + K
              </kbd>
            </div>
            <div className='flex items-center justify-between border-b border-border/40 py-1.5'>
              <span className='text-muted-foreground'>Toggle comment</span>
              <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                ⌘ + / / Ctrl + /
              </kbd>
            </div>
            <div className='flex items-center justify-between border-b border-border/40 py-1.5'>
              <span className='text-muted-foreground'>Cut entire line (no selection)</span>
              <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                ⌘ + X / Ctrl + X
              </kbd>
            </div>
            <div className='flex items-center justify-between border-b border-border/40 py-1.5'>
              <span className='text-muted-foreground'>Copy entire line (no selection)</span>
              <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                ⌘ + C / Ctrl + C
              </kbd>
            </div>
            <div className='flex items-center justify-between border-b border-border/40 py-1.5'>
              <span className='text-muted-foreground'>Duplicate line down</span>
              <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                Option + Shift + ↓ / ⌘ + D
              </kbd>
            </div>
            <div className='flex items-center justify-between border-b border-border/40 py-1.5'>
              <span className='text-muted-foreground'>Move line up / down</span>
              <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                Option + ↑ / Option + ↓
              </kbd>
            </div>
            <div className='flex items-center justify-between border-b border-border/40 py-1.5'>
              <span className='text-muted-foreground'>Delete current line</span>
              <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                ⌘ + Shift + K / Ctrl + Shift + K
              </kbd>
            </div>
            <div className='flex items-center justify-between border-b border-border/40 py-1.5'>
              <span className='text-muted-foreground'>Select current line</span>
              <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                ⌘ + L / Ctrl + L
              </kbd>
            </div>
            <div className='flex items-center justify-between border-b border-border/40 py-1.5'>
              <span className='text-muted-foreground'>Find</span>
              <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                ⌘ + F / Ctrl + F
              </kbd>
            </div>
            <div className='flex items-center justify-between border-b border-border/40 py-1.5'>
              <span className='text-muted-foreground'>Replace</span>
              <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                ⌘ + H / Ctrl + H
              </kbd>
            </div>
            <div className='flex items-center justify-between border-b border-border/40 py-1.5'>
              <span className='text-muted-foreground'>Next / Previous Match</span>
              <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                Enter / Shift + Enter
              </kbd>
            </div>
            <div className='flex items-center justify-between py-1.5'>
              <span className='text-muted-foreground'>Toggle Search Options (Case/Word/Regex)</span>
              <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                Alt + C / Alt + W / Alt + R
              </kbd>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
