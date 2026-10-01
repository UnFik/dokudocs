import { createFileRoute, redirect } from '@tanstack/react-router'
import {
  consumeGoogleCallback,
  GoogleCallbackError,
} from '@/features/auth/google-callback'
import { SessionPending } from '@/features/auth/session-feedback'

export const Route = createFileRoute('/auth/callback')({
  beforeLoad: async ({ preload }) => {
    if (preload) return
    const to = await consumeGoogleCallback()
    throw redirect({ to, replace: true })
  },
  preload: false,
  pendingMs: 0,
  pendingComponent: SessionPending,
  errorComponent: GoogleCallbackError,
  component: GoogleCallbackError,
})
