import { createFileRoute } from '@tanstack/react-router'
import { PlatformMCPPage } from '@/features/platform-mcp'

export const Route = createFileRoute('/_authenticated/platform/mcp')({
  component: PlatformMCPPage,
})
