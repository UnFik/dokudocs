import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Code,
  CornerDownLeft,
  Database,
  HelpCircle,
  Maximize2,
  Minimize2,
  Redo2,
  Search,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react'
import {
  DbmlSuggestion,
  getDbmlSuggestions,
} from '../lib/dbml-intellisense'
import { handleEditorPairingKeyDown } from '../lib/editor-pairing'
import { highlightDbml, SearchMatch } from '../lib/dbml-tokenizer'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { DbmlVisualCanvas } from './previews/dbml-visual-canvas'

interface DbmlEditorProps {
  docId?: string
  content: string
  onChange: (newContent: string) => void
}

interface HistoryEntry {
  text: string
  cursor: number
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

export function DbmlEditor({ docId, content, onChange }: DbmlEditorProps) {
  const mainContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const highlightOverlayRef = useRef<HTMLPreElement>(null)
  const suggestionsListRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)

  const stats = useMemo(() => computeTextStats(content), [content])

  const [splitPercent, setSplitPercent] = useState<number>(50)
  const [isResizing, setIsResizing] = useState<boolean>(false)

  const [cursorPos, setCursorPos] = useState(0)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [cursorCoords, setCursorCoords] = useState<{ line: number; col: number }>({
    line: 1,
    col: 1,
  })

  const historyRef = useRef<HistoryEntry[]>([{ text: content, cursor: 0 }])
  const historyIndexRef = useRef<number>(0)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const [showFindReplace, setShowFindReplace] = useState(false)
  const [showReplaceRow, setShowReplaceRow] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [matchWholeWord, setMatchWholeWord] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const handleWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false)
      }
    }
    window.addEventListener('keydown', handleWindowKeyDown)
    return () => window.removeEventListener('keydown', handleWindowKeyDown)
  }, [isFullscreen])

  const lineCount = useMemo(() => {
    let count = 1
    for (let i = 0; i < content.length; i++) {
      if (content.charCodeAt(i) === 10) count++
    }
    return count
  }, [content])

  const gutterNumbersText = useMemo(() => {
    let res = ''
    for (let i = 1; i <= lineCount; i++) {
      res += i + '\n'
    }
    return res
  }, [lineCount])

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
    return highlightDbml(
      content,
      showFindReplace ? searchMatches : undefined,
      showFindReplace ? currentMatchIndex : undefined
    )
  }, [content, showFindReplace, searchMatches, currentMatchIndex])

  const { suggestions, replaceStart } = useMemo(() => {
    return getDbmlSuggestions(content, cursorPos)
  }, [content, cursorPos])

  useEffect(() => {
    setSelectedIndex(0)
  }, [suggestions])

  useEffect(() => {
    if (showSuggestions && suggestionsListRef.current) {
      const activeEl = suggestionsListRef.current.children[
        selectedIndex
      ] as HTMLElement
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedIndex, showSuggestions])

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

  const updateHistoryState = () => {
    setCanUndo(historyIndexRef.current > 0)
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1)
  }

  const pushToHistoryImmediate = (newText: string, newCursor: number) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
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
  }

  const pushToHistoryDebounced = (newText: string, newCursor: number) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    debounceTimerRef.current = setTimeout(() => {
      pushToHistoryImmediate(newText, newCursor)
      debounceTimerRef.current = null
    }, 450)
  }

  const flushPendingHistory = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
      if (textareaRef.current) {
        const curPos = textareaRef.current.selectionStart
        if (historyRef.current[historyIndexRef.current]?.text !== content) {
          const nextHistory = historyRef.current.slice(0, historyIndexRef.current + 1)
          nextHistory.push({ text: content, cursor: curPos })
          if (nextHistory.length > 50) nextHistory.shift()
          historyRef.current = nextHistory
          historyIndexRef.current = nextHistory.length - 1
          updateHistoryState()
        }
      }
    }
  }

  const handleUndo = () => {
    flushPendingHistory()
    if (historyIndexRef.current > 0) {
      historyIndexRef.current -= 1
      const entry = historyRef.current[historyIndexRef.current]
      onChange(entry.text)
      updateHistoryState()
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          textareaRef.current.setSelectionRange(entry.cursor, entry.cursor)
          updateCursorInfo(entry.text, entry.cursor)
        }
      }, 0)
    }
  }

  const handleRedo = () => {
    flushPendingHistory()
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current += 1
      const entry = historyRef.current[historyIndexRef.current]
      onChange(entry.text)
      updateHistoryState()
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          textareaRef.current.setSelectionRange(entry.cursor, entry.cursor)
          updateCursorInfo(entry.text, entry.cursor)
        }
      }, 0)
    }
  }

  const updateCursorInfo = (currentText: string = content, explicitPos?: number) => {
    const pos =
      explicitPos !== undefined
        ? explicitPos
        : textareaRef.current?.selectionStart ?? 0
    setCursorPos(pos)

    const textBefore = currentText.substring(0, pos)
    const lineNum = textBefore.split('\n').length
    const currentLineText = textBefore.split('\n').pop() || ''
    setCursorCoords({ line: lineNum, col: currentLineText.length + 1 })
  }

  const handleTextareaScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = e.currentTarget.scrollTop
    }
    if (highlightOverlayRef.current) {
      highlightOverlayRef.current.scrollTop = e.currentTarget.scrollTop
      highlightOverlayRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
  }

  const applyTextChange = (
    newText: string,
    nextCursor: number,
    isImmediate: boolean = true,
    shouldFocus: boolean = true
  ) => {
    onChange(newText)
    if (isImmediate) {
      pushToHistoryImmediate(newText, nextCursor)
    } else {
      pushToHistoryDebounced(newText, nextCursor)
    }

    setTimeout(() => {
      if (textareaRef.current) {
        if (shouldFocus) {
          textareaRef.current.focus()
        }
        textareaRef.current.setSelectionRange(nextCursor, nextCursor)
        setCursorPos(nextCursor)
        updateCursorInfo(newText, nextCursor)
      }
    }, 0)
  }

  const applyTextChangeWithSelection = (
    newText: string,
    nextStart: number,
    nextEnd: number = nextStart,
    isImmediate: boolean = true
  ) => {
    onChange(newText)
    if (isImmediate) {
      pushToHistoryImmediate(newText, nextEnd)
    } else {
      pushToHistoryDebounced(newText, nextEnd)
    }

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(nextStart, nextEnd)
        setCursorPos(nextEnd)
        updateCursorInfo(newText, nextEnd)
      }
    }, 0)
  }

  const insertTextAtCursor = (
    textToInsert: string,
    replaceFromPos: number = cursorPos,
    cursorOffset?: number
  ) => {
    if (!textareaRef.current) return
    const before = content.substring(0, replaceFromPos)
    const after = content.substring(cursorPos)

    const cleanInsertText = textToInsert.replace(/\$\{\d+:?([^}]*)\}/g, '$1')
    const newContent = before + cleanInsertText + after
    const nextPos =
      before.length +
      (cursorOffset !== undefined ? cursorOffset : cleanInsertText.length)

    applyTextChange(newContent, nextPos, true)
  }

  const applySuggestion = (suggestion: DbmlSuggestion) => {
    insertTextAtCursor(suggestion.insertText, replaceStart)
    setShowSuggestions(false)
  }

  const toggleLineComment = () => {
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
    const nonBlankLines = blockLines.filter((l) => l.trim().length > 0)
    const allCommented =
      nonBlankLines.length > 0 &&
      nonBlankLines.every((l) => l.trimStart().startsWith('//'))

    let modifiedLines: string[]
    if (allCommented) {
      modifiedLines = blockLines.map((l) =>
        l.replace(/^(\s*)\/\/\s?/, '$1')
      )
    } else {
      modifiedLines = blockLines.map((l) => {
        if (!l.trim()) return l
        const match = l.match(/^(\s*)(.*)$/)
        if (match) {
          return `${match[1]}// ${match[2]}`
        }
        return `// ${l}`
      })
    }

    const modifiedBlock = modifiedLines.join('\n')
    const newContent =
      content.substring(0, lineStart) +
      modifiedBlock +
      content.substring(lineEnd)

    const nextStart =
      start === end
        ? Math.max(lineStart, start + (allCommented ? -3 : 3))
        : lineStart
    const nextEnd =
      start === end
        ? nextStart
        : lineStart + modifiedBlock.length

    applyTextChange(newContent, nextEnd, true)
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(nextStart, nextEnd)
      }
    }, 10)
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
    applyTextChange(newContent, nextCursor, true)
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
    applyTextChange(newContent, nextCursor, true)
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
      targetIndex === 0 ? 0 : newTextBefore.length + 1 + (pos - textBefore.lastIndexOf('\n') - 1)

    applyTextChange(newContent, Math.min(nextCursor, newContent.length), true)
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
      applyTextChange(newContent, Math.min(lineStart, newContent.length), true)
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
      applyTextChange(newContent, nextCursor, true)
    }
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
    if (gutterRef.current) gutterRef.current.scrollTop = targetScrollTop
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
    applyTextChange(newContent, match.start + replaceQuery.length, true, false)
  }

  const handleReplaceAll = () => {
    if (!searchRegex || searchMatches.length === 0) return
    const newContent = content.replace(searchRegex, replaceQuery)
    applyTextChange(newContent, cursorPos, true, false)
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
      toggleLineComment()
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

    if (isCmdOrCtrl && (e.code === 'Space' || e.key === ' ')) {
      e.preventDefault()
      setShowSuggestions((prev) => !prev)
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

    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % suggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(
          (prev) => (prev - 1 + suggestions.length) % suggestions.length
        )
        return
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault()
        applySuggestion(suggestions[selectedIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowSuggestions(false)
        return
      }
    }

    if (textareaRef.current) {
      const handled = handleEditorPairingKeyDown(
        e,
        textareaRef.current,
        (newContent, cursorStart, cursorEnd) => {
          applyTextChangeWithSelection(
            newContent,
            cursorStart ?? 0,
            cursorEnd ?? cursorStart ?? 0,
            true
          )
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
          content.substring(0, lineStart) +
          unindented +
          content.substring(lineEnd)
        applyTextChange(
          newContent,
          start - 2 < lineStart ? lineStart : start - 2,
          true
        )
      } else {
        const newContent =
          content.substring(0, start) + '  ' + content.substring(end)
        applyTextChange(newContent, start + 2, true)
      }
      return
    }

    if (e.key === 'Enter') {
      const textarea = textareaRef.current
      if (!textarea) return
      const start = textarea.selectionStart
      const textBefore = content.substring(0, start)
      const currentLine = textBefore.split('\n').pop() || ''
      const matchIndent = currentLine.match(/^(\s*)/)
      let indent = matchIndent ? matchIndent[1] : ''

      if (currentLine.trim().endsWith('{')) {
        indent += '  '
      }

      e.preventDefault()
      const newContent =
        content.substring(0, start) + '\n' + indent + content.substring(start)
      applyTextChange(newContent, start + 1 + indent.length, true)
      return
    }

    if (isCmdOrCtrl && e.key === ' ') {
      e.preventDefault()
      setShowSuggestions((prev) => !prev)
      return
    }

    if (e.key === '{') {
      e.preventDefault()
      const textarea = textareaRef.current
      if (!textarea) return
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const newContent =
        content.substring(0, start) + '{}' + content.substring(end)
      applyTextChange(newContent, start + 1, true)
      return
    }

    if (e.key === '[') {
      e.preventDefault()
      const textarea = textareaRef.current
      if (!textarea) return
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const newContent =
        content.substring(0, start) + '[]' + content.substring(end)
      applyTextChange(newContent, start + 1, true)
      return
    }

    if (e.key === '.') {
      setTimeout(() => {
        setShowSuggestions(true)
      }, 0)
    }
  }

  const formatCode = () => {
    const formatted = content
      .split('\n')
      .map((line) => {
        const trimmed = line.trim()
        if (
          trimmed.startsWith('Table ') ||
          trimmed.startsWith('Enum ') ||
          trimmed.startsWith('TableGroup ') ||
          trimmed.startsWith('Project ')
        ) {
          return trimmed
        }
        if (trimmed === '}') {
          return '}'
        }
        if (trimmed && !trimmed.startsWith('//')) {
          return '  ' + trimmed
        }
        return trimmed
      })
      .join('\n')

    applyTextChange(formatted, cursorPos, true)
  }

  return (
    <>
      <div
        ref={mainContainerRef}
        className={`relative flex flex-col overflow-hidden bg-background ${
          isFullscreen ? 'fixed inset-0 z-50 h-screen w-screen p-3 bg-background' : 'h-full w-full'
        }`}
      >

      <div className='relative flex flex-1 overflow-hidden'>
        <div
          style={{ width: `${splitPercent}%` }}
          className='relative flex flex-col border-r bg-background'
        >
          <div className='flex items-center justify-between border-b border-border/60 bg-muted/20 px-3 py-1.5'>
            <div className='flex items-center gap-1'>
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
                size='sm'
                onClick={formatCode}
                className='h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground'
                title='Beautify schema code'
              >
                <Sparkles className='size-3' />
                <span>Format</span>
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

          <div className='relative flex flex-1 overflow-hidden bg-background'>
            <div
              ref={gutterRef}
              className='select-none overflow-hidden border-r border-border/40 bg-muted/20 px-2.5 py-3 text-right font-mono text-xs text-muted-foreground/50 leading-6 shrink-0'
            >
              <pre className='m-0 p-0 font-mono text-xs leading-6 select-none'>
                {gutterNumbersText}
              </pre>
            </div>

            <div className='relative flex-1 h-full overflow-hidden'>
              <pre
                ref={highlightOverlayRef}
                aria-hidden='true'
                className='pointer-events-none absolute inset-0 m-0 h-full w-full overflow-hidden p-3 font-mono text-xs leading-6 text-foreground whitespace-pre select-none'
                dangerouslySetInnerHTML={{ __html: highlightedHtml + '\n' }}
              />

              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => {
                  applyTextChange(e.target.value, e.target.selectionStart, false)
                }}
                onKeyDown={handleKeyDown}
                onCut={handleCut}
                onCopy={handleCopy}
                onPaste={handlePaste}
                onScroll={handleTextareaScroll}
                onClick={() => updateCursorInfo(content)}
                onKeyUp={() => updateCursorInfo(content)}
                placeholder='Table users { id int [pk] ... }'
                spellCheck={false}
                autoCapitalize='off'
                autoComplete='off'
                autoCorrect='off'
                className='absolute inset-0 h-full w-full resize-none bg-transparent p-3 font-mono text-xs leading-6 text-transparent caret-foreground selection:bg-emerald-500/25 shadow-none outline-none focus:ring-0 whitespace-pre overflow-auto border-0'
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
                        placeholder='Find...'
                        className='h-7 pr-20 pl-2 text-xs font-mono bg-muted/40'
                        autoFocus
                      />

                      <div className='absolute right-1 flex items-center gap-0.5'>
                        <button
                          type='button'
                          onClick={() => setMatchCase((prev) => !prev)}
                          className={`size-5 rounded flex items-center justify-center text-[10px] font-mono font-bold transition-all cursor-pointer ${
                            matchCase
                              ? 'bg-primary text-primary-foreground shadow-2xs'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                          }`}
                          title='Match Case (Alt+C)'
                        >
                          Aa
                        </button>
                        <button
                          type='button'
                          onClick={() => setMatchWholeWord((prev) => !prev)}
                          className={`size-5 rounded flex items-center justify-center text-[10px] font-mono font-bold transition-all cursor-pointer ${
                            matchWholeWord
                              ? 'bg-primary text-primary-foreground shadow-2xs'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                          }`}
                          title='Match Whole Word (Alt+W)'
                        >
                          \b
                        </button>
                        <button
                          type='button'
                          onClick={() => setUseRegex((prev) => !prev)}
                          className={`size-5 rounded flex items-center justify-center text-[10px] font-mono font-bold transition-all cursor-pointer ${
                            useRegex
                              ? 'bg-primary text-primary-foreground shadow-2xs'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                          }`}
                          title='Use Regular Expression (Alt+R)'
                        >
                          .*
                        </button>
                      </div>
                    </div>

                    <span className='min-w-10 text-center text-[10px] font-mono text-muted-foreground shrink-0'>
                      {searchQuery
                        ? searchMatches.length > 0
                          ? `${currentMatchIndex + 1}/${searchMatches.length}`
                          : '0/0'
                        : ''}
                    </span>

                    <div className='flex items-center gap-0.5 shrink-0'>
                      <Button
                        variant='ghost'
                        size='icon'
                        onClick={handlePrevMatch}
                        disabled={searchMatches.length === 0}
                        className='size-6'
                        title='Previous Match (Shift+Enter)'
                      >
                        <ArrowUp className='size-3.5' />
                      </Button>
                      <Button
                        variant='ghost'
                        size='icon'
                        onClick={handleNextMatch}
                        disabled={searchMatches.length === 0}
                        className='size-6'
                        title='Next Match (Enter)'
                      >
                        <ArrowDown className='size-3.5' />
                      </Button>
                      <Button
                        variant='ghost'
                        size='icon'
                        onClick={closeFind}
                        className='size-6'
                        title='Close (Escape)'
                      >
                        <X className='size-3.5' />
                      </Button>
                    </div>
                  </div>

                  {showReplaceRow && (
                    <div className='flex items-center gap-1.5 pl-7 animate-in slide-in-from-top-1 duration-100'>
                      <Input
                        ref={replaceInputRef}
                        value={replaceQuery}
                        onChange={(e) => setReplaceQuery(e.target.value)}
                        onKeyDown={handleReplaceInputKeyDown}
                        placeholder='Replace with...'
                        className='h-7 flex-1 px-2 text-xs font-mono bg-muted/40'
                      />

                      <div className='flex items-center gap-1 shrink-0'>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={handleReplaceOne}
                          disabled={searchMatches.length === 0}
                          className='h-7 px-2 text-[11px]'
                          title='Replace (Enter)'
                        >
                          Replace
                        </Button>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={handleReplaceAll}
                          disabled={searchMatches.length === 0}
                          className='h-7 px-2 text-[11px]'
                          title='Replace All (⌘+Alt+Enter)'
                        >
                          All
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {showSuggestions && suggestions.length > 0 && (
                <div className='absolute bottom-3 right-3 z-30 w-80 max-h-64 flex flex-col overflow-hidden rounded-lg border border-border/90 bg-popover/95 text-popover-foreground shadow-xl backdrop-blur-md'>
                  <div className='flex items-center justify-between border-b border-border/60 bg-muted/40 px-2.5 py-1 text-[10px] font-medium text-muted-foreground'>
                    <div className='flex items-center gap-1.5'>
                      <Code className='size-3 text-emerald-500' />
                      <span>DBML IntelliSense</span>
                    </div>
                    <div className='flex items-center gap-1 text-[9px]'>
                      <span>Tab / Enter</span>
                      <CornerDownLeft className='size-2.5' />
                    </div>
                  </div>

                  <div
                    ref={suggestionsListRef}
                    className='flex-1 overflow-y-auto p-1 max-h-48 divide-y divide-border/20'
                  >
                    {suggestions.map((item, idx) => (
                      <button
                        key={`${item.label}-${idx}`}
                        type='button'
                        onClick={() => applySuggestion(item)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors ${
                          selectedIndex === idx
                            ? 'bg-primary text-primary-foreground font-medium'
                            : 'hover:bg-accent text-foreground'
                        }`}
                      >
                        <div className='flex items-center gap-2 min-w-0'>
                          <span
                            className={`rounded px-1 py-0.2 text-[9px] font-bold uppercase tracking-wider ${
                              selectedIndex === idx
                                ? 'bg-primary-foreground/20 text-primary-foreground'
                                : item.kind === 'keyword'
                                ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
                                : item.kind === 'type'
                                ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                                : item.kind === 'attribute'
                                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                : item.kind === 'table'
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                : 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400'
                            }`}
                          >
                            {item.kind}
                          </span>
                          <span className='font-mono font-semibold truncate'>
                            {item.label}
                          </span>
                        </div>
                        <span
                          className={`text-[10px] truncate max-w-28 ${
                            selectedIndex === idx
                              ? 'text-primary-foreground/80'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {item.detail}
                        </span>
                      </button>
                    ))}
                  </div>

                  {suggestions[selectedIndex]?.documentation && (
                    <div className='border-t border-border/60 bg-muted/20 px-2.5 py-1 text-[10px] text-muted-foreground leading-tight'>
                      {suggestions[selectedIndex].documentation}
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
              <Database className='size-3.5 text-emerald-500' />
              <span>ERD PREVIEW</span>
            </div>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setIsFullscreen((prev) => !prev)}
              className='h-6 gap-1.5 px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground'
              title={isFullscreen ? 'Exit Fullscreen (Esc)' : 'Fullscreen Visualizer'}
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
            <DbmlVisualCanvas docId={docId} content={content} />
          </div>
        </div>
      </div>
    </div>

    <Dialog open={showShortcutsHelp} onOpenChange={setShowShortcutsHelp}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle className='text-base font-bold'>
              Editor Keyboard Shortcuts
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
              <span className='text-muted-foreground'>Toggle line comment</span>
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
            <div className='flex items-center justify-between border-b border-border/40 py-1.5'>
              <span className='text-muted-foreground'>Toggle Search Options (Case/Word/Regex)</span>
              <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                Alt + C / Alt + W / Alt + R
              </kbd>
            </div>
            <div className='flex items-center justify-between py-1.5'>
              <span className='text-muted-foreground'>Trigger IntelliSense</span>
              <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                Ctrl + Space / ⌘ + Space
              </kbd>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
