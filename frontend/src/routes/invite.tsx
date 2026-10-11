import { createFileRoute, redirect } from '@tanstack/react-router'
import { restoreSession } from '@/lib/auth-guard'
import { SessionPending, SessionError } from '@/features/auth/session-feedback'
import { InvitePage } from '@/features/invites/invite-page'
import { takeInviteFromAddress } from '@/features/invites/pending-invite'

export const Route = createFileRoute('/invite')({
  beforeLoad: async ({ preload }) => {
    if (preload) return
    takeInviteFromAddress()
    // Signed in already: the app accepts the waiting invitation on arrival.
    if (await restoreSession())
      throw redirect({ to: '/dashboard', replace: true })
  },
  preload: false,
  pendingMs: 0,
  pendingComponent: SessionPending,
  errorComponent: SessionError,
  component: InvitePage,
})
