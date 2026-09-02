import z from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { ProjectDetailView } from '@/features/projects/components/project-detail-view'

const projectDetailSearchSchema = z.object({
  categories: z
    .union([z.string(), z.array(z.string())])
    .transform((val) => (Array.isArray(val) ? val : val ? [val] : []))
    .optional()
    .catch([]),
  q: z.string().optional().catch(''),
  viewMode: z.enum(['grid', 'list']).optional().catch('grid'),
})

export const Route = createFileRoute('/_authenticated/projects/$projectId')({
  validateSearch: projectDetailSearchSchema,
  component: ProjectDetailView,
})
