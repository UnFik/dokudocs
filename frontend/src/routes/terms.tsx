import { createFileRoute } from '@tanstack/react-router'
import { LegalPage } from '@/features/legal'

export const Route = createFileRoute('/terms')({
  component: () => <LegalPage kind='terms' />,
  head: () => ({ meta: [{ title: 'Terms of use | DokuDocs' }] }),
})
