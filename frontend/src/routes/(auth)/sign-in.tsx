import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { requireGuest } from '@/lib/auth-guard'
import { SessionPending, SessionError } from '@/features/auth/session-feedback'
import { SignIn } from '@/features/auth/sign-in'

const searchSchema = z.object({
  redirect: z.string().optional(),
})

export const Route = createFileRoute('/(auth)/sign-in')({
  beforeLoad: requireGuest,
  pendingMs: 0,
  pendingComponent: SessionPending,
  errorComponent: SessionError,
  component: SignIn,
  validateSearch: searchSchema,
})
