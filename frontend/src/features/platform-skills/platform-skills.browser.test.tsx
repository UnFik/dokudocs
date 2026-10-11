import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import { PlatformSkillsPage } from '.'

const key = (url: string, init: RequestInit = {}) =>
  `${init.method ?? 'GET'} ${new URL(url).pathname}`
const skill = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  name: 'write-adr',
  description: 'Draft an ADR',
  instructions: 'Write one paragraph.',
  updatedAt: '2026-10-11T10:00:00Z',
}

function mount() {
  useAuthStore.getState().auth.setSession(testSession())
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <PlatformSkillsPage />
    </QueryClientProvider>
  )
}
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

it('creates a skill, then edits and deletes it', async () => {
  let skills: (typeof skill)[] = []
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const route = key(url, init)
    if (route === 'GET /api/v1/skills')
      return Promise.resolve(jsonResponse({ skills }))
    if (route === 'POST /api/v1/platform/skills') {
      skills = [{ ...skill, ...JSON.parse(String(init?.body)) }]
      return Promise.resolve(jsonResponse(skills[0], 201))
    }
    if (route === `PUT /api/v1/platform/skills/${skill.id}`) {
      skills = [{ ...skills[0]!, ...JSON.parse(String(init?.body)) }]
      return Promise.resolve(jsonResponse(skills[0]))
    }
    if (route === `DELETE /api/v1/platform/skills/${skill.id}`) {
      skills = []
      return Promise.resolve(new Response(null, { status: 204 }))
    }
    return Promise.resolve(jsonResponse({}, 404))
  })
  vi.stubGlobal('fetch', fetch)
  const screen = await mount()
  await expect.element(screen.getByText('No skills yet.')).toBeVisible()
  await userEvent.fill(screen.getByLabelText('Name'), 'write-adr')
  await userEvent.fill(screen.getByLabelText('Description'), 'Draft an ADR')
  await userEvent.fill(
    screen.getByLabelText('Instructions'),
    'Write one paragraph.'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Add skill' }))
  await expect.element(screen.getByText('/write-adr')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Edit write-adr' }))
  await userEvent.fill(
    screen.getByLabelText('Instructions'),
    'Write two paragraphs.'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Save skill' }))
  const [, putInit] = fetch.mock.calls.find(
    ([url, i]) => key(url, i) === `PUT /api/v1/platform/skills/${skill.id}`
  )!
  expect(JSON.parse(String(putInit?.body))).toMatchObject({
    instructions: 'Write two paragraphs.',
  })
  await userEvent.click(
    screen.getByRole('button', { name: 'Delete write-adr' })
  )
  await userEvent.click(screen.getByRole('button', { name: 'Delete skill' }))
  await expect.element(screen.getByText('No skills yet.')).toBeVisible()
})

it('shows why a skill was refused', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) =>
      Promise.resolve(
        key(url, init) === 'POST /api/v1/platform/skills'
          ? jsonResponse({ title: 'only a superadmin can do this' }, 403)
          : jsonResponse({ skills: [] })
      )
    )
  )
  const screen = await mount()
  await userEvent.fill(screen.getByLabelText('Name'), 'x')
  await userEvent.fill(screen.getByLabelText('Instructions'), 'y')
  await userEvent.click(screen.getByRole('button', { name: 'Add skill' }))
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('only a superadmin can do this')
})
