import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { forgetInvite, recallInvite, rememberInvite } from './pending-invite'
import { PendingInviteAcceptor } from './pending-invite-acceptor'

const workspaceId = '149a8d07-8490-43ed-98fa-ebaa91b05e90'

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <PendingInviteAcceptor />
    </QueryClientProvider>
  )
}

beforeEach(() => useAuthStore.getState().auth.setSession(testSession()))
afterEach(() => {
  vi.unstubAllGlobals()
  forgetInvite()
  useAuthStore.getState().auth.reset()
  useDokudocsStore.setState({ activeOrgId: 'org-1' })
})

it('does nothing when no invitation is waiting', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  await mount()
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(fetch).not.toHaveBeenCalled()
})

it('accepts the waiting invitation once, forgets it and opens the workspace', async () => {
  rememberInvite('waiting-token')
  const fetch = vi.fn((url: string, _init?: RequestInit) =>
    Promise.resolve(
      url.includes('/api/v1/invites/accept')
        ? jsonResponse({ workspaceId })
        : jsonResponse([])
    )
  )
  vi.stubGlobal('fetch', fetch)
  await mount()
  await vi.waitFor(() =>
    expect(useDokudocsStore.getState().activeOrgId).toBe(workspaceId)
  )
  const accepts = fetch.mock.calls.filter(([url]) =>
    String(url).includes('/api/v1/invites/accept')
  )
  expect(accepts).toHaveLength(1)
  expect(JSON.parse(String(accepts[0][1]?.body))).toEqual({
    token: 'waiting-token',
  })
  expect(recallInvite()).toBeNull()
})

it('drops an invitation the server no longer knows', async () => {
  rememberInvite('old-token')
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ title: 'invitation is invalid or has expired' }, 404)
      )
  )
  await mount()
  await vi.waitFor(() => expect(recallInvite()).toBeNull())
})

it('keeps the invitation while the email still has to be verified', async () => {
  rememberInvite('wait-for-verify')
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { title: 'verify your email', code: 'email_not_verified' },
          403
        )
      )
  )
  await mount()
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(recallInvite()).toBe('wait-for-verify')
})

it('explains a wrong account and keeps the invitation until it is dropped', async () => {
  rememberInvite('someone-elses')
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { title: 'different email', code: 'invite_email_mismatch' },
          403
        )
      )
  )
  const screen = await mount()
  await expect
    .element(screen.getByText('This invitation is for another email'))
    .toBeVisible()
  expect(recallInvite()).toBe('someone-elses')
  await screen.getByRole('button', { name: 'Drop the invitation' }).click()
  expect(recallInvite()).toBeNull()
})
