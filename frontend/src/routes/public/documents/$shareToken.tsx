import { createFileRoute } from '@tanstack/react-router'
import { PublicMarkdownDocument } from '@/features/docs/components/public-markdown-document'

export const Route = createFileRoute('/public/documents/$shareToken')({
  component: PublicDocumentRoute,
})

function PublicDocumentRoute() {
  const { shareToken } = Route.useParams()
  return <PublicMarkdownDocument shareToken={shareToken} />
}
