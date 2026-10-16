import { createFileRoute } from '@tanstack/react-router'
import { PlatformConversationsPage } from '@/features/platform-conversations'

export const Route = createFileRoute('/_authenticated/platform/conversations')({
  component: PlatformConversationsPage,
})
