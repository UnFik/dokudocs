import { createFileRoute } from '@tanstack/react-router'
import { requireGuest } from '@/lib/auth-guard'
import { SessionPending, SessionError } from '@/features/auth/session-feedback'
import { SignUp } from '@/features/auth/sign-up'

export const Route = createFileRoute('/(auth)/sign-up')({
  beforeLoad: requireGuest,
  pendingMs: 0,
  pendingComponent: SessionPending,
  errorComponent: SessionError,
  component: SignUp,
})
