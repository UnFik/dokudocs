import { createFileRoute } from '@tanstack/react-router'
import { requireAuth } from '@/lib/auth-guard'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'
import { SessionPending, SessionError } from '@/features/auth/session-feedback'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: requireAuth,
  pendingMs: 0,
  pendingComponent: SessionPending,
  errorComponent: SessionError,
  component: AuthenticatedLayout,
})
