import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { SignOutDialog } from './sign-out-dialog'

const navigate = vi.fn()
const reset = vi.fn()
const flushLocalEditsForLogout = vi.fn()
const discardLocalEdits = vi.fn()
const exportUnsyncedDocuments = vi.fn()

vi.mock('@/features/docs/lib/collaboration-logout', () => ({
  flushLocalEditsForLogout: (...args: unknown[]) =>
    flushLocalEditsForLogout(...args),
  discardLocalEdits: (...args: unknown[]) => discardLocalEdits(...args),
  exportUnsyncedDocuments: (...args: unknown[]) =>
    exportUnsyncedDocuments(...args),
}))

vi.mock('@/stores/dokudocs-store', () => ({
  useDokudocsStore: { getState: () => ({ documents: [] }) },
}))

vi.mock('@/lib/local-user-data', () => ({
  getLocalUserScope: () => ({ userId: 'user-1' }),
}))

const MOCK_HREF = 'https://app.test/dashboard?tab=1'

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({
    auth: { reset, accessToken: 'jwt' },
  }),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => navigate,
    useLocation: () => ({ href: MOCK_HREF }),
  }
})

describe('SignOutDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    flushLocalEditsForLogout.mockResolvedValue({ unsynced: [] })
    discardLocalEdits.mockResolvedValue(undefined)
  })

  it('calls auth.reset and navigates to sign-in with current location as redirect', async () => {
    const { getByRole } = await render(
      <SignOutDialog open onOpenChange={vi.fn()} />
    )

    await userEvent.click(getByRole('button', { name: /^Sign out$/i }))

    await vi.waitFor(() => expect(reset).toHaveBeenCalledOnce())
    expect(flushLocalEditsForLogout).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith({
      to: '/sign-in',
      search: { redirect: MOCK_HREF },
      replace: true,
    })
  })

  it('does not call reset or navigate when Cancel is clicked', async () => {
    const { getByRole } = await render(
      <SignOutDialog open onOpenChange={vi.fn()} />
    )

    await userEvent.click(getByRole('button', { name: /^Cancel$/i }))

    expect(reset).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  describe('with edits that could not be synced', () => {
    const unsynced = [{ documentID: 'doc-1', count: 2, workspaceID: undefined }]

    it('asks before discarding and does not sign out on Cancel', async () => {
      flushLocalEditsForLogout.mockResolvedValue({ unsynced })
      const { getByRole } = await render(
        <SignOutDialog open onOpenChange={vi.fn()} />
      )

      await userEvent.click(getByRole('button', { name: /^Sign out$/i }))

      await expect
        .element(getByRole('alertdialog'))
        .toHaveTextContent(/not synced/i)
      await userEvent.click(getByRole('button', { name: /^Cancel$/i }))

      expect(discardLocalEdits).not.toHaveBeenCalled()
      expect(reset).not.toHaveBeenCalled()
      expect(navigate).not.toHaveBeenCalled()
    })

    it('discards the local edits and signs out once the user confirms', async () => {
      flushLocalEditsForLogout.mockResolvedValue({ unsynced })
      const { getByRole } = await render(
        <SignOutDialog open onOpenChange={vi.fn()} />
      )

      await userEvent.click(getByRole('button', { name: /^Sign out$/i }))
      await userEvent.click(
        getByRole('button', { name: /discard and sign out/i })
      )

      await vi.waitFor(() => expect(reset).toHaveBeenCalledOnce())
      expect(discardLocalEdits).toHaveBeenCalledWith('user-1')
    })

    it('does not sign out silently when the check itself fails', async () => {
      flushLocalEditsForLogout.mockRejectedValue(new Error('storage down'))
      const { getByRole } = await render(
        <SignOutDialog open onOpenChange={vi.fn()} />
      )

      await userEvent.click(getByRole('button', { name: /^Sign out$/i }))

      await expect
        .element(getByRole('alertdialog'))
        .toHaveTextContent(/not synced|could not check/i)
      expect(reset).not.toHaveBeenCalled()
    })
  })
})
