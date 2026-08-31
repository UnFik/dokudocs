import { useCallback, useMemo, useRef, useState } from 'react'
import {
  CodeBlockLanguageSelector,
  EmojiSelector,
  FootnoteTool,
  ImageEditTool,
  ImagePathPicker,
  ImageResizeBar,
  ImageToolBar,
  InlineFormatToolbar,
  type ITocItem,
  LinkTools,
  Muya,
  ParagraphFrontButton,
  ParagraphFrontMenu,
  ParagraphQuickInsertMenu,
  PreviewToolBar,
  TableChessboard,
  TableColumnToolbar,
  TableDragBar,
  TableRowColumMenu,
} from '@muyajs/core'
import { AlignLeft, Edit3, MessageSquare } from 'lucide-react'
import { useMountEffect } from '@/hooks/use-mount-effect'
import { useCommentStore } from '@/stores/comment-store'
import 'katex/dist/katex.min.css'
import 'github-markdown-css/github-markdown.css'
import '@/features/docs/lib/muya/assets/styles/index.css'
import '@/features/docs/lib/muya/assets/styles/blockSyntax.css'
import '@/features/docs/lib/muya/assets/styles/inlineSyntax.css'
import '@/features/docs/lib/muya/assets/styles/prismjs/light.theme.css'
import './muya.css'

export interface MuyaEditorHandle {
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
  getMarkdown: () => string
  getTOC: () => ITocItem[]
  scrollToText: (text: string) => void
}

export interface CommentTriggerPayload {
  selectedText: string
  blockPath?: (string | number)[]
  rect: {
    top: number
    bottom: number
    left: number
    right: number
    width: number
    height: number
  } | null
}

interface MuyaEditorProps {
  content: string
  onChange: (value: string) => void
  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void
  readOnly?: boolean
  isSuggestingMode?: boolean
  className?: string
  editorRef?: React.MutableRefObject<MuyaEditorHandle | null>
  showToc?: boolean
  onNavigateToSource?: (headingText: string) => void
  onCommentTrigger?: (payload: CommentTriggerPayload) => void
}

function findEnclosingInsTag(text: string, offset: number) {
  const insRegex =
    /<ins\b[^>]*\bdata-suggestion-id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/ins>/gi
  let match: RegExpExecArray | null
  while ((match = insRegex.exec(text)) !== null) {
    const fullTag = match[0]
    const openTagMatch = fullTag.match(/^<ins\b[^>]*>/i)
    if (!openTagMatch) continue
    const openTagLen = openTagMatch[0].length
    const openStart = match.index
    const openEnd = openStart + openTagLen
    const closeStart = openStart + fullTag.length - 6
    const closeEnd = openStart + fullTag.length

    if (offset >= openEnd && offset <= closeStart) {
      return {
        id: match[1],
        openStart,
        openEnd,
        closeStart,
        closeEnd,
        inner: match[2],
      }
    }
  }
  return null
}

function findPrecedingDelTag(text: string, offset: number) {
  const sub = text.substring(0, offset)
  const delEndMatch = sub.match(
    /<del\b[^>]*\bdata-suggestion-id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/del>$/i
  )
  if (delEndMatch && delEndMatch.index !== undefined) {
    const fullDel = delEndMatch[0]
    const openTagMatch = fullDel.match(/^<del\b[^>]*>/i)
    if (openTagMatch) {
      return {
        id: delEndMatch[1],
        fullStart: delEndMatch.index,
        openTag: openTagMatch[0],
        inner: delEndMatch[2],
        fullEnd: offset,
      }
    }
  }
  return null
}

let pluginsRegistered = false

function registerMuyaPlugins() {
  if (pluginsRegistered) return
  pluginsRegistered = true

  Muya.use(TableChessboard)
  Muya.use(ParagraphQuickInsertMenu)
  Muya.use(CodeBlockLanguageSelector)
  Muya.use(EmojiSelector)
  Muya.use(ImagePathPicker)
  Muya.use(ImageEditTool)
  Muya.use(ImageResizeBar)
  Muya.use(ImageToolBar)
  Muya.use(InlineFormatToolbar)
  Muya.use(ParagraphFrontButton)
  Muya.use(ParagraphFrontMenu)
  Muya.use(PreviewToolBar)
  Muya.use(LinkTools)
  Muya.use(FootnoteTool)
  Muya.use(TableColumnToolbar)
  Muya.use(TableDragBar)
  Muya.use(TableRowColumMenu)
}

export function MuyaEditor({
  content,
  onChange,
  onHistoryChange,
  readOnly = false,
  isSuggestingMode = false,
  className = '',
  editorRef,
  showToc = false,
  onNavigateToSource,
  onCommentTrigger,
}: MuyaEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const muyaRef = useRef<any>(null)
  const lastEmittedValueRef = useRef(content)
  const lastReadOnlyRef = useRef(readOnly)
  lastReadOnlyRef.current = readOnly
  const isSuggestingRef = useRef(isSuggestingMode)
  isSuggestingRef.current = isSuggestingMode
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onHistoryChangeRef = useRef(onHistoryChange)
  onHistoryChangeRef.current = onHistoryChange
  const onCommentTriggerRef = useRef(onCommentTrigger)
  onCommentTriggerRef.current = onCommentTrigger
  const [tocItems, setTocItems] = useState<ITocItem[]>([])
  const [lineIndicators, setLineIndicators] = useState<
    Array<{
      id: string
      top: number
      type: 'comment' | 'suggestion'
      count: number
      threadId: string
    }>
  >([])

  const updateLineIndicators = useCallback(() => {
    if (!containerRef.current) return
    const container = containerRef.current
    const containerRect = container.getBoundingClientRect()

    const markedElements = container.querySelectorAll(
      '[data-thread-id], [data-suggestion-id], mark, del, ins, .doc-comment-highlight, .doc-suggestion-del, .doc-suggestion-ins'
    )
    if (markedElements.length === 0) {
      setLineIndicators([])
      return
    }

    const blockMap = new Map<
      Element,
      {
        type: 'comment' | 'suggestion'
        count: number
        threadId: string
        top: number
      }
    >()

    const allThreads = useCommentStore.getState().threads || []

    markedElements.forEach((el) => {
      const blockEl =
        el.closest(
          '.mu-paragraph, .mu-header1, .mu-header2, .mu-header3, .mu-header4, .mu-header5, .mu-header6, .mu-list-item, .mu-table-cell, .mu-block, p, h1, h2, h3, h4, h5, h6, li'
        ) || el.parentElement
      if (!blockEl) return

      let threadId = el.getAttribute('data-thread-id')
      let sugId = el.getAttribute('data-suggestion-id')

      if (!threadId && !sugId) {
        if (
          el.tagName.toLowerCase() === 'mark' ||
          el.classList.contains('doc-comment-highlight')
        ) {
          const firstOpenThread = allThreads.find(
            (t) => !t.isResolved && !t.suggestion
          )
          if (firstOpenThread) threadId = firstOpenThread.id
        } else if (
          el.tagName.toLowerCase() === 'del' ||
          el.tagName.toLowerCase() === 'ins' ||
          el.classList.contains('doc-suggestion-del') ||
          el.classList.contains('doc-suggestion-ins')
        ) {
          const firstOpenSug = allThreads.find(
            (t) => !t.isResolved && t.suggestion
          )
          if (firstOpenSug) threadId = firstOpenSug.id
        }
      }

      let matchedThreadId = threadId || ''
      let indicatorType: 'comment' | 'suggestion' = 'comment'

      if (
        sugId ||
        el.tagName.toLowerCase() === 'del' ||
        el.tagName.toLowerCase() === 'ins' ||
        el.classList.contains('doc-suggestion-del') ||
        el.classList.contains('doc-suggestion-ins')
      ) {
        indicatorType = 'suggestion'
        if (sugId) {
          const matched = allThreads.find((t) => t.suggestion?.id === sugId)
          if (matched) matchedThreadId = matched.id
        }
      }

      const rect = blockEl.getBoundingClientRect()
      const top = rect.top - containerRect.top + rect.height / 2

      const existing = blockMap.get(blockEl)
      if (existing) {
        existing.count += 1
      } else {
        blockMap.set(blockEl, {
          type: indicatorType,
          count: 1,
          threadId: matchedThreadId,
          top,
        })
      }
    })

    const indicators: Array<{
      id: string
      top: number
      type: 'comment' | 'suggestion'
      count: number
      threadId: string
    }> = []

    let index = 0
    blockMap.forEach((val) => {
      indicators.push({
        id: `ind-${index++}-${val.threadId}`,
        top: val.top,
        type: val.type,
        count: val.count,
        threadId: val.threadId,
      })
    })

    setLineIndicators(indicators)
  }, [])

  const fallbackHeadings = useMemo(() => {
    if (!content.trim()) return []
    const results: { text: string; level: number; id: string; slug?: string }[] = []
    const lines = content.split('\n')
    let inCode = false

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('```')) {
        inCode = !inCode
        continue
      }
      if (inCode) continue
      const match = trimmed.match(/^(#{1,6})\s+(.+)$/)
      if (match) {
        results.push({
          level: match[1].length,
          text: match[2].replace(/\*\*/g, '').replace(/[*_`]/g, '').trim(),
          id: `heading-${results.length}`,
        })
      }
    }
    return results
  }, [content])

  const handleHeadingClick = (
    item: { slug?: string; text: string; level: number },
    index: number
  ) => {
    if (!containerRef.current) return
    const container = containerRef.current
    let targetEl: HTMLElement | null = null

    if (item.slug) {
      targetEl = container.querySelector<HTMLElement>(`[data-slug="${item.slug}"]`)
    }

    if (!targetEl) {
      const allHeadings = container.querySelectorAll<HTMLElement>(
        '.mu-atx-heading, .mu-setext-heading, h1, h2, h3, h4, h5, h6'
      )
      if (allHeadings[index]) {
        targetEl = allHeadings[index]
      }
    }

    if (!targetEl) {
      const allHeadings = container.querySelectorAll<HTMLElement>(
        '.mu-atx-heading, .mu-setext-heading, h1, h2, h3, h4, h5, h6'
      )
      const cleanTarget = item.text.toLowerCase().trim()
      for (let i = 0; i < allHeadings.length; i++) {
        const h = allHeadings[i]
        const cleanContent =
          h.textContent?.replace(/^[#\s]+/, '').toLowerCase().trim() || ''
        if (cleanContent === cleanTarget || cleanContent.includes(cleanTarget)) {
          targetEl = h
          break
        }
      }
    }

    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
      targetEl.classList.add(
        'ring-2',
        'ring-primary/40',
        'bg-primary/10',
        'rounded',
        'transition-all',
        'duration-500'
      )
      setTimeout(() => {
        targetEl?.classList.remove('ring-2', 'ring-primary/40', 'bg-primary/10')
      }, 1200)
    }

    onNavigateToSource?.(item.text)
  }

  useMountEffect(() => {
    if (!containerRef.current) return

    registerMuyaPlugins()

    const editor = new Muya(containerRef.current, {
      markdown: content,
      disableHtml: false,
      readOnly: readOnly,
      isSuggestingMode: isSuggestingMode,
      isGitlabCompatibilityEnabled: false,
      tabSize: 2,
      fontSize: 13,
      lineHeight: 1.6,
      hideQuickInsertHint: readOnly,
      hideLinkPopup: false,
      autoPairBracket: !readOnly,
      autoPairMarkdownSyntax: !readOnly,
      autoPairQuote: !readOnly,
    })

    editor.init()
    muyaRef.current = editor

    try {
      setTocItems(editor.getTOC())
    } catch {}

    editor.on('change', ({ markdown }: { markdown: string }) => {
      lastEmittedValueRef.current = markdown
      onChangeRef.current(markdown)
      try {
        setTocItems(editor.getTOC())
      } catch {}
    })

    editor.on('json-change', () => {
      const markdown = editor.getMarkdown()
      lastEmittedValueRef.current = markdown
      onChangeRef.current(markdown)
      try {
        setTocItems(editor.getTOC())
      } catch {}
    })

    editor.on('muya-comment-trigger', (payload: any) => {
      onCommentTriggerRef.current?.(payload)
    })

    editor.on('history-change', (state: { canUndo: boolean; canRedo: boolean }) => {
      onHistoryChangeRef.current?.(state)
    })

    onHistoryChangeRef.current?.({
      canUndo: editor.canUndo(),
      canRedo: editor.canRedo(),
    })

    const handleKeyDown = (e: KeyboardEvent) => {
      if (lastReadOnlyRef.current) return
      const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform)
      const mod = isMac ? e.metaKey : e.ctrlKey

      if (mod && !e.altKey) {
        const key = e.key.toLowerCase()
        if (key === 'z') {
          e.preventDefault()
          e.stopPropagation()
          if (e.shiftKey) {
            editor.redo()
          } else {
            editor.undo()
          }
          return
        } else if (key === 'y' && !isMac) {
          e.preventDefault()
          e.stopPropagation()
          editor.redo()
          return
        }
      }

      if (isSuggestingRef.current && !mod && !e.altKey) {
        const activeBlock =
          editor.editor?.activeContentBlock ??
          editor.editor?.selection?.anchorBlock ??
          editor.editor?.selection?.focusBlock
        if (activeBlock && typeof activeBlock.getCursor === 'function') {
          const cursor = activeBlock.getCursor()
          if (cursor) {
            const { start, end } = cursor
            const text = activeBlock.text || ''

            if (e.key === 'Backspace' || e.key === 'Delete') {
              if (start.offset !== end.offset) {
                const rawSelected = text.substring(start.offset, end.offset)
                const cleanSelected = rawSelected.replace(
                  /<\/?(del|ins|mark)\b[^>]*>/gi,
                  ''
                )
                if (cleanSelected.length > 0) {
                  e.preventDefault()
                  e.stopPropagation()
                  const sugId = `sug-${Date.now()}-${Math.random()
                    .toString(36)
                    .slice(2, 7)}`
                  const wrapped = `<del class="doc-suggestion-del" data-suggestion-id="${sugId}">${cleanSelected}</del>`
                  editor.editor?.history?.markInputBoundary('deleteContentForward', null)
                  activeBlock.text =
                    text.substring(0, start.offset) +
                    wrapped +
                    text.substring(end.offset)
                  const newOffset = start.offset + wrapped.length
                  activeBlock.update()
                  activeBlock.setCursor(newOffset, newOffset, true)
                  const md = editor.getMarkdown()
                  lastEmittedValueRef.current = md
                  onChangeRef.current(md)
                  setTimeout(updateLineIndicators, 50)
                  return
                }
              } else if (e.key === 'Backspace' && start.offset > 0) {
                const insTag = findEnclosingInsTag(text, start.offset)
                if (insTag && start.offset > insTag.openEnd) {
                  e.preventDefault()
                  e.stopPropagation()
                  const newText =
                    text.substring(0, start.offset - 1) +
                    text.substring(start.offset)
                  const newCloseStart = insTag.closeStart - 1
                  const inner = newText.substring(insTag.openEnd, newCloseStart)
                  if (inner.length === 0) {
                    const cleanText =
                      newText.substring(0, insTag.openStart) +
                      newText.substring(newCloseStart + 6)
                    activeBlock.text = cleanText
                    activeBlock.update()
                    activeBlock.setCursor(insTag.openStart, insTag.openStart, true)
                  } else {
                    activeBlock.text = newText
                    activeBlock.update()
                    activeBlock.setCursor(
                      start.offset - 1,
                      start.offset - 1,
                      true
                    )
                  }
                  const md = editor.getMarkdown()
                  lastEmittedValueRef.current = md
                  onChangeRef.current(md)
                  setTimeout(updateLineIndicators, 50)
                  return
                } else if (!insTag) {
                  const precedingDel = findPrecedingDelTag(text, start.offset)
                  if (precedingDel && precedingDel.fullStart > 0) {
                    const charBeforeDel = text.substring(
                      precedingDel.fullStart - 1,
                      precedingDel.fullStart
                    )
                    if (charBeforeDel && charBeforeDel !== '\n' && !charBeforeDel.endsWith('>')) {
                      e.preventDefault()
                      e.stopPropagation()
                      const mergedDel = `${precedingDel.openTag}${charBeforeDel}${precedingDel.inner}</del>`
                      editor.editor?.history?.markInputBoundary(
                        'deleteContentBackward',
                        null
                      )
                      activeBlock.text =
                        text.substring(0, precedingDel.fullStart - 1) +
                        mergedDel +
                        text.substring(start.offset)
                      const newOffset = precedingDel.fullStart - 1 + mergedDel.length
                      activeBlock.update()
                      activeBlock.setCursor(newOffset, newOffset, true)
                      const md = editor.getMarkdown()
                      lastEmittedValueRef.current = md
                      onChangeRef.current(md)
                      setTimeout(updateLineIndicators, 50)
                      return
                    }
                  }

                  const subBefore = text.substring(0, start.offset)
                  if (!subBefore.endsWith('>')) {
                    const charToDelete = text.substring(start.offset - 1, start.offset)
                    if (charToDelete && charToDelete !== '\n') {
                      e.preventDefault()
                      e.stopPropagation()
                      const sugId = `sug-${Date.now()}-${Math.random()
                        .toString(36)
                        .slice(2, 7)}`
                      const wrapped = `<del class="doc-suggestion-del" data-suggestion-id="${sugId}">${charToDelete}</del>`
                      editor.editor?.history?.markInputBoundary('deleteContentBackward', null)
                      activeBlock.text =
                        text.substring(0, start.offset - 1) +
                        wrapped +
                        text.substring(start.offset)
                      const newOffset = start.offset - 1 + wrapped.length
                      activeBlock.update()
                      activeBlock.setCursor(newOffset, newOffset, true)
                      const md = editor.getMarkdown()
                      lastEmittedValueRef.current = md
                      onChangeRef.current(md)
                      setTimeout(updateLineIndicators, 50)
                      return
                    }
                  }
                }
              } else if (e.key === 'Delete' && start.offset < text.length) {
                const insTag = findEnclosingInsTag(text, start.offset)
                if (!insTag) {
                  const subAfter = text.substring(start.offset)
                  if (!subAfter.startsWith('<')) {
                    const charToDelete = text.substring(start.offset, start.offset + 1)
                    if (charToDelete && charToDelete !== '\n') {
                      e.preventDefault()
                      e.stopPropagation()
                      const sugId = `sug-${Date.now()}-${Math.random()
                        .toString(36)
                        .slice(2, 7)}`
                      const wrapped = `<del class="doc-suggestion-del" data-suggestion-id="${sugId}">${charToDelete}</del>`
                      editor.editor?.history?.markInputBoundary('deleteContentForward', null)
                      activeBlock.text =
                        text.substring(0, start.offset) +
                        wrapped +
                        text.substring(start.offset + 1)
                      const newOffset = start.offset + wrapped.length
                      activeBlock.update()
                      activeBlock.setCursor(newOffset, newOffset, true)
                      const md = editor.getMarkdown()
                      lastEmittedValueRef.current = md
                      onChangeRef.current(md)
                      setTimeout(updateLineIndicators, 50)
                      return
                    }
                  }
                }
              }
            } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
              if (start.offset !== end.offset) {
                const rawSelected = text.substring(start.offset, end.offset)
                const cleanSelected = rawSelected.replace(
                  /<\/?(del|ins|mark)\b[^>]*>/gi,
                  ''
                )
                if (cleanSelected.length > 0) {
                  e.preventDefault()
                  e.stopPropagation()
                  const sugId = `sug-${Date.now()}-${Math.random()
                    .toString(36)
                    .slice(2, 7)}`
                  const openIns = `<ins class="doc-suggestion-ins" data-suggestion-id="${sugId}">`
                  const wrapped = `<del class="doc-suggestion-del" data-suggestion-id="${sugId}">${cleanSelected}</del>${openIns}${e.key}</ins>`
                  editor.editor?.history?.markInputBoundary('insertText', e.key)
                  activeBlock.text =
                    text.substring(0, start.offset) +
                    wrapped +
                    text.substring(end.offset)
                  const caretPos =
                    start.offset +
                    wrapped.length -
                    6
                  activeBlock.update()
                  activeBlock.setCursor(caretPos, caretPos, true)
                  const md = editor.getMarkdown()
                  lastEmittedValueRef.current = md
                  onChangeRef.current(md)
                  setTimeout(updateLineIndicators, 50)
                  return
                }
              } else {
                const insTag = findEnclosingInsTag(text, start.offset)
                if (insTag) {
                  e.preventDefault()
                  e.stopPropagation()
                  editor.editor?.history?.markInputBoundary('insertText', e.key)
                  activeBlock.text =
                    text.substring(0, start.offset) +
                    e.key +
                    text.substring(start.offset)
                  const caretPos = start.offset + 1
                  activeBlock.update()
                  activeBlock.setCursor(caretPos, caretPos, true)
                  const md = editor.getMarkdown()
                  lastEmittedValueRef.current = md
                  onChangeRef.current(md)
                  setTimeout(updateLineIndicators, 50)
                  return
                } else {
                  e.preventDefault()
                  e.stopPropagation()
                  const sugId = `sug-${Date.now()}-${Math.random()
                    .toString(36)
                    .slice(2, 7)}`
                  const openTag = `<ins class="doc-suggestion-ins" data-suggestion-id="${sugId}">`
                  const wrapped = `${openTag}${e.key}</ins>`
                  editor.editor?.history?.markInputBoundary('insertText', e.key)
                  activeBlock.text =
                    text.substring(0, start.offset) +
                    wrapped +
                    text.substring(start.offset)
                  const caretPos = start.offset + openTag.length + 1
                  activeBlock.update()
                  activeBlock.setCursor(caretPos, caretPos, true)
                  const md = editor.getMarkdown()
                  lastEmittedValueRef.current = md
                  onChangeRef.current(md)
                  setTimeout(updateLineIndicators, 50)
                  return
                }
              }
            }
          }
        }
      }
    }

    const handleDomClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return

      const markEl = target.closest('[data-thread-id]') as HTMLElement | null
      if (markEl) {
        const threadId = markEl.getAttribute('data-thread-id')
        if (threadId) {
          useCommentStore.getState().setActiveThreadId(threadId)
          useCommentStore.getState().setSidebarOpen(true)
          return
        }
      }

      const sugEl = target.closest('[data-suggestion-id]') as HTMLElement | null
      if (sugEl) {
        const sugId = sugEl.getAttribute('data-suggestion-id')
        if (sugId) {
          const thread = useCommentStore
            .getState()
            .threads.find((t) => t.suggestion?.id === sugId)
          if (thread) {
            useCommentStore.getState().setActiveThreadId(thread.id)
            useCommentStore.getState().setSidebarOpen(true)
          }
        }
      }
    }

    const container = containerRef.current
    container.addEventListener('keydown', handleKeyDown, true)
    container.addEventListener('click', handleDomClick)

    const handleScrollOrResize = () => {
      updateLineIndicators()
    }

    const scrollContainer = container.closest('.muya-container') || window
    window.addEventListener('resize', handleScrollOrResize)
    scrollContainer.addEventListener('scroll', handleScrollOrResize)

    const observer = new MutationObserver(() => {
      updateLineIndicators()
    })
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    })

    const unsubscribeStore = useCommentStore.subscribe(() => {
      updateLineIndicators()
    })

    setTimeout(updateLineIndicators, 100)

    if (editorRef) {
      editorRef.current = {
        undo: () => editor.undo(),
        redo: () => editor.redo(),
        canUndo: () => editor.canUndo(),
        canRedo: () => editor.canRedo(),
        getMarkdown: () => editor.getMarkdown(),
        getTOC: () => editor.getTOC(),
        scrollToText: (text: string) => {
          if (!containerRef.current || !text.trim()) return
          const rootEl = containerRef.current
          const target = text.trim().toLowerCase()
          const walker = document.createTreeWalker(
            rootEl,
            NodeFilter.SHOW_TEXT,
            null
          )
          let node: Node | null
          while ((node = walker.nextNode())) {
            if (
              node.textContent &&
              node.textContent.toLowerCase().includes(target)
            ) {
              const parentEl = node.parentElement
              if (parentEl) {
                parentEl.scrollIntoView({
                  behavior: 'smooth',
                  block: 'center',
                })
                parentEl.classList.add(
                  'ring-2',
                  'ring-primary/60',
                  'bg-primary/20',
                  'rounded',
                  'transition-all',
                  'duration-500'
                )
                setTimeout(() => {
                  parentEl.classList.remove(
                    'ring-2',
                    'ring-primary/60',
                    'bg-primary/20'
                  )
                }, 2000)
                break
              }
            }
          }
        },
      }
    }

    return () => {
      observer.disconnect()
      unsubscribeStore()
      container.removeEventListener('keydown', handleKeyDown, true)
      container.removeEventListener('click', handleDomClick)
      window.removeEventListener('resize', handleScrollOrResize)
      scrollContainer.removeEventListener('scroll', handleScrollOrResize)
      editor.destroy()
      muyaRef.current = null
      if (editorRef) {
        editorRef.current = null
      }
    }
  })

  if (muyaRef.current) {
    const editor = muyaRef.current
    if (editor.getReadOnly() !== readOnly) {
      editor.setReadOnly(readOnly)
    }
    if (editor.getIsSuggestingMode() !== isSuggestingMode) {
      editor.setIsSuggestingMode(isSuggestingMode)
    }
    if (content !== lastEmittedValueRef.current) {
      lastEmittedValueRef.current = content
      if (!editor.hasFocus() && editor.getMarkdown() !== content) {
        try {
          editor.replaceContent(content)
          setTocItems(editor.getTOC())
          setTimeout(updateLineIndicators, 50)
        } catch {}
      }
    }
  }

  const renderedToc =
    tocItems.length > 0
      ? tocItems.map((item, idx) => ({
          id: `toc-${idx}-${item.slug}`,
          slug: item.slug,
          text: item.content,
          level: item.lvl,
        }))
      : fallbackHeadings

  return (
    <div
      className={`relative h-full w-full overflow-y-auto overflow-x-hidden p-6 select-text bg-background muya-container ${className} ${readOnly ? 'mu-read-only' : ''}`}
    >
      <div className='relative max-w-5xl mx-auto flex items-start justify-center gap-8 pb-16'>
        {showToc && (
          <aside className='sticky top-2 w-48 2xl:w-56 shrink-0 select-none py-1'>
            <div className='flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2.5 px-1'>
              <AlignLeft className='size-3 text-muted-foreground' />
              <span>On this page</span>
            </div>

            <div className='border-l border-border/50 ml-1 pl-2 space-y-0.5 max-h-[calc(100vh-200px)] overflow-y-auto'>
              {renderedToc.length > 0 ? (
                renderedToc.map((h, idx) => {
                  const indentClass =
                    h.level === 1
                      ? 'pl-0 font-medium text-foreground text-xs'
                      : h.level === 2
                      ? 'pl-2.5 text-muted-foreground hover:text-foreground text-xs'
                      : h.level === 3
                      ? 'pl-5 text-muted-foreground/80 hover:text-foreground text-[11px]'
                      : 'pl-7 text-muted-foreground/60 hover:text-foreground text-[11px]'

                  return (
                    <button
                      key={h.id}
                      type='button'
                      onClick={() => handleHeadingClick(h, idx)}
                      className={`group block w-full text-left py-0.5 pr-1.5 rounded transition-colors cursor-pointer truncate hover:text-primary ${indentClass}`}
                      title={h.text}
                    >
                      <span className='truncate block'>{h.text}</span>
                    </button>
                  )
                })
              ) : (
                <p className='text-xs text-muted-foreground/60 italic px-1'>
                  No headings found
                </p>
              )}
            </div>
          </aside>
        )}

        <div className='flex-1 min-w-0 max-w-3xl relative'>
          <div ref={containerRef} className='muya-editor-root min-h-[500px]' />

          {lineIndicators.length > 0 && (
            <div className='mu-line-indicators-container'>
              {lineIndicators.map((ind) => (
                <button
                  key={ind.id}
                  type='button'
                  style={{ top: `${ind.top}px` }}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (ind.threadId) {
                      useCommentStore.getState().setActiveThreadId(ind.threadId)
                    }
                    useCommentStore.getState().setSidebarOpen(true)
                  }}
                  className={`mu-line-indicator-btn size-6 rounded-full border shadow-sm transition-all cursor-pointer hover:scale-110 ${
                    ind.type === 'suggestion'
                      ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25'
                      : 'bg-amber-500/15 border-amber-500/50 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25'
                  }`}
                  title={
                    ind.type === 'suggestion'
                      ? `${ind.count} suggestion(s) on this line`
                      : `${ind.count} comment(s) on this line`
                  }
                >
                  {ind.type === 'suggestion' ? (
                    <Edit3 className='size-3' />
                  ) : (
                    <MessageSquare className='size-3' />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
export default MuyaEditor
