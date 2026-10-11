import { createFileRoute } from '@tanstack/react-router'
import { AIAccessPage } from '@/features/ai-access'

export const Route = createFileRoute('/_authenticated/settings/ai')({
  component: AIAccessPage,
})
