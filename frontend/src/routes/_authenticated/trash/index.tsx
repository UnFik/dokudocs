import { createFileRoute } from '@tanstack/react-router'
import { TrashPage } from '@/features/trash'

export const Route = createFileRoute('/_authenticated/trash/')({
  component: TrashPage,
})
