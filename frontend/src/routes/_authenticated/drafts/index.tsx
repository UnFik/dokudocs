import { createFileRoute } from '@tanstack/react-router'
import { DraftsPage } from '@/features/drafts'

export const Route = createFileRoute('/_authenticated/drafts/')({
  component: DraftsPage,
})
