import { createFileRoute } from '@tanstack/react-router'
import { PlatformUsagePage } from '@/features/platform-usage'

export const Route = createFileRoute('/_authenticated/platform/usage')({
  component: PlatformUsagePage,
})
