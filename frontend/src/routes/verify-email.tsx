import { createFileRoute, redirect } from '@tanstack/react-router'
import { restoreSession } from '@/lib/auth-guard'
import { SessionPending } from '@/features/auth/session-feedback'
import { VerifyEmailPage } from '@/features/auth/verify-email'
import { consumeVerificationLink } from '@/features/auth/verify-email/verification-link'

export const Route = createFileRoute('/verify-email')({
  beforeLoad: async ({ preload }) => {
    if (preload) return
    if (await consumeVerificationLink())
      throw redirect({ to: '/dashboard', replace: true })
    if (!(await restoreSession()))
      throw redirect({
        to: '/sign-in',
        search: { redirect: '/dashboard' },
        replace: true,
      })
  },
  preload: false,
  pendingMs: 0,
  pendingComponent: SessionPending,
  errorComponent: VerifyEmailPage,
  component: VerifyEmailPage,
})
