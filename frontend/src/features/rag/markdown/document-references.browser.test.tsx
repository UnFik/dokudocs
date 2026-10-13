import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/styles/index.css'
import { jsonResponse } from '@/test-utils/auth'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { ChatMessage, RunProgress } from '../chat-thread'
import type { ChatRunView } from '../use-chat-run'
import { CurrentDocument } from './document-references'

const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const runbook = '3f2a9c1e-5b7d-4e8a-9c3b-1a2b3c4d5e6f'
const secret = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'
const now = '2026-10-13T00:00:00Z'

const idle: ChatRunView = {
  phase: 'idle',
  runID: null,
  question: '',
  draft: '',
  step: '',
  tools: [],
  outcome: null,
  message: '',
  error: null,
}

const message = (content: string, extra: object = {}) => ({
  id: 'b5b7593c-3a2d-45a4-a47d-47e8a1c8136b',
  conversationId: 'c5b7593c-3a2d-45a4-a47d-47e8a1c8136b',
  role: 'assistant' as const,
  content,
  citations: [],
  coveragePartial: false,
  sourcesMayBeIncomplete: false,
  createdAt: now,
  ...extra,
})

function setup() {
  const lookups: string[][] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/v1/rag/documents/lookup') {
        const ids = (JSON.parse(String(init?.body)) as { ids: string[] }).ids
        lookups.push(ids)
        return jsonResponse(
          ids.includes(runbook)
            ? [
                {
                  id: runbook,
                  title: 'Runbook',
                  type: 'markdown',
                  projectName: 'Platform',
                  categories: [],
                },
              ]
            : []
        )
      }
      if (url.pathname === `/api/v1/documents/${runbook}`)
        return jsonResponse({
          id: runbook,
          workspaceId: workspaceID,
          title: 'Runbook',
          type: 'markdown',
          content: '# Runbook\n\nHow we deploy.',
          authorId: 'u1',
          author: { id: 'u1', name: 'Ana', email: 'ana@example.com' },
          isDraft: false,
          visibility: 'workspace',
          createdAt: now,
          updatedAt: now,
        })
      return jsonResponse({ title: 'not found' }, 404)
    })
  )
  return {
    lookups,
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  }
}

afterEach(() => vi.unstubAllGlobals())

const inClient = (queryClient: QueryClient, node: React.ReactNode) => (
  <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
)

it('turns a doc: link into a link to the document, with one lookup for the whole answer', async () => {
  const { lookups, queryClient } = setup()
  const screen = await render(
    inClient(
      queryClient,
      <ChatMessage
        workspaceID={workspaceID}
        message={message(
          `Start with [the runbook](doc:${runbook}) and again [here](doc:${runbook}).`
        )}
      />
    )
  )
  const link = screen.getByRole('link', { name: 'the runbook' })
  await expect
    .element(link)
    .toHaveAttribute('href', `/docs/${runbook}?workspaceId=${workspaceID}`)
  expect(lookups).toEqual([[runbook]])
})

it('shows a document the member cannot read, or that does not exist, as plain text', async () => {
  const { queryClient } = setup()
  const screen = await render(
    inClient(
      queryClient,
      <ChatMessage
        workspaceID={workspaceID}
        message={message(`See [the salaries](doc:${secret}).`)}
      />
    )
  )
  await expect.element(screen.getByText(/the salaries/)).toBeVisible()
  await vi.waitFor(() =>
    expect(document.querySelectorAll('a[href*="/docs/"]')).toHaveLength(0)
  )
})

it('opens a card with the preview, title, type and project on hover, and closes it with Escape', async () => {
  const { queryClient } = setup()
  const screen = await render(
    inClient(
      queryClient,
      <ChatMessage
        workspaceID={workspaceID}
        message={message(`Read [the runbook](doc:${runbook}).`)}
      />
    )
  )
  const link = screen.getByRole('link', { name: 'the runbook' })
  await userEvent.hover(link)
  const card = screen.getByRole('img', { name: 'Preview of Runbook' })
  await expect.element(card).toBeVisible()
  await expect.element(screen.getByText('Platform')).toBeVisible()
  await expect.element(screen.getByText('Markdown')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await vi.waitFor(() =>
    expect(document.querySelector('[data-card-thumbnail]')).toBeNull()
  )
})

it('opens the same card from the keyboard', async () => {
  const { queryClient } = setup()
  const screen = await render(
    inClient(
      queryClient,
      <ChatMessage
        workspaceID={workspaceID}
        message={message(`Read [the runbook](doc:${runbook}).`)}
      />
    )
  )
  await userEvent.tab()
  await expect
    .element(screen.getByRole('link', { name: 'the runbook' }))
    .toHaveFocus()
  await expect
    .element(screen.getByRole('img', { name: 'Preview of Runbook' }))
    .toBeVisible()
})

it('gives a tool that worked on a document a chip that links to it', async () => {
  const { queryClient } = setup()
  const screen = await render(
    inClient(
      queryClient,
      <ChatMessage
        workspaceID={workspaceID}
        message={message('Done.', {
          meta: {
            agent: true,
            tools: ['read_document', 'list_documents'],
            calls: [
              { name: 'read_document', documentId: runbook },
              { name: 'list_documents' },
            ],
          },
        })}
      />
    )
  )
  await expect.element(screen.getByText('list_documents')).toBeVisible()
  await expect
    .element(screen.getByRole('link', { name: 'Runbook' }))
    .toHaveAttribute('href', `/docs/${runbook}?workspaceId=${workspaceID}`)
})

it('still shows the tool names of an answer saved before calls were kept', async () => {
  const { queryClient } = setup()
  const screen = await render(
    inClient(
      queryClient,
      <ChatMessage
        workspaceID={workspaceID}
        message={message('Done.', {
          meta: { agent: true, tools: ['read_document', 'read_document'] },
        })}
      />
    )
  )
  await expect.element(screen.getByText('read_document')).toBeVisible()
  expect(document.querySelectorAll('a')).toHaveLength(0)
})

it('marks a tool chip whose document is gone', async () => {
  const { queryClient } = setup()
  const screen = await render(
    inClient(
      queryClient,
      <ChatMessage
        workspaceID={workspaceID}
        message={message('Done.', {
          meta: {
            agent: true,
            calls: [{ name: 'read_document', documentId: secret }],
          },
        })}
      />
    )
  )
  await expect.element(screen.getByText('Document not available')).toBeVisible()
  expect(document.querySelectorAll('a')).toHaveLength(0)
})

it('shows the document a running tool works on', async () => {
  const { queryClient } = setup()
  const screen = await render(
    inClient(
      queryClient,
      <RunProgress
        workspaceID={workspaceID}
        view={{
          ...idle,
          phase: 'running',
          question: 'q',
          tools: [
            { name: 'read_document', state: 'running', documentId: runbook },
          ],
        }}
      />
    )
  )
  await expect
    .element(screen.getByRole('link', { name: 'Runbook' }))
    .toBeVisible()
  await expect.element(screen.getByText('running')).toBeVisible()
})

it('does not leave the document the panel is on, but still shows its card', async () => {
  const { queryClient } = setup()
  const screen = await render(
    inClient(
      queryClient,
      <CurrentDocument documentID={runbook}>
        <ChatMessage
          workspaceID={workspaceID}
          message={message(`Read [the runbook](doc:${runbook}).`)}
        />
      </CurrentDocument>
    )
  )
  await expect
    .element(screen.getByLabelText('Runbook (this document)'))
    .toBeVisible()
  expect(document.querySelectorAll('a[href*="/docs/"]')).toHaveLength(0)
  await userEvent.hover(screen.getByLabelText('Runbook (this document)'))
  await expect
    .element(screen.getByRole('img', { name: 'Preview of Runbook' }))
    .toBeVisible()
})

it('gives a source the same card', async () => {
  const { queryClient } = setup()
  const screen = await render(
    inClient(
      queryClient,
      <ChatMessage
        workspaceID={workspaceID}
        message={message('Answer.', {
          citations: [
            {
              documentId: runbook,
              nodeId: '5d1c2b3a-4e5f-4a6b-8c7d-0e1f2a3b4c5d',
              bodyVersion: 1,
              ordinal: 0,
              documentTitle: 'Runbook',
              projectName: 'Platform',
              breadcrumb: '',
              quotedText: 'We deploy on Fridays.',
              sourceChanged: false,
            },
          ],
        })}
      />
    )
  )
  await userEvent.hover(screen.getByRole('link', { name: /open block/i }))
  await expect
    .element(screen.getByRole('img', { name: 'Preview of Runbook' }))
    .toBeVisible()
})
