import { createFileRoute } from '@tanstack/react-router'
import { PlatformAiPage } from '@/features/platform-ai'

export const Route = createFileRoute('/_authenticated/platform/ai')({
  component: PlatformAiPage,
})
