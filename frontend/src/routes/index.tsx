import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { WelcomePage } from '@/features/welcome'

export const Route = createFileRoute('/')({
  component: WelcomePage,
  validateSearch: z.object({ redirect: z.string().optional() }),
  head: () => ({
    meta: [
      { title: 'Dokudocs | A workspace for notes and diagrams' },
      {
        name: 'description',
        content:
          'Write Markdown notes, DBML schemas, and Mermaid diagrams together in one workspace.',
      },
    ],
    links: [{ rel: 'canonical', href: 'https://unfik.my.id/' }],
  }),
})
