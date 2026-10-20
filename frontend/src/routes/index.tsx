import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { WelcomePage } from '@/features/welcome'

export const Route = createFileRoute('/')({
  component: WelcomePage,
  validateSearch: z.object({ redirect: z.string().optional() }),
  head: () => ({
    meta: [
      { title: 'Dokudocs | Docs, schemas and diagrams in one workspace' },
      {
        name: 'description',
        content:
          'Write Markdown with your team in real time. Keep DBML schemas, Mermaid flows and architecture drawings beside it, with an AI that proposes edits you approve.',
      },
    ],
    links: [{ rel: 'canonical', href: 'https://unfik.my.id/' }],
  }),
})
