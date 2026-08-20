import { createFileRoute } from '@tanstack/react-router'
import { DocEditorPage } from '@/features/docs'

export const Route = createFileRoute('/docs/$docId')({
  component: DocEditorPage,
})
