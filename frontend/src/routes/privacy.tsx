import { createFileRoute } from '@tanstack/react-router'
import { LegalPage } from '@/features/legal'

export const Route = createFileRoute('/privacy')({
  component: () => <LegalPage kind='privacy' />,
  head: () => ({
    meta: [{ title: 'Privacy policy | DokuDocs' }],
    links: [{ rel: 'canonical', href: 'https://unfik.my.id/privacy' }],
  }),
})
