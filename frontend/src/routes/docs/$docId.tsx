import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { requireDocumentAuth } from '@/lib/auth-guard'
import { SessionBoundary } from '@/features/auth/session-boundary'
import { SessionPending, SessionError } from '@/features/auth/session-feedback'
import { DocEditorPage } from '@/features/docs'

export const Route = createFileRoute('/docs/$docId')({
  validateSearch: z.object({
    workspaceId: z.string().uuid().optional(),
    nodeId: z.string().uuid().optional(),
    // A comment thread to open, from a notification.
    thread: z.string().uuid().optional(),
  }),
  beforeLoad: requireDocumentAuth,
  pendingMs: 0,
  pendingComponent: SessionPending,
  errorComponent: SessionError,
  component: () => (
    <SessionBoundary allowOffline>
      <DocEditorPage />
    </SessionBoundary>
  ),
})
