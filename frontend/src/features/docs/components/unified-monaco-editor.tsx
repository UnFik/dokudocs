import { type ReactNode, useCallback, useRef, useState } from 'react'
import {
  ChevronsUpDown,
  Code2,
  Columns2,
  Copy,
  Eye,
  HelpCircle,
  Moon,
  Redo2,
  RefreshCw,
  Search,
  Sun,
  Undo2,
  Zap,
  ZapOff,
} from 'lucide-react'
import * as monaco from 'monaco-editor'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import {
  type EditorViewMode,
  useEditorPreferenceStore,
} from '@/stores/editor-preference-store'
import { useTheme } from '@/context/theme-provider'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { runDiagnostics } from '../lib/monaco-diagnostics'
import { setupMonaco } from '../lib/monaco-setup'

export type ViewMode = EditorViewMode

export interface PreviewSlotProps {
  scrollRef: React.RefObject<HTMLDivElement | null>
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void
  navigateToSource?: (tableName: string, columnName?: string) => void
}

export interface UnifiedMonacoEditorProps {
  docId?: string
  content: string
  onChange: (newContent: string) => void
  language: 'markdown' | 'dbml' | 'mermaid'
  previewTitle?: string
  previewIcon?: ReactNode
  previewContent: ReactNode | ((props: PreviewSlotProps) => ReactNode)
  customToolbarActions?: ReactNode
  previewLeftActions?: ReactNode
  previewToolbarActions?: ReactNode
  badgeLabel?: string
  badgeColorClass?: string
  showLiveRenderToggle?: boolean
  showSyncScrollToggle?: boolean
}

export function UnifiedMonacoEditor({
  content,
  onChange,
  language,
  previewTitle,
  previewIcon,
  previewContent,
  customToolbarActions,
  previewLeftActions,
  previewToolbarActions,
  badgeLabel,
  badgeColorClass,
  showLiveRenderToggle = true,
  showSyncScrollToggle = false,
}: UnifiedMonacoEditorProps) {
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  const { auth } = useAuthStore()
  const userId = auth.user?.accountNo || auth.user?.email || 'guest'

  const userPreference = useEditorPreferenceStore(
    (state) => state.preferencesByUser[userId]
  )
  const setStoreViewMode = useEditorPreferenceStore(
    (state) => state.setViewMode
  )
  const setStoreSplitPercent = useEditorPreferenceStore(
    (state) => state.setSplitPercent
  )
  const setStoreIsLiveRenderActive = useEditorPreferenceStore(
    (state) => state.setIsLiveRenderActive
  )
  const setStoreSyncScroll = useEditorPreferenceStore(
    (state) => state.setSyncScroll
  )
  const setStorePreviewMode = useEditorPreferenceStore(
    (state) => state.setPreviewMode
  )

  const viewMode: EditorViewMode = userPreference?.viewMode ?? 'split'
  const splitPercent: number = userPreference?.splitPercent ?? 50
  const isLiveRenderActive: boolean = showLiveRenderToggle
    ? (userPreference?.isLiveRenderActive ?? true)
    : true
  const syncScroll: boolean = userPreference?.syncScroll ?? true

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const splitContainerRef = useRef<HTMLDivElement | null>(null)
  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  const isUpdatingFromPropRef = useRef(false)
  const isSyncingScrollRef = useRef(false)
  /* eslint-disable react-hooks/refs */
  const contentRef = useRef(content)
  contentRef.current = content
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const isLiveRenderActiveRef = useRef(isLiveRenderActive)
  isLiveRenderActiveRef.current = isLiveRenderActive
  /* eslint-enable react-hooks/refs */
  const lastEmittedValueRef = useRef(content)
  const lastPropContentRef = useRef(content)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const decorationsCollectionRef =
    useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const diagDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )

  const [isResizing, setIsResizing] = useState<boolean>(false)
  const [showShortcutsHelp, setShowShortcutsHelp] = useState<boolean>(false)
  const [hasPendingChanges, setHasPendingChanges] = useState<boolean>(false)
  const [monacoCanUndo, setMonacoCanUndo] = useState<boolean>(false)
  const [monacoCanRedo, setMonacoCanRedo] = useState<boolean>(false)
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 })
  const [stats, setStats] = useState(() => ({
    lines: content ? content.split('\n').length : 1,
    words: content ? content.trim().split(/\s+/).filter(Boolean).length : 0,
  }))

  const flushChange = useCallback((value: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    lastEmittedValueRef.current = value
    setHasPendingChanges(false)
    onChangeRef.current(value)
  }, [])

  const triggerManualSync = useCallback(() => {
    if (!editorRef.current) return
    const val = editorRef.current.getValue()
    flushChange(val)
    toast.success('Preview synchronized')
  }, [flushChange])

  const updateErrorLens = useCallback(
    (editor: monaco.editor.IStandaloneCodeEditor) => {
      const model = editor.getModel()
      if (!model) return

      const markers = monaco.editor.getModelMarkers({ resource: model.uri })
      const newDecorations: monaco.editor.IModelDeltaDecoration[] = markers.map(
        (marker) => {
          const isError = marker.severity === monaco.MarkerSeverity.Error
          const icon = isError ? '● ' : '▲ '
          const firstLine = marker.message.split('\n')[0].trim()
          return {
            range: new monaco.Range(
              marker.startLineNumber,
              marker.startColumn,
              marker.startLineNumber,
              marker.startColumn
            ),
            options: {
              isWholeLine: true,
              className: isError
                ? 'monaco-error-lens-error-line'
                : 'monaco-error-lens-warning-line',
              after: {
                content: `   ${icon}${firstLine}`,
                inlineClassName: isError
                  ? 'monaco-error-lens-error-msg'
                  : 'monaco-error-lens-warning-msg',
              },
            },
          }
        }
      )

      if (decorationsCollectionRef.current) {
        decorationsCollectionRef.current.set(newDecorations)
      } else {
        decorationsCollectionRef.current =
          editor.createDecorationsCollection(newDecorations)
      }
    },
    []
  )

  const scheduleDiagnostics = useCallback(
    (editor: monaco.editor.IStandaloneCodeEditor, lang: string) => {
      if (diagDebounceTimerRef.current) {
        clearTimeout(diagDebounceTimerRef.current)
      }
      diagDebounceTimerRef.current = setTimeout(async () => {
        const model = editor.getModel()
        if (!model) return
        await runDiagnostics(model, lang, monaco)
        updateErrorLens(editor)
      }, 200)
    },
    [updateErrorLens]
  )

  const containerRefCallback = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current)
          debounceTimerRef.current = null
        }
        if (diagDebounceTimerRef.current) {
          clearTimeout(diagDebounceTimerRef.current)
          diagDebounceTimerRef.current = null
        }
        if (editorRef.current) {
          const val = editorRef.current.getValue()
          if (val !== lastEmittedValueRef.current) {
            lastEmittedValueRef.current = val
            onChangeRef.current(val)
          }
          editorRef.current.dispose()
          editorRef.current = null
        }
        decorationsCollectionRef.current = null
        return
      }

      setupMonaco()

      const editor = monaco.editor.create(element, {
        value: contentRef.current,
        language: language,
        theme: isDark ? 'dokudocs-dark' : 'dokudocs-light',
        minimap: { enabled: false },
        fontSize: 13,
        lineHeight: 20,
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        lineNumbers: 'on',
        lineNumbersMinChars: 3,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: 'on',
        padding: { top: 8, bottom: 8 },
        renderLineHighlight: 'all',
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        copyWithSyntaxHighlighting: false,
        maxTokenizationLineLength: 50000,
        glyphMargin: true,
        lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.On },
        autoClosingBrackets: 'always',
        autoClosingQuotes: 'always',
        autoClosingDelete: 'always',
        autoClosingOvertype: 'always',
        autoClosingComments: 'always',
        autoSurround: 'languageDefined',
        bracketPairColorization: { enabled: true },
        matchBrackets: 'always',
      })

      editorRef.current = editor
      lastEmittedValueRef.current = contentRef.current

      scheduleDiagnostics(editor, language)

      monaco.editor.onDidChangeMarkers(() => {
        if (editorRef.current) {
          updateErrorLens(editorRef.current)
        }
      })

      const updateHistoryState = () => {
        const model = editor.getModel()
        if (model) {
          const u =
            (model as unknown as { canUndo?: () => boolean }).canUndo?.() ??
            false
          const r =
            (model as unknown as { canRedo?: () => boolean }).canRedo?.() ??
            false
          setMonacoCanUndo(u)
          setMonacoCanRedo(r)
        }
      }

      updateHistoryState()

      editor.onDidChangeModelContent(() => {
        if (isUpdatingFromPropRef.current) return
        const val = editor.getValue()
        const model = editor.getModel()
        const lines = model ? model.getLineCount() : 1

        lastEmittedValueRef.current = val

        setStats((prev) => ({
          lines,
          words: prev.words,
        }))

        updateHistoryState()
        scheduleDiagnostics(editor, language)

        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current)
        }

        if (isLiveRenderActiveRef.current) {
          setHasPendingChanges(false)
          debounceTimerRef.current = setTimeout(() => {
            onChangeRef.current(val)
          }, 300)
        } else {
          setHasPendingChanges(true)
          debounceTimerRef.current = setTimeout(() => {
            onChangeRef.current(val)
          }, 500)
        }
      })

      editor.onDidBlurEditorText(() => {
        const val = editor.getValue()
        if (val !== lastEmittedValueRef.current) {
          flushChange(val)
        }
      })

      editor.onDidChangeCursorPosition((e) => {
        setCursorPos({
          line: e.position.lineNumber,
          col: e.position.column,
        })
      })

      editor.onDidScrollChange(() => {
        if (!showSyncScrollToggle || !syncScroll || isSyncingScrollRef.current)
          return
        const previewElem = previewScrollRef.current
        if (!previewElem) return
        const layout = editor.getLayoutInfo()
        const maxEditorScroll = editor.getScrollHeight() - layout.height
        if (maxEditorScroll <= 0) return
        const ratio = editor.getScrollTop() / maxEditorScroll
        const maxPreviewScroll =
          previewElem.scrollHeight - previewElem.clientHeight
        if (maxPreviewScroll <= 0) return
        isSyncingScrollRef.current = true
        previewElem.scrollTop = ratio * maxPreviewScroll
        requestAnimationFrame(() => {
          isSyncingScrollRef.current = false
        })
      })

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
        const val = editor.getValue()
        flushChange(val)
        toast.success('Preview synchronized')
      })

      if (language === 'markdown') {
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB, () => {
          const selection = editor.getSelection()
          if (!selection) return
          const model = editor.getModel()
          if (!model) return
          const selectedText = model.getValueInRange(selection)
          if (selectedText.length > 0) {
            const isBold =
              selectedText.startsWith('**') &&
              selectedText.endsWith('**') &&
              selectedText.length >= 4
            if (isBold) {
              const unwrapped = selectedText.slice(2, -2)
              editor.executeEdits('smart-bold', [
                { range: selection, text: unwrapped },
              ])
              editor.setSelection(
                new monaco.Range(
                  selection.startLineNumber,
                  selection.startColumn,
                  selection.endLineNumber,
                  selection.startLineNumber === selection.endLineNumber
                    ? selection.endColumn - 4
                    : selection.endColumn
                )
              )
            } else {
              editor.executeEdits('smart-bold', [
                { range: selection, text: `**${selectedText}**` },
              ])
              editor.setSelection(
                new monaco.Range(
                  selection.startLineNumber,
                  selection.startColumn + 2,
                  selection.endLineNumber,
                  selection.startLineNumber === selection.endLineNumber
                    ? selection.endColumn + 2
                    : selection.endColumn
                )
              )
            }
          } else {
            editor.executeEdits('smart-bold', [
              { range: selection, text: '****' },
            ])
            editor.setPosition({
              lineNumber: selection.startLineNumber,
              column: selection.startColumn + 2,
            })
          }
        })

        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, () => {
          const selection = editor.getSelection()
          if (!selection) return
          const model = editor.getModel()
          if (!model) return
          const selectedText = model.getValueInRange(selection)
          if (selectedText.length > 0) {
            const isItalic =
              (selectedText.startsWith('*') &&
                selectedText.endsWith('*') &&
                selectedText.length >= 2 &&
                !selectedText.startsWith('**')) ||
              (selectedText.startsWith('_') &&
                selectedText.endsWith('_') &&
                selectedText.length >= 2)
            if (isItalic) {
              const unwrapped = selectedText.slice(1, -1)
              editor.executeEdits('smart-italic', [
                { range: selection, text: unwrapped },
              ])
              editor.setSelection(
                new monaco.Range(
                  selection.startLineNumber,
                  selection.startColumn,
                  selection.endLineNumber,
                  selection.startLineNumber === selection.endLineNumber
                    ? selection.endColumn - 2
                    : selection.endColumn
                )
              )
            } else {
              editor.executeEdits('smart-italic', [
                { range: selection, text: `*${selectedText}*` },
              ])
              editor.setSelection(
                new monaco.Range(
                  selection.startLineNumber,
                  selection.startColumn + 1,
                  selection.endLineNumber,
                  selection.startLineNumber === selection.endLineNumber
                    ? selection.endColumn + 1
                    : selection.endColumn
                )
              )
            }
          } else {
            editor.executeEdits('smart-italic', [
              { range: selection, text: '**' },
            ])
            editor.setPosition({
              lineNumber: selection.startLineNumber,
              column: selection.startColumn + 1,
            })
          }
        })

        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
          const selection = editor.getSelection()
          if (!selection) return
          const model = editor.getModel()
          if (!model) return
          const selectedText = model.getValueInRange(selection)
          if (selectedText.length > 0) {
            editor.executeEdits('smart-link', [
              { range: selection, text: `[${selectedText}](url)` },
            ])
          } else {
            editor.executeEdits('smart-link', [
              { range: selection, text: '[](url)' },
            ])
            editor.setPosition({
              lineNumber: selection.startLineNumber,
              column: selection.startColumn + 1,
            })
          }
        })
      }
    },
    [
      isDark,
      language,
      syncScroll,
      showSyncScrollToggle,
      flushChange,
      scheduleDiagnostics,
      updateErrorLens,
    ]
  )

  /* eslint-disable react-hooks/refs */
  if (editorRef.current) {
    const themeName = isDark ? 'dokudocs-dark' : 'dokudocs-light'
    monaco.editor.setTheme(themeName)

    if (content !== lastPropContentRef.current) {
      lastPropContentRef.current = content
      const editor = editorRef.current
      const model = editor.getModel()
      if (model && model.getValue() !== content) {
        lastEmittedValueRef.current = content
        const selection = editor.getSelection()
        isUpdatingFromPropRef.current = true
        editor.executeEdits('external-update', [
          {
            range: model.getFullModelRange(),
            text: content,
          },
        ])
        if (selection && editor.hasTextFocus()) {
          editor.setSelection(selection)
        }
        scheduleDiagnostics(editor, language)
        isUpdatingFromPropRef.current = false
      }
    }

    if (viewMode !== 'preview') {
      requestAnimationFrame(() => {
        editorRef.current?.layout()
      })
    }
  }
  /* eslint-enable react-hooks/refs */

  const handleUndo = () => {
    editorRef.current?.trigger('toolbar', 'undo', null)
    editorRef.current?.focus()
    const model = editorRef.current?.getModel()
    if (model) {
      setMonacoCanUndo(
        (model as unknown as { canUndo?: () => boolean }).canUndo?.() ?? false
      )
      setMonacoCanRedo(
        (model as unknown as { canRedo?: () => boolean }).canRedo?.() ?? false
      )
    }
  }

  const handleRedo = () => {
    editorRef.current?.trigger('toolbar', 'redo', null)
    editorRef.current?.focus()
    const model = editorRef.current?.getModel()
    if (model) {
      setMonacoCanUndo(
        (model as unknown as { canUndo?: () => boolean }).canUndo?.() ?? false
      )
      setMonacoCanRedo(
        (model as unknown as { canRedo?: () => boolean }).canRedo?.() ?? false
      )
    }
  }

  const handleSearch = () => {
    editorRef.current?.getAction('actions.find')?.run()
  }

  const handleSwitchViewMode = useCallback(
    (
      newViewMode: EditorViewMode,
      newPreviewMode?: 'view' | 'edit'
    ) => {
      if (editorRef.current) {
        const val = editorRef.current.getValue()
        if (val !== lastEmittedValueRef.current) {
          flushChange(val)
        }
      }
      setStoreViewMode(userId, newViewMode)
      if (newPreviewMode) {
        setStorePreviewMode(userId, newPreviewMode)
      }
    },
    [userId, flushChange, setStoreViewMode, setStorePreviewMode]
  )

  const handleCopyCode = () => {
    const text = editorRef.current?.getValue() ?? content
    navigator.clipboard.writeText(text)
    toast.success('Code copied to clipboard')
  }

  const toggleLiveRender = () => {
    const next = !isLiveRenderActive
    setStoreIsLiveRenderActive(userId, next)
    if (next && editorRef.current) {
      const val = editorRef.current.getValue()
      flushChange(val)
    }
    toast.info(
      next
        ? 'Live render enabled'
        : 'Live render paused (Press Sync or Ctrl+Enter to update preview)'
    )
  }

  const toggleSyncScroll = () => {
    const next = !syncScroll
    setStoreSyncScroll(userId, next)
    toast.info(next ? 'Sync scroll enabled' : 'Sync scroll disabled')
  }

  const handlePreviewScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (
      !showSyncScrollToggle ||
      !syncScroll ||
      !editorRef.current ||
      isSyncingScrollRef.current
    )
      return
    const previewElem = e.currentTarget
    const maxPreviewScroll = previewElem.scrollHeight - previewElem.clientHeight
    if (maxPreviewScroll <= 0) return
    const ratio = previewElem.scrollTop / maxPreviewScroll
    const editor = editorRef.current
    const layout = editor.getLayoutInfo()
    const maxEditorScroll = editor.getScrollHeight() - layout.height
    if (maxEditorScroll <= 0) return
    isSyncingScrollRef.current = true
    editor.setScrollTop(ratio * maxEditorScroll)
    requestAnimationFrame(() => {
      isSyncingScrollRef.current = false
    })
  }

  const navigateToSource = useCallback(
    (targetOrTable: string, columnOrHeader?: string) => {
      const editor = editorRef.current
      if (!editor) return

      const model = editor.getModel()
      if (!model) return

      const lines = model.getLinesContent()
      let targetLine = -1

      if (columnOrHeader !== undefined) {
        let inTargetTable = false
        const tableRegex = new RegExp(
          `^\\s*Table\\s+["']?${targetOrTable}["']?\\b`,
          'i'
        )
        const colRegex = columnOrHeader
          ? new RegExp(`^\\s*["']?${columnOrHeader}["']?\\b`, 'i')
          : null

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          if (!inTargetTable) {
            if (tableRegex.test(line)) {
              inTargetTable = true
              targetLine = i + 1
              if (!columnOrHeader) break
            }
          } else {
            if (line.trim().startsWith('}') && !line.includes('{')) {
              break
            }
            if (colRegex && colRegex.test(line)) {
              targetLine = i + 1
              break
            }
          }
        }
      } else {
        const cleanTarget = targetOrTable
          .replace(/^#+\s*/, '')
          .trim()
          .toLowerCase()
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          const cleanLine = line
            .replace(/^#+\s*/, '')
            .trim()
            .toLowerCase()
          if (
            cleanLine === cleanTarget ||
            line.toLowerCase().includes(cleanTarget)
          ) {
            targetLine = i + 1
            break
          }
        }
      }

      if (targetLine > 0) {
        editor.revealLineInCenter(targetLine)
        editor.setPosition({ lineNumber: targetLine, column: 1 })
        editor.setSelection(
          new monaco.Range(
            targetLine,
            1,
            targetLine,
            model.getLineMaxColumn(targetLine)
          )
        )
        editor.focus()
      }
    },
    []
  )

  const handleDividerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsResizing(true)
    const container = splitContainerRef.current
    if (!container) return

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0) return
      const newPercent = Math.min(
        Math.max(((moveEvent.clientX - rect.left) / rect.width) * 100, 15),
        85
      )
      setStoreSplitPercent(userId, Math.round(newPercent))
    }

    const handlePointerUp = () => {
      setIsResizing(false)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }

  return (
    <>
      <div className='relative flex h-full w-full flex-col overflow-hidden bg-background'>
        {isResizing && (
          <div className='pointer-events-auto fixed inset-0 z-50 cursor-col-resize select-none' />
        )}

        <div
          ref={splitContainerRef}
          className='relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden lg:flex-row'
        >
          <div
            style={{
              width: viewMode === 'code' ? '100%' : `${splitPercent}%`,
              flex: viewMode === 'code' ? '1 1 0%' : 'none',
              display: viewMode === 'preview' ? 'none' : 'flex',
            }}
            className={`h-full flex-col bg-background ${
              viewMode === 'split' ? 'border-r border-border/80' : ''
            } min-h-0 shrink-0 overflow-hidden`}
          >
            <div className='flex shrink-0 items-center justify-between gap-2 overflow-x-auto border-b border-border/60 bg-muted/20 px-3 py-1.5'>
              <div className='flex shrink-0 items-center gap-1'>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={handleUndo}
                  disabled={!monacoCanUndo}
                  className='size-6 cursor-pointer text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-30'
                  title='Undo (⌘Z / Ctrl+Z)'
                >
                  <Undo2 className='size-3.5' />
                </Button>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={handleRedo}
                  disabled={!monacoCanRedo}
                  className='size-6 cursor-pointer text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-30'
                  title='Redo (⌘Y / Ctrl+Y)'
                >
                  <Redo2 className='size-3.5' />
                </Button>

                {customToolbarActions && (
                  <>
                    <div className='mx-1 h-4 w-px bg-border/60' />
                    {customToolbarActions}
                  </>
                )}
              </div>

              <div className='flex shrink-0 items-center gap-1.5'>
                {showSyncScrollToggle && (
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={toggleSyncScroll}
                    className={`h-6 gap-1 px-1.5 text-[11px] font-medium transition-colors ${
                      syncScroll
                        ? 'text-blue-600 hover:bg-blue-500/10 dark:text-blue-400'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    title={
                      syncScroll
                        ? 'Sync Scroll is ON (Click to Disable)'
                        : 'Sync Scroll is OFF (Click to Enable)'
                    }
                  >
                    <ChevronsUpDown className='size-3' />
                    <span className='hidden text-[10px] sm:inline'>
                      Sync Scroll
                    </span>
                  </Button>
                )}

                {showLiveRenderToggle && (
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={toggleLiveRender}
                    className={`h-6 gap-1 px-1.5 text-[11px] font-medium transition-colors ${
                      isLiveRenderActive
                        ? 'text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400'
                        : 'text-amber-600 hover:bg-amber-500/10 dark:text-amber-400'
                    }`}
                    title={
                      isLiveRenderActive
                        ? 'Live Render is ON (Click to Pause)'
                        : 'Live Render is PAUSED (Click to Enable)'
                    }
                  >
                    {isLiveRenderActive ? (
                      <>
                        <Zap className='size-3 fill-current' />
                        <span className='hidden text-[10px] sm:inline'>
                          Live ON
                        </span>
                      </>
                    ) : (
                      <>
                        <ZapOff className='size-3' />
                        <span className='hidden text-[10px] sm:inline'>
                          Live PAUSED
                        </span>
                      </>
                    )}
                  </Button>
                )}

                {showLiveRenderToggle &&
                  (!isLiveRenderActive || hasPendingChanges) && (
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={triggerManualSync}
                      className='h-6 animate-pulse gap-1 border-primary/50 px-2 text-[11px] font-medium text-primary hover:bg-primary/10'
                      title='Synchronize Preview (Ctrl+Enter)'
                    >
                      <RefreshCw className='size-3' />
                      <span>Sync</span>
                    </Button>
                  )}

                <div className='mx-0.5 h-4 w-px bg-border/60' />

                <Button
                  variant='ghost'
                  size='icon'
                  onClick={handleSearch}
                  className='size-6 text-muted-foreground hover:text-foreground'
                  title='Find & Replace (⌘F / Ctrl+F)'
                >
                  <Search className='size-3.5' />
                </Button>

                <Button
                  variant='ghost'
                  size='icon'
                  onClick={handleCopyCode}
                  className='size-6 text-muted-foreground hover:text-foreground'
                  title='Copy Code'
                >
                  <Copy className='size-3.5' />
                </Button>

                <Button
                  variant='ghost'
                  size='icon'
                  onClick={() => setShowShortcutsHelp(true)}
                  className='size-6 text-muted-foreground hover:text-foreground'
                  title='Shortcuts Help'
                >
                  <HelpCircle className='size-3.5' />
                </Button>
              </div>
            </div>

            <div className='relative min-h-0 flex-1 overflow-hidden bg-background'>
              <div ref={containerRefCallback} className='size-full' />
            </div>

            <div className='flex shrink-0 items-center justify-between border-t border-border/70 bg-muted/30 px-3 py-1 font-mono text-[11px] text-muted-foreground'>
              <div className='flex items-center gap-3'>
                <span>
                  Ln {cursorPos.line}, Col {cursorPos.col}
                </span>
                <span>•</span>
                <span>{stats.lines} lines</span>
              </div>
              <div className='flex items-center gap-2'>
                {hasPendingChanges && (
                  <span className='animate-pulse text-[10px] font-medium text-amber-500'>
                    Unsynced changes
                  </span>
                )}
              </div>
            </div>
          </div>

          {viewMode === 'split' && (
            <div
              onPointerDown={handleDividerPointerDown}
              className={`group relative z-20 hidden w-2 shrink-0 cursor-col-resize items-center justify-center bg-border/60 transition-colors select-none hover:bg-primary/50 lg:flex ${
                isResizing ? 'bg-primary ring-2 ring-primary/20' : ''
              }`}
            >
              <div className='absolute -inset-x-2 inset-y-0 cursor-col-resize' />
              <div className='h-8 w-0.5 rounded-full bg-muted-foreground/40 transition-colors group-hover:bg-primary-foreground' />
            </div>
          )}

          {viewMode !== 'code' && (
            <div
              style={{
                width:
                  viewMode === 'preview' ? '100%' : `${100 - splitPercent}%`,
                flex: viewMode === 'preview' ? '1 1 0%' : 'none',
              }}
              className='flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-background'
            >
              <div className='flex shrink-0 items-center justify-between border-b border-border/60 bg-muted/20 px-3 py-1.5 text-xs font-medium text-muted-foreground'>
                <div className='flex items-center gap-2'>
                  {previewLeftActions && (
                    <div className='flex shrink-0 items-center gap-1'>
                      {previewLeftActions}
                    </div>
                  )}
                  {previewIcon}
                  {previewTitle && (
                    <span className='text-xs font-medium text-foreground'>
                      {previewTitle}
                    </span>
                  )}
                  {badgeLabel && (
                    <span
                      className={
                        badgeColorClass ||
                        'rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground'
                      }
                    >
                      {badgeLabel}
                    </span>
                  )}
                </div>
                <div className='flex shrink-0 items-center gap-2'>
                  {showLiveRenderToggle && !isLiveRenderActive && (
                    <span className='rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400'>
                      Paused
                    </span>
                  )}
                  {previewToolbarActions && (
                    <div className='flex shrink-0 items-center gap-1'>
                      {previewToolbarActions}
                    </div>
                  )}
                </div>
              </div>
              <div className='relative min-h-0 flex-1 overflow-hidden'>
                {typeof previewContent === 'function'
                  ? /* eslint-disable-next-line react-hooks/refs */
                    previewContent({
                      scrollRef: previewScrollRef,
                      onScroll: handlePreviewScroll,
                      navigateToSource,
                    })
                  : previewContent}

                <div className='pointer-events-auto absolute right-5 bottom-5 z-30 select-none'>
                  <div className='flex items-center gap-1 rounded-full border border-border/80 bg-background/90 p-1 shadow-md backdrop-blur-md transition-all hover:border-border hover:shadow-lg'>
                    <Button
                      variant='ghost'
                      size='icon'
                      onClick={() =>
                        setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
                      }
                      className='size-7 cursor-pointer rounded-full text-muted-foreground transition-all hover:bg-muted/60 hover:text-foreground'
                      title={
                        resolvedTheme === 'dark'
                          ? 'Switch to Light theme'
                          : 'Switch to Dark theme'
                      }
                      aria-label='Toggle theme'
                    >
                      {resolvedTheme === 'dark' ? (
                        <Sun className='size-3.5 fill-amber-500/10 text-amber-500 transition-transform duration-300 hover:rotate-45' />
                      ) : (
                        <Moon className='size-3.5 fill-indigo-500/10 text-indigo-500 transition-transform duration-300 hover:-rotate-12' />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Floating sticky bottom-center view switcher */}
        <div className='pointer-events-auto absolute bottom-5 left-1/2 z-30 -translate-x-1/2 select-none'>
          <div className='flex items-center gap-1 rounded-full border border-border/80 bg-background/90 p-1 shadow-md backdrop-blur-md transition-all hover:border-border hover:shadow-lg'>
            <Button
              variant={viewMode === 'code' ? 'default' : 'ghost'}
              size='sm'
              onClick={() => handleSwitchViewMode('code')}
              className={`h-7 gap-1.5 rounded-full px-3 text-xs font-medium transition-all ${
                viewMode === 'code'
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              }`}
            >
              <Code2 className='size-3.5' />
              <span>Editor</span>
            </Button>
            <Button
              variant={viewMode === 'split' ? 'default' : 'ghost'}
              size='sm'
              onClick={() => handleSwitchViewMode('split', 'view')}
              className={`h-7 gap-1.5 rounded-full px-3 text-xs font-medium transition-all ${
                viewMode === 'split'
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              }`}
            >
              <Columns2 className='size-3.5' />
              <span>Split</span>
            </Button>
            <Button
              variant={viewMode === 'preview' ? 'default' : 'ghost'}
              size='sm'
              onClick={() => handleSwitchViewMode('preview')}
              className={`h-7 gap-1.5 rounded-full px-3 text-xs font-medium transition-all ${
                viewMode === 'preview'
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              }`}
            >
              <Eye className='size-3.5' />
              <span>Preview</span>
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={showShortcutsHelp} onOpenChange={setShowShortcutsHelp}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle className='text-base font-bold'>
              Editor Keyboard Shortcuts
            </DialogTitle>
            <DialogDescription className='text-xs'>
              High performance Monaco Editor keyboard shortcuts & controls
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-2 py-2 text-xs'>
            <div className='flex items-center justify-between border-b border-border/40 py-1.5'>
              <span className='text-muted-foreground'>Sync Preview</span>
              <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                ⌘ + Enter / Ctrl + Enter
              </kbd>
            </div>
            <div className='flex items-center justify-between border-b border-border/40 py-1.5'>
              <span className='text-muted-foreground'>Undo</span>
              <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                ⌘ + Z / Ctrl + Z
              </kbd>
            </div>
            <div className='flex items-center justify-between border-b border-border/40 py-1.5'>
              <span className='text-muted-foreground'>Redo</span>
              <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                ⌘ + Y / Ctrl + Y
              </kbd>
            </div>
            <div className='flex items-center justify-between border-b border-border/40 py-1.5'>
              <span className='text-muted-foreground'>Find & Replace</span>
              <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                ⌘ + F / Ctrl + F
              </kbd>
            </div>
            <div className='flex items-center justify-between border-b border-border/40 py-1.5'>
              <span className='text-muted-foreground'>Toggle Comment</span>
              <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                ⌘ + / / Ctrl + /
              </kbd>
            </div>
            <div className='flex items-center justify-between border-b border-border/40 py-1.5'>
              <span className='text-muted-foreground'>
                Multi-Cursor Selection
              </span>
              <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                Alt + Click / Option + Click
              </kbd>
            </div>
            {language === 'markdown' && (
              <>
                <div className='flex items-center justify-between border-b border-border/40 py-1.5'>
                  <span className='text-muted-foreground'>Bold</span>
                  <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                    ⌘ + B / Ctrl + B
                  </kbd>
                </div>
                <div className='flex items-center justify-between border-b border-border/40 py-1.5'>
                  <span className='text-muted-foreground'>Italic</span>
                  <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                    ⌘ + I / Ctrl + I
                  </kbd>
                </div>
                <div className='flex items-center justify-between border-b border-border/40 py-1.5'>
                  <span className='text-muted-foreground'>Insert Link</span>
                  <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                    ⌘ + K / Ctrl + K
                  </kbd>
                </div>
              </>
            )}
            <div className='flex items-center justify-between border-b border-border/40 py-1.5'>
              <span className='text-muted-foreground'>
                Smart Wrap Selection
              </span>
              <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                Type &#123;, [, (, &quot;, &apos;, `, *, _
              </kbd>
            </div>
            <div className='flex items-center justify-between py-1.5'>
              <span className='text-muted-foreground'>Move Line Up / Down</span>
              <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium'>
                Alt + ↑ / Alt + ↓
              </kbd>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
