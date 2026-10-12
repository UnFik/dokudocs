import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/styles/index.css'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import type { AgentAction, RAGMessage } from '@/lib/domain-api'
import { AskForm, ChatMessages, RunProgress } from './chat-thread'
import type { ChatRunView } from './use-chat-run'

const conversationID = '65b7593c-3a2d-45a4-a47d-47e8a1c8136b'
const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const actionID = 'a1c3c1f2-90b4-4f0b-9a8e-3c1d6c0d8f11'

const action: AgentAction = {
  id: actionID,
  conversationId: conversationID,
  tool: 'trash_document',
  summary: 'Move the document to the trash',
  status: 'pending',
  result: '',
}
const answer: RAGMessage = {
  id: 'ff27eac4-3eea-4ced-b4fa-e7f6b1c81ed4',
  conversationId: conversationID,
  role: 'assistant',
  content: 'Approve the card to move it to the trash.',
  citations: [],
  coveragePartial: false,
  sourcesMayBeIncomplete: false,
  meta: {
    agent: true,
    tools: ['read_document', 'trash_document'],
    actions: [actionID],
  },
  createdAt: '2026-10-01T00:00:01.000Z',
}

function mount(ui: React.ReactNode) {
  useAuthStore.getState().auth.setSession(testSession())
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {ui}
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

it('shows what the assistant did and runs an action only when approved', async () => {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    if (
      new URL(url).pathname.endsWith(`/actions/${actionID}`) &&
      init?.method === 'POST'
    )
      return Promise.resolve(
        jsonResponse({ ...action, status: 'approved', result: '{}' })
      )
    return Promise.resolve(jsonResponse({}))
  })
  vi.stubGlobal('fetch', fetch)
  const screen = await mount(
    <ChatMessages
      messages={[answer]}
      actions={[action]}
      workspaceID={workspaceID}
      conversationID={conversationID}
      queryKey={['rag-conversation']}
    />
  )
  await expect.element(screen.getByText('Tools used:')).toBeVisible()
  await expect.element(screen.getByText('read_document')).toBeVisible()
  await expect.element(screen.getByText('trash_document')).toBeVisible()
  await expect
    .element(screen.getByText('Move the document to the trash'))
    .toBeVisible()
  expect(fetch).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
  await expect.element(screen.getByText('Approved and done.')).toBeVisible()
  const [, init] = fetch.mock.calls.find(([url]) =>
    String(url).includes('/actions/')
  )!
  expect(JSON.parse(String(init?.body))).toEqual({ approve: true })
})

it('a declined action says nothing changed', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(jsonResponse({ ...action, status: 'declined' }))
    )
  )
  const screen = await mount(
    <ChatMessages
      messages={[answer]}
      actions={[action]}
      workspaceID={workspaceID}
      conversationID={conversationID}
      queryKey={['rag-conversation']}
    />
  )
  await userEvent.click(screen.getByRole('button', { name: 'Decline' }))
  await expect
    .element(screen.getByText('Declined. Nothing was changed.'))
    .toBeVisible()
})

it('offers skills when the question starts with a slash', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          skills: [
            {
              id: '0f8fad5b-d9cb-469f-a165-70867728950e',
              name: 'write-adr',
              description: 'Draft an ADR',
            },
            {
              id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
              name: 'summary',
              description: 'Three bullets',
            },
          ],
        })
      )
    )
  )
  const asked: string[] = []
  const screen = await mount(
    <AskForm
      id='q'
      pending={false}
      placeholder='Ask'
      onAsk={(q) => asked.push(q)}
      language='en'
      onLanguage={() => {}}
    />
  )
  const box = screen.getByRole('textbox', { name: 'Ask a question' })
  await userEvent.fill(box, '/wr')
  await userEvent.click(screen.getByRole('button', { name: /\/write-adr/ }))
  await expect.element(box).toHaveValue('/write-adr ')
  expect(
    screen.getByRole('button', { name: /\/summary/ }).elements()
  ).toHaveLength(0)
  await userEvent.type(box, 'for the login change')
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  expect(asked).toEqual(['/write-adr for the login change'])
})

it('says plainly when an approved action never recorded how it ended', async () => {
  const screen = await mount(
    <ChatMessages
      messages={[answer]}
      actions={[{ ...action, status: 'approved', result: '' }]}
      workspaceID={workspaceID}
      conversationID={conversationID}
      queryKey={['history']}
    />
  )
  await expect.element(screen.getByText(/never recorded/)).toBeVisible()
  await expect.element(screen.getByText(/It is not run again/)).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Approve' }).elements()
  ).toHaveLength(0)
})

const skillList = {
  skills: [
    {
      id: '0f8fad5b-d9cb-469f-a165-70867728950e',
      name: 'write-adr',
      description: 'Draft an ADR',
    },
    {
      id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      name: 'summary',
      description: 'Three bullets',
    },
  ],
}

async function mountAsk(asked: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(jsonResponse(skillList)))
  )
  const screen = await mount(
    <AskForm
      id='q'
      pending={false}
      placeholder='Ask'
      onAsk={(q) => asked.push(q)}
      language='en'
      onLanguage={() => {}}
    />
  )
  return {
    screen,
    box: screen.getByRole('textbox', { name: 'Ask a question' }),
  }
}

it('sends on Enter', async () => {
  const asked: string[] = []
  const { box } = await mountAsk(asked)
  await userEvent.click(box)
  await userEvent.keyboard('How does recovery work?{Enter}')
  expect(asked).toEqual(['How does recovery work?'])
  await expect.element(box).toHaveValue('')
})

it('starts a new line on Shift+Enter and sends nothing', async () => {
  const asked: string[] = []
  const { box } = await mountAsk(asked)
  await userEvent.click(box)
  await userEvent.keyboard('first{Shift>}{Enter}{/Shift}second')
  await expect.element(box).toHaveValue('first\nsecond')
  expect(asked).toEqual([])
})

it('does not send an empty question on Enter', async () => {
  const asked: string[] = []
  const { box } = await mountAsk(asked)
  await userEvent.click(box)
  await userEvent.keyboard('   {Enter}')
  expect(asked).toEqual([])
})

it('leaves Enter to the input method while text is being composed', async () => {
  const asked: string[] = []
  const { box } = await mountAsk(asked)
  await userEvent.fill(box, 'konnichiwa')
  const element = box.element()
  element.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    })
  )
  expect(asked).toEqual([])
  await expect.element(box).toHaveValue('konnichiwa')
})

it('picks the highlighted skill on Enter instead of sending', async () => {
  const asked: string[] = []
  const { screen, box } = await mountAsk(asked)
  await userEvent.click(box)
  await userEvent.keyboard('/')
  await expect
    .element(screen.getByRole('button', { name: /\/write-adr/ }))
    .toBeVisible()
  await userEvent.keyboard('{ArrowDown}{Enter}')
  await expect.element(box).toHaveValue('/summary ')
  expect(asked).toEqual([])
  await userEvent.keyboard('in short{Enter}')
  expect(asked).toEqual(['/summary in short'])
})

it('keeps Enter as a new line on a touch keyboard', async () => {
  const asked: string[] = []
  const { box } = await mountAsk(asked)
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === '(pointer: coarse)',
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }))
  )
  await userEvent.click(box)
  await userEvent.keyboard('one{Enter}two')
  await expect.element(box).toHaveValue('one\ntwo')
  expect(asked).toEqual([])
})

const runView: ChatRunView = {
  phase: 'running',
  runID: 'run-1',
  question: 'What is the policy?',
  draft: 'The policy says',
  step: 'answering',
  tools: [],
  outcome: null,
  message: '',
  error: null,
}

const activity = (container: Element) =>
  [...container.querySelectorAll('[data-activity]')] as HTMLElement[]

it('animates a dot indicator and a caret while the answer is being written', async () => {
  const screen = await mount(<RunProgress view={runView} />)
  await expect.element(screen.getByText('Writing the answer…')).toBeVisible()
  const found = activity(screen.container)
  expect(found.map((el) => el.dataset.activity).sort()).toEqual([
    'caret',
    'dots',
  ])
  for (const el of found) {
    const moving = el.firstElementChild ?? el
    expect(getComputedStyle(moving).animationName).not.toBe('none')
  }
})

it('animates the dots before any text has arrived', async () => {
  const screen = await mount(
    <RunProgress view={{ ...runView, phase: 'starting', draft: '' }} />
  )
  expect(activity(screen.container).map((el) => el.dataset.activity)).toEqual([
    'dots',
  ])
})

it('stops animating once the run has ended', async () => {
  const screen = await mount(
    <RunProgress view={{ ...runView, phase: 'ended', outcome: 'cancelled' }} />
  )
  expect(activity(screen.container)).toHaveLength(0)
})

const hits = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Recovery runbook',
    type: 'markdown',
    projectName: 'Platform',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Incident [guide]',
    type: 'markdown',
    projectName: '',
  },
]

async function mountMentionAsk(asked: string[], found = hits) {
  const searches: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/v1/rag/document-search') {
        searches.push(url.searchParams.get('search') ?? '')
        return Promise.resolve(jsonResponse(found))
      }
      return Promise.resolve(jsonResponse(skillList))
    })
  )
  const screen = await mount(
    <AskForm
      id='q'
      pending={false}
      placeholder='Ask'
      workspaceID={workspaceID}
      onAsk={(q) => asked.push(q)}
      language='en'
      onLanguage={() => {}}
    />
  )
  return {
    screen,
    searches,
    box: screen.getByRole('textbox', { name: 'Ask a question' }),
  }
}

it('offers readable documents after @ and sends the picked one as a token', async () => {
  const asked: string[] = []
  const { screen, box, searches } = await mountMentionAsk(asked)
  await userEvent.click(box)
  await userEvent.keyboard('summarise @recov')
  await expect
    .element(screen.getByRole('button', { name: /Recovery runbook/ }))
    .toBeVisible()
  // The search follows the typing after a short pause.
  await vi.waitFor(() => expect(searches.at(-1)).toBe('recov'))

  await userEvent.keyboard('{Enter}')
  await expect.element(box).toHaveValue('summarise @Recovery runbook ')
  expect(asked).toEqual([])
  await userEvent.keyboard('please{Enter}')
  expect(asked).toEqual([
    'summarise @[Recovery runbook](doc:11111111-1111-4111-8111-111111111111) please',
  ])
})

it('picks a document with the mouse and cleans a title that would break the token', async () => {
  const asked: string[] = []
  const { screen, box } = await mountMentionAsk(asked)
  await userEvent.click(box)
  await userEvent.keyboard('@')
  await userEvent.click(
    screen.getByRole('button', { name: /Incident \[guide\]/ })
  )
  await expect.element(box).toHaveValue('@Incident guide ')
  await userEvent.keyboard('{Enter}')
  expect(asked).toEqual([
    '@[Incident guide](doc:22222222-2222-4222-8222-222222222222)',
  ])
})

it('sends plain text when the name of a mention is edited afterwards', async () => {
  const asked: string[] = []
  const { screen, box } = await mountMentionAsk(asked)
  await userEvent.click(box)
  await userEvent.keyboard('@recov')
  await userEvent.click(
    screen.getByRole('button', { name: /Recovery runbook/ })
  )
  await userEvent.keyboard('{Backspace}{Backspace}x')
  // Its name was edited, so it is text again and typing after the @ offers the list anew.
  await expect
    .element(screen.getByRole('list', { name: 'Documents' }))
    .toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect
    .element(screen.getByRole('list', { name: 'Documents' }))
    .not.toBeInTheDocument()
  await userEvent.keyboard('{Enter}')
  expect(asked).toHaveLength(1)
  expect(asked[0]).not.toContain('doc:')
})

it('does not open the picker for an email address or without a workspace', async () => {
  const asked: string[] = []
  const { screen, box } = await mountMentionAsk(asked)
  await userEvent.click(box)
  await userEvent.keyboard('write to me@example')
  expect(
    screen.getByRole('list', { name: 'Documents' }).elements()
  ).toHaveLength(0)
})

it('stops at five different documents and says so', async () => {
  const asked: string[] = []
  const many = Array.from({ length: 6 }, (_, i) => ({
    id: `${i + 1}${i + 1}${i + 1}${i + 1}${i + 1}${i + 1}${i + 1}${i + 1}-1111-4111-8111-111111111111`,
    title: `Doc ${i + 1}`,
    type: 'markdown',
    projectName: '',
  }))
  const { screen, box } = await mountMentionAsk(asked, many)
  await userEvent.click(box)
  for (let i = 0; i < 5; i++) {
    await userEvent.keyboard('@')
    await userEvent.click(
      screen.getByRole('button', { name: new RegExp(`Doc ${i + 1}$`) })
    )
  }
  await userEvent.keyboard('@')
  await expect
    .element(
      screen.getByText('You can mention up to 5 documents in one question.')
    )
    .toBeVisible()
  expect(screen.getByRole('button', { name: /Doc 6/ }).elements()).toHaveLength(
    0
  )
})
