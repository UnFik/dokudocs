import { useMemo, useRef, useState } from 'react'
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
import { AlignLeft } from 'lucide-react'
import { useMountEffect } from '@/hooks/use-mount-effect'
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
  getMarkdown: () => string
  getTOC: () => ITocItem[]
}

interface MuyaEditorProps {
  content: string
  onChange: (value: string) => void
  readOnly?: boolean
  className?: string
  editorRef?: React.MutableRefObject<MuyaEditorHandle | null>
  showToc?: boolean
  onNavigateToSource?: (headingText: string) => void
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
  readOnly = false,
  className = '',
  editorRef,
  showToc = false,
  onNavigateToSource,
}: MuyaEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const muyaRef = useRef<any>(null)
  const lastEmittedValueRef = useRef(content)
  const lastReadOnlyRef = useRef(readOnly)
  lastReadOnlyRef.current = readOnly
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const [tocItems, setTocItems] = useState<ITocItem[]>([])

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
        } else if (key === 'y' && !isMac) {
          e.preventDefault()
          e.stopPropagation()
          editor.redo()
        }
      }
    }

    const container = containerRef.current
    container.addEventListener('keydown', handleKeyDown, true)

    if (editorRef) {
      editorRef.current = {
        undo: () => editor.undo(),
        redo: () => editor.redo(),
        getMarkdown: () => editor.getMarkdown(),
        getTOC: () => editor.getTOC(),
      }
    }

    return () => {
      container.removeEventListener('keydown', handleKeyDown, true)
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
    if (content !== lastEmittedValueRef.current) {
      lastEmittedValueRef.current = content
      if (!editor.hasFocus() && editor.getMarkdown() !== content) {
        try {
          editor.replaceContent(content)
          setTocItems(editor.getTOC())
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

        <div className='flex-1 min-w-0 max-w-3xl'>
          <div ref={containerRef} className='muya-editor-root min-h-[500px]' />
        </div>
      </div>
    </div>
  )
}
export default MuyaEditor
