import { createFileRoute } from '@tanstack/react-router'
import { ProjectDetailView } from '@/features/projects/components/project-detail-view'

export const Route = createFileRoute('/_authenticated/projects/$projectId')({
  component: ProjectDetailView,
})
