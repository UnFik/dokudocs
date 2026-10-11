import { createFileRoute } from '@tanstack/react-router'
import { PlatformSkillsPage } from '@/features/platform-skills'

export const Route = createFileRoute('/_authenticated/platform/skills')({
  component: PlatformSkillsPage,
})
