import { useEffect, useRef } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { TextSelection } from 'prosemirror-state'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import { SearchProvider } from '@/context/search-provider'
import type { createDocumentBodyEditor } from '@/features/docs/lib/prosemirror/createDocumentBodyEditor'
import {
  mountTestEditor,
  paragraphsBody,
  runStart,
} from '@/features/docs/lib/prosemirror/editorTestKit'

const PLACEHOLDER = 'Search documents, projects, commands (⌘K)...'

type Editor = ReturnType<typeof createDocumentBodyEditor>

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return { ...actual, useNavigate: () => vi.fn() }
})

vi.mock('@/context/theme-provider', () => ({
  useTheme: () => ({ setTheme: vi.fn() }),
}))

function EditorPage({
  onReady,
  onLinkRequest,
}: {
  onReady: (editor: Editor) => void
  onLinkRequest: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const mounted = mountTestEditor(paragraphsBody('see docs now'), {
      onLinkRequest,
    })
    hostRef.current?.append(mounted.host)
    onReady(mounted.editor)
    return () => mounted.cleanup()
  }, [onReady, onLinkRequest])
  return <div ref={hostRef} />
}

describe('page search beside the editor', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse([]))
    )
    const auth = useAuthStore.getState().auth
    auth.reset()
    auth.setSession(testSession())
  })

  async function mountPage() {
    let editor!: Editor
    const onLinkRequest = vi.fn()
    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <SearchProvider>
          <EditorPage
            onReady={(next) => void (editor = next)}
            onLinkRequest={onLinkRequest}
          />
        </SearchProvider>
      </QueryClientProvider>
    )
    await expect.poll(() => Boolean(editor)).toBe(true)
    return { editor, screen, onLinkRequest }
  }

  function selectRange(editor: Editor, from: number, to: number) {
    const start = runStart(editor.view.state.doc, 'see docs now')
    editor.view.dispatch(
      editor.view.state.tr.setSelection(
        TextSelection.create(editor.view.state.doc, start + from, start + to)
      )
    )
  }

  it('opens search from a caret and gives focus back to the editor when it closes', async () => {
    const { editor, screen, onLinkRequest } = await mountPage()
    editor.view.focus()
    selectRange(editor, 4, 4)

    await userEvent.keyboard('{Control>}k{/Control}')
    await expect.element(screen.getByPlaceholder(PLACEHOLDER)).toBeVisible()
    expect(onLinkRequest).not.toHaveBeenCalled()

    await userEvent.keyboard('{Escape}')
    await expect
      .element(screen.getByPlaceholder(PLACEHOLDER))
      .not.toBeInTheDocument()
    await expect
      .poll(() => editor.view.dom.contains(document.activeElement))
      .toBe(true)
  })

  it('keeps Ctrl+K for the link field when text is selected', async () => {
    const { editor, screen, onLinkRequest } = await mountPage()
    editor.view.focus()
    selectRange(editor, 4, 8)

    await userEvent.keyboard('{Control>}k{/Control}')

    expect(onLinkRequest).toHaveBeenCalledTimes(1)
    await expect
      .element(screen.getByPlaceholder(PLACEHOLDER))
      .not.toBeInTheDocument()
  })
})
