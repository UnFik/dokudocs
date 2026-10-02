import { createFileRoute } from '@tanstack/react-router'
import { RAGChatPage } from '@/features/rag'

export const Route = createFileRoute('/_authenticated/assistant/')({
  component: RAGChatPage,
})
