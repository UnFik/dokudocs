import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { WorkspaceMembers } from './workspace-members'

const workspaceId = '149a8d07-8490-43ed-98fa-ebaa91b05e90'

const roster = [
  {
    userId: 'u-owner',
    email: 'olivia@example.test',
    fullName: 'Olivia',
    avatarUrl: '',
    role: 'owner',
    joinedAt: '2026-01-02T00:00:00Z',
  },
  {
    userId: 'u-ben',
    email: 'ben@example.test',
    fullName: 'Ben',
    avatarUrl: '',
    role: 'member',
    joinedAt: '2026-02-03T00:00:00Z',
  },
]

function serve(role: 'owner' | 'admin' | 'member', invites: unknown[] = []) {
  const calls: Array<{ method: string; url: string; body?: unknown }> = []
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({
      method,
      url,
      body: init?.body && JSON.parse(String(init.body)),
    })
    if (url.endsWith('/api/v1/workspaces'))
      return Promise.resolve(
        jsonResponse([
          { id: workspaceId, name: 'Acme', plan: 'Free', logoUrl: '', role },
        ])
      )
    if (url.endsWith('/members')) return Promise.resolve(jsonResponse(roster))
    if (url.endsWith('/invites') && method === 'GET')
      return Promise.resolve(jsonResponse(invites))
    if (url.endsWith('/invites') && method === 'POST')
      return Promise.resolve(
        jsonResponse(
          {
            id: 'i-new',
            email: 'new@example.test',
            role: 'member',
            expiresAt: '2026-12-01T00:00:00Z',
            lastSentAt: '2026-11-24T00:00:00Z',
          },
          201
        )
      )
    return Promise.resolve(jsonResponse({}, 204))
  })
  vi.stubGlobal('fetch', fetch)
  return calls
}

function mount() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <WorkspaceMembers />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  useAuthStore.getState().auth.setSession(testSession())
  useDokudocsStore.setState({ activeOrgId: workspaceId })
})
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
  useDokudocsStore.setState({ activeOrgId: 'org-1' })
})

it('lists members and waiting invitations for an owner, and sends an invitation', async () => {
  const calls = serve('owner', [
    {
      id: 'i-1',
      email: 'waiting@example.test',
      role: 'member',
      expiresAt: '2026-12-01T00:00:00Z',
      lastSentAt: '2026-11-24T00:00:00Z',
    },
  ])
  const screen = await mount()
  await expect.element(screen.getByText('Ben', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('waiting@example.test')).toBeVisible()

  await screen.getByRole('button', { name: 'Invite by email' }).click()
  await screen.getByLabelText('Email address').fill('new@example.test')
  await screen.getByRole('button', { name: 'Send invitation' }).click()

  await vi.waitFor(() => {
    const post = calls.find(
      (call) => call.method === 'POST' && call.url.endsWith('/invites')
    )
    expect(post?.body).toEqual({ email: 'new@example.test', role: 'member' })
  })
})

it('hides invitation controls and the waiting list from a plain member', async () => {
  const calls = serve('member')
  const screen = await mount()
  await expect.element(screen.getByText('Ben', { exact: true })).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Invite by email' }).elements()
  ).toHaveLength(0)
  expect(
    screen.getByText('Waiting for an answer', { exact: true }).elements()
  ).toHaveLength(0)
  expect(calls.some((call) => call.url.endsWith('/invites'))).toBe(false)
})

it('offers the admin role to an owner only', async () => {
  serve('admin')
  const screen = await mount()
  await screen.getByRole('button', { name: 'Invite by email' }).click()
  await screen.getByRole('combobox', { name: 'Role' }).click()
  expect(screen.getByRole('option', { name: /Admin/ }).elements()).toHaveLength(
    0
  )
})
