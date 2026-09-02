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
import 'github-markdown-css/github-markdown.css'
import 'katex/dist/katex.min.css'
import { AlignLeft, MessageSquare } from 'lucide-react'
import {
  getDecorationsForBlock,
  useCommentStore,
} from '@/stores/comment-store'
import { useMountEffect } from '@/hooks/use-mount-effect'
import '@/features/docs/lib/muya/assets/styles/blockSyntax.css'
import '@/features/docs/lib/muya/assets/styles/index.css'
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
  blockId?: string
  blockPath?: (string | number)[]
  from?: number
  to?: number
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
  docId: string
  content: string
  onChange: (value: string) => void
  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void
  readOnly?: boolean
  className?: string
  editorRef?: React.MutableRefObject<MuyaEditorHandle | null>
  showToc?: boolean
  onNavigateToSource?: (headingText: string) => void
  onCommentTrigger?: (payload: CommentTriggerPayload) => void
}

let pluginsRegistered = false

/* eslint-disable react-hooks/rules-of-hooks */
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
/* eslint-enable react-hooks/rules-of-hooks */

export function MuyaEditor({
  docId,
  content,
  onChange,
  onHistoryChange,
  readOnly = false,
  className = '',
  editorRef,
  showToc = false,
  onNavigateToSource,
  onCommentTrigger,
}: MuyaEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const muyaRef = useRef<InstanceType<typeof Muya> | null>(null)
  const lastEmittedValueRef = useRef(content)
  const lastPropContentRef = useRef(content)
  /* eslint-disable react-hooks/refs */
  const lastReadOnlyRef = useRef(readOnly)
  lastReadOnlyRef.current = readOnly
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onHistoryChangeRef = useRef(onHistoryChange)
  onHistoryChangeRef.current = onHistoryChange
  const onCommentTriggerRef = useRef(onCommentTrigger)
  onCommentTriggerRef.current = onCommentTrigger
  /* eslint-enable react-hooks/refs */
  const [tocItems, setTocItems] = useState<ITocItem[]>([])
  const [lineIndicators, setLineIndicators] = useState<
    Array<{
      id: string
      top: number
      count: number
      threadId: string
    }>
  >([])

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tocDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafIndicatorsTimerRef = useRef<number | null>(null)
  const blockOffsetsRef = useRef<Map<string, { start: number; end: number }>>(
    new Map()
  )

  const updateLineIndicators = useCallback(() => {
    if (rafIndicatorsTimerRef.current) {
      cancelAnimationFrame(rafIndicatorsTimerRef.current)
    }
    rafIndicatorsTimerRef.current = requestAnimationFrame(() => {
      if (!containerRef.current) return
      const container = containerRef.current
      const markedElements = container.querySelectorAll(
        '[data-thread-id], mark, .doc-comment-highlight'
      )
      if (markedElements.length === 0) {
        setLineIndicators((prev) => (prev.length === 0 ? prev : []))
        return
      }

      const containerRect = container.getBoundingClientRect()
      const blockMap = new Map<
        Element,
        {
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

        if (!threadId) {
          if (
            el.tagName.toLowerCase() === 'mark' ||
            el.classList.contains('doc-comment-highlight')
          ) {
            const firstOpenThread = allThreads.find(
              (t) => !t.isResolved
            )
            if (firstOpenThread) threadId = firstOpenThread.id
          }
        }

        const matchedThreadId = threadId || ''
        const rect = blockEl.getBoundingClientRect()
        const top = rect.top - containerRect.top + rect.height / 2

        const existing = blockMap.get(blockEl)
        if (existing) {
          existing.count += 1
        } else {
          blockMap.set(blockEl, {
            count: 1,
            threadId: matchedThreadId,
            top,
          })
        }
      })

      const indicators: Array<{
        id: string
        top: number
        count: number
        threadId: string
      }> = []

      let index = 0
      blockMap.forEach((val) => {
        indicators.push({
          id: `ind-${index++}-${val.threadId}`,
          top: val.top,
          count: val.count,
          threadId: val.threadId,
        })
      })

      setLineIndicators(indicators)
    })
  }, [])

  const updateBlockOffsets = useCallback((ed: Muya) => {
    const map = new Map<string, { start: number; end: number }>()
    const scrollPage = ed.editor?.scrollPage
    if (!scrollPage) return map
    const md = ed.getMarkdown()

    let searchPos = 0
    scrollPage.breadthFirstTraverse(
      (node: { isContent: () => boolean; text?: string; id: string }) => {
        if (node.isContent()) {
          const text = node.text || ''
          if (!text) return
          const idx = md.indexOf(text, searchPos)
          if (idx !== -1) {
            map.set(node.id, { start: idx, end: idx + text.length })
            searchPos = idx + text.length
          } else {
            const fallbackIdx = md.indexOf(text)
            if (fallbackIdx !== -1) {
              map.set(node.id, {
                start: fallbackIdx,
                end: fallbackIdx + text.length,
              })
            }
          }
        }
      }
    )
    blockOffsetsRef.current = map
    return map
  }, [])

  const fallbackHeadings = useMemo(() => {
    if (!content.trim()) return []
    const results: {
      text: string
      level: number
      id: string
      slug?: string
    }[] = []
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
      targetEl = container.querySelector<HTMLElement>(
        `[data-slug="${item.slug}"]`
      )
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
          h.textContent
            ?.replace(/^[#\s]+/, '')
            .toLowerCase()
            .trim() || ''
        if (
          cleanContent === cleanTarget ||
          cleanContent.includes(cleanTarget)
        ) {
          targetEl = h
          break
        }
      }
    }

    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
      onNavigateToSource?.(item.text)
    }
  }

  useMountEffect(() => {
    if (!containerRef.current) return

    registerMuyaPlugins()

    const editor = new Muya(containerRef.current, {
      markdown: content,
      readOnly: readOnly,
      isGitlabCompatibilityEnabled: false,
      tabSize: 2,
      fontSize: 13,
      lineHeight: 1.6,
      hideQuickInsertHint: readOnly,
      hideLinkPopup: false,
      autoPairBracket: !readOnly,
      autoPairMarkdownSyntax: !readOnly,
      autoPairQuote: !readOnly,
      getDecorations: (block: {
        text?: string
        id?: string
        parent?: { id?: string }
        path?: (string | number)[]
      }) => {
        const text = block.text || ''
        const blockId =
          block.id ||
          block.parent?.id ||
          (block.path && block.path.length ? block.path.join('.') : '')
        const blockOffset = block.id
          ? blockOffsetsRef.current.get(block.id)
          : undefined
        return getDecorationsForBlock(
          docId,
          blockId,
          text,
          useCommentStore.getState().activeThreadId,
          block.path,
          blockOffset
        )
      },
    })

    editor.init()
    updateBlockOffsets(editor)
    if (readOnly) {
      editor.setReadOnly(true)
    }
    muyaRef.current = editor

    try {
      setTocItems(editor.getTOC())
    } catch (err) {
      void err
    }

    const flushChange = () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
      try {
        const md = editor.getMarkdown()
        if (md !== lastEmittedValueRef.current) {
          lastEmittedValueRef.current = md
          lastPropContentRef.current = md
          onChangeRef.current(md)
          updateLineIndicators()
        }
      } catch (err) {
        void err
      }
    }

    const handleEditorChange = () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null
        try {
          const markdown = editor.getMarkdown()
          if (markdown === lastEmittedValueRef.current) return
          lastEmittedValueRef.current = markdown
          lastPropContentRef.current = markdown
          onChangeRef.current(markdown)
          updateLineIndicators()

          if (tocDebounceTimerRef.current) {
            clearTimeout(tocDebounceTimerRef.current)
          }
          tocDebounceTimerRef.current = setTimeout(() => {
            try {
              setTocItems(editor.getTOC())
            } catch (err) {
              void err
            }
          }, 300)
        } catch (err) {
          void err
        }
      }, 300)
    }

    editor.on('change', handleEditorChange)
    editor.on('json-change', handleEditorChange)
    editor.on('content-change', handleEditorChange)

    editor.on('muya-comment-trigger', (payload: CommentTriggerPayload) => {
      queueMicrotask(() => {
        onCommentTriggerRef.current?.(payload)
      })
    })

    editor.on(
      'history-change',
      (state: { canUndo: boolean; canRedo: boolean }) => {
        queueMicrotask(() => {
          onHistoryChangeRef.current?.(state)
        })
        flushChange()
      }
    )

    queueMicrotask(() => {
      onHistoryChangeRef.current?.({
        canUndo: editor.canUndo(),
        canRedo: editor.canRedo(),
      })
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
        } else if (key === 'a') {
          e.preventDefault()
          e.stopPropagation()
          editor.selectAll()
          return
        }
      }
    }

    const handleDomClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return

      const markEl = target.closest(
        '[data-thread-id], .doc-comment-highlight'
      ) as HTMLElement | null
      if (markEl) {
        const threadId =
          markEl.getAttribute('data-thread-id') || markEl.dataset.threadId
        if (threadId) {
          useCommentStore.getState().setActiveThreadId(threadId)
          useCommentStore.getState().setSidebarOpen(true)
          return
        }
      }
    }

    const handleBlur = () => {
      flushChange()
    }

    const container = containerRef.current
    container.addEventListener('keydown', handleKeyDown, true)
    container.addEventListener('click', handleDomClick)
    container.addEventListener('blur', handleBlur, true)
    editor.on('blur', handleBlur)

    const handleScrollOrResize = () => {
      updateLineIndicators()
    }

    const scrollContainer = container.closest('.muya-container') || window
    window.addEventListener('resize', handleScrollOrResize)
    scrollContainer.addEventListener('scroll', handleScrollOrResize)

    let lastThreadsJson = ''
    const unsubscribeStore = useCommentStore.subscribe((state) => {
      const docThreads = state.threads.filter((t) => t.docId === docId)
      const key = JSON.stringify({
        activeId: state.activeThreadId,
        threads: docThreads.map((t) => ({
          id: t.id,
          isResolved: t.isResolved,
        })),
      })
      if (key !== lastThreadsJson) {
        lastThreadsJson = key
        updateBlockOffsets(editor)
        editor.forceUpdateDecorations()
        updateLineIndicators()
      }
    })

    setTimeout(updateLineIndicators, 100)

    if (editorRef) {
      editorRef.current = {
        undo: () => {
          editor.undo()
          flushChange()
        },
        redo: () => {
          editor.redo()
          flushChange()
        },
        canUndo: () => editor.canUndo(),
        canRedo: () => editor.canRedo(),
        getMarkdown: () => {
          flushChange()
          return editor.getMarkdown()
        },
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
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
      if (tocDebounceTimerRef.current) {
        clearTimeout(tocDebounceTimerRef.current)
      }
      if (rafIndicatorsTimerRef.current) {
        cancelAnimationFrame(rafIndicatorsTimerRef.current)
      }
      try {
        const currentMd = editor.getMarkdown()
        if (currentMd && currentMd !== lastEmittedValueRef.current) {
          lastEmittedValueRef.current = currentMd
          lastPropContentRef.current = currentMd
          onChangeRef.current(currentMd)
        }
      } catch (err) {
        void err
      }
      unsubscribeStore()
      container.removeEventListener('keydown', handleKeyDown, true)
      container.removeEventListener('click', handleDomClick)
      container.removeEventListener('blur', handleBlur, true)
      window.removeEventListener('resize', handleScrollOrResize)
      scrollContainer.removeEventListener('scroll', handleScrollOrResize)
      editor.destroy()
      muyaRef.current = null
      if (editorRef) {
        editorRef.current = null
      }
    }
  })

  /* eslint-disable react-hooks/refs */
  if (muyaRef.current) {
    const editor = muyaRef.current
    if (editor.getReadOnly() !== readOnly) {
      editor.setReadOnly(readOnly)
    }
    if (content !== lastPropContentRef.current) {
      lastPropContentRef.current = content
      if (content !== lastEmittedValueRef.current && editor.getMarkdown() !== content) {
        try {
          lastEmittedValueRef.current = content
          editor.replaceContent(content)
          updateBlockOffsets(editor)
          editor.forceUpdateDecorations()
          setTocItems(editor.getTOC())
          updateLineIndicators()
        } catch (err) {
          void err
        }
      }
    }
  }
  /* eslint-enable react-hooks/refs */

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
      className={`muya-container relative h-full w-full overflow-x-hidden overflow-y-auto bg-background p-6 select-text ${className} ${readOnly ? 'mu-read-only' : ''}`}
    >
      <div className='relative mx-auto flex max-w-5xl items-start justify-center gap-8 pb-16'>
        {showToc && (
          <aside className='sticky top-2 w-48 shrink-0 py-1 select-none 2xl:w-56'>
            <div className='mb-2.5 flex items-center gap-1.5 px-1 text-[10px] font-semibold tracking-wider text-muted-foreground/70 uppercase'>
              <AlignLeft className='size-3 text-muted-foreground' />
              <span>On this page</span>
            </div>

            <div className='ml-1 max-h-[calc(100vh-200px)] space-y-0.5 overflow-y-auto border-l border-border/50 pl-2'>
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
                      className={`group block w-full cursor-pointer truncate rounded py-0.5 pr-1.5 text-left transition-colors hover:text-primary ${indentClass}`}
                      title={h.text}
                    >
                      <span className='block truncate'>{h.text}</span>
                    </button>
                  )
                })
              ) : (
                <p className='px-1 text-xs text-muted-foreground/60 italic'>
                  No headings found
                </p>
              )}
            </div>
          </aside>
        )}

        <div className='relative max-w-3xl min-w-0 flex-1'>
          <div
            ref={containerRef}
            className={`muya-editor-root min-h-[500px] ${readOnly ? 'mu-read-only' : ''}`}
          />

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
                  className='mu-line-indicator-btn size-6 cursor-pointer rounded-full border border-amber-500/50 bg-amber-500/15 text-amber-600 shadow-sm transition-all hover:scale-110 hover:bg-amber-500/25 dark:text-amber-400'
                  title={`${ind.count} comment(s) on this line`}
                >
                  <MessageSquare className='size-3' />
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
