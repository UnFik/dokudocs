import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, type RenderResult } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import { SearchProvider } from '@/context/search-provider'

const WORKSPACE_ID = '6f1b1d4e-0e0a-4a53-9a33-6c3e2f0a1c11'
const COMMAND_MENU_PLACEHOLDER = 'Search documents, projects, commands (⌘K)...'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setTheme: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  }
})

vi.mock('@/context/theme-provider', () => ({
  useTheme: () => ({ setTheme: mocks.setTheme }),
}))

function signIn(status: 'authenticated' | 'offline' | 'guest') {
  const auth = useAuthStore.getState().auth
  auth.reset()
  if (status === 'authenticated') auth.setSession(testSession())
  if (status === 'offline') {
    const { accessToken } = testSession()
    useAuthStore.setState((state) => ({
      auth: { ...state.auth, status: 'offline', accessToken, user: null },
    }))
  }
}

type ShortcutModifier = 'Control' | 'Meta'

async function renderWithSearchProvider() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return await render(
    <QueryClientProvider client={queryClient}>
      <SearchProvider>{null}</SearchProvider>
    </QueryClientProvider>
  )
}

/**
 * Open the palette by shortcut, retrying while the keydown listener may not be mounted yet.
 * Waits between attempts so a successful toggle is not immediately undone by a second chord.
 */
async function openCommandPalette(
  screen: RenderResult,
  modifier: ShortcutModifier = 'Control'
) {
  await vi.waitFor(
    async () => {
      const isCommandPaletteOpen =
        document.querySelector(
          `[placeholder="${COMMAND_MENU_PLACEHOLDER}"]`
        ) !== null

      if (!isCommandPaletteOpen) {
        await userEvent.keyboard(`{${modifier}>}k{/${modifier}}`)
      }

      await expect
        .element(screen.getByPlaceholder(COMMAND_MENU_PLACEHOLDER))
        .toBeInTheDocument()
    },
    { interval: 50, timeout: 5000 }
  )
}

describe('SearchProvider and CommandMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetch.mockImplementation(async () => jsonResponse([]))
    vi.stubGlobal('fetch', mocks.fetch)
    signIn('authenticated')
  })

  it('renders the command palette when the palette is open', async () => {
    const screen = await renderWithSearchProvider()
    const { getByPlaceholder, getByText } = screen

    await openCommandPalette(screen)

    await expect
      .element(getByPlaceholder(COMMAND_MENU_PLACEHOLDER))
      .toBeInTheDocument()
    await expect
      .element(getByText('Theme', { exact: true }))
      .toBeInTheDocument()
    await expect.element(getByText('Light Theme')).toBeInTheDocument()
    await expect.element(getByText('Dark Theme')).toBeInTheDocument()
    await expect.element(getByText('System Default')).toBeInTheDocument()
    await expect
      .element(getByText('Quick Create', { exact: true }))
      .toBeInTheDocument()
    await expect
      .element(getByText('Navigation', { exact: true }))
      .toBeInTheDocument()
  })

  it('does not show the dialog content when search is closed', async () => {
    const { getByPlaceholder } = await renderWithSearchProvider()

    await expect
      .element(getByPlaceholder(COMMAND_MENU_PLACEHOLDER))
      .not.toBeInTheDocument()
  })

  it.each([
    ['Ctrl', 'Control'],
    ['Cmd', 'Meta'],
  ] as const)(
    'opens the command menu when %s + K is pressed',
    async (_label, modifier) => {
      const screen = await renderWithSearchProvider()

      await expect
        .element(screen.getByPlaceholder(COMMAND_MENU_PLACEHOLDER))
        .not.toBeInTheDocument()

      await openCommandPalette(screen, modifier)

      await expect
        .element(screen.getByPlaceholder(COMMAND_MENU_PLACEHOLDER))
        .toBeInTheDocument()
    }
  )

  it('navigates to a top-level route and closes the palette when a nav item is selected', async () => {
    const screen = await renderWithSearchProvider()

    await openCommandPalette(screen)

    await userEvent.click(screen.getByText('Recent Documents'))

    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/dashboard' })
    await expect
      .element(screen.getByPlaceholder(COMMAND_MENU_PLACEHOLDER))
      .not.toBeInTheDocument()
  })

  it('applies theme and closes the palette when a theme command is chosen', async () => {
    const screen = await renderWithSearchProvider()

    await openCommandPalette(screen)

    await userEvent.click(screen.getByText('Dark Theme'))

    expect(mocks.setTheme).toHaveBeenCalledWith('dark')
    await expect
      .element(screen.getByPlaceholder(COMMAND_MENU_PLACEHOLDER))
      .not.toBeInTheDocument()
  })

  it('shows empty state when the filter matches nothing', async () => {
    const screen = await renderWithSearchProvider()

    await openCommandPalette(screen)

    await userEvent.fill(
      screen.getByPlaceholder(COMMAND_MENU_PLACEHOLDER),
      'zzzz-no-match-xxxx'
    )

    await expect
      .element(screen.getByText('No matching documents or projects found.'))
      .toBeInTheDocument()
  })

  it.each(['guest', 'offline'] as const)(
    'leaves Ctrl+K to the browser when the session is %s',
    async (status) => {
      signIn(status)
      const screen = await renderWithSearchProvider()

      const event = new KeyboardEvent('keydown', {
        key: 'k',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
      document.dispatchEvent(event)

      expect(event.defaultPrevented).toBe(false)
      await expect
        .element(screen.getByPlaceholder(COMMAND_MENU_PLACEHOLDER))
        .not.toBeInTheDocument()
    }
  )

  it('does not open when a field already handled Ctrl+K', async () => {
    const screen = await renderWithSearchProvider()
    const field = document.createElement('div')
    field.addEventListener('keydown', (event) => event.preventDefault())
    document.body.append(field)

    field.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'k',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    )

    await expect
      .element(screen.getByPlaceholder(COMMAND_MENU_PLACEHOLDER))
      .not.toBeInTheDocument()
    field.remove()
  })

  it('asks the server for nothing until the menu is opened', async () => {
    const screen = await renderWithSearchProvider()
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(mocks.fetch.mock.calls.map(([u]) => String(u))).toEqual([])

    await openCommandPalette(screen)

    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalled())
  })

  describe('document results from the server', () => {
    const hit = (over: Record<string, unknown> = {}) => ({
      id: 'b4d13df7-76a2-4da5-8817-91d40f832abd',
      title: 'Release notes',
      type: 'markdown',
      projectId: null,
      projectName: '',
      isDraft: false,
      updatedAt: '2026-10-12T00:00:00Z',
      ...over,
    })

    function serve(hits: unknown[], status = 200) {
      mocks.fetch.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/v1/documents/search'))
          return status === 200
            ? jsonResponse(hits)
            : jsonResponse({ title: 'boom' }, status)
        if (url.includes('/api/v1/workspaces'))
          return jsonResponse([
            { id: WORKSPACE_ID, name: 'Acme', plan: 'free', role: 'owner' },
          ])
        return jsonResponse([])
      })
    }

    const searchCalls = () =>
      mocks.fetch.mock.calls
        .map(([input]) => String(input))
        .filter((url) => url.includes('/api/v1/documents/search'))

    it('lists recent documents as soon as the menu opens', async () => {
      serve([hit()])
      const screen = await renderWithSearchProvider()

      await openCommandPalette(screen)

      await expect.element(screen.getByText('Release notes')).toBeVisible()
      expect(searchCalls()[0]).not.toContain('q=')
    })

    it('searches once the typing pauses and shows where the words were found', async () => {
      const found = hit({
        title: 'Migration guide',
        matchedOn: 'body',
        snippet: 'finishes in \u0001November\u0002 after review',
      })
      mocks.fetch.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/v1/documents/search'))
          return jsonResponse(url.includes('q=november') ? [found] : [hit()])
        if (url.includes('/api/v1/workspaces'))
          return jsonResponse([
            { id: WORKSPACE_ID, name: 'Acme', plan: 'free', role: 'owner' },
          ])
        return jsonResponse([])
      })
      const screen = await renderWithSearchProvider()
      await openCommandPalette(screen)

      await userEvent.type(
        screen.getByPlaceholder(COMMAND_MENU_PLACEHOLDER),
        'november'
      )

      await expect.element(screen.getByText('Migration guide')).toBeVisible()
      await expect
        .element(screen.getByText('November', { exact: true }))
        .toBeVisible()
      const queries = searchCalls().filter((url) => url.includes('q='))
      expect(queries).toHaveLength(1)
      expect(queries[0]).toContain('q=november')
    })

    it('does not search for a single letter', async () => {
      serve([hit()])
      const screen = await renderWithSearchProvider()
      await openCommandPalette(screen)

      await userEvent.type(
        screen.getByPlaceholder(COMMAND_MENU_PLACEHOLDER),
        'n'
      )
      await new Promise((resolve) => setTimeout(resolve, 500))

      expect(searchCalls().filter((url) => url.includes('q='))).toHaveLength(0)
    })

    it('opens the chosen document and closes the menu', async () => {
      serve([hit()])
      const screen = await renderWithSearchProvider()
      await openCommandPalette(screen)

      await userEvent.click(screen.getByText('Release notes'))

      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/docs/$docId',
        params: { docId: 'b4d13df7-76a2-4da5-8817-91d40f832abd' },
      })
      await expect
        .element(screen.getByPlaceholder(COMMAND_MENU_PLACEHOLDER))
        .not.toBeInTheDocument()
    })

    it('says the search failed and retries on request', async () => {
      serve([], 500)
      const screen = await renderWithSearchProvider()
      await openCommandPalette(screen)

      await expect
        .element(
          screen.getByText(
            'Search failed. Check your connection and try again.'
          )
        )
        .toBeVisible()

      serve([hit()])
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

      await expect.element(screen.getByText('Release notes')).toBeVisible()
    })
  })
})
