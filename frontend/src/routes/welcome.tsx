import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { requireGuest } from '@/lib/auth-guard'
import { WelcomePage } from '@/features/welcome'

export const Route = createFileRoute('/welcome')({
  beforeLoad: requireGuest,
  component: WelcomePage,
  validateSearch: z.object({ redirect: z.string().optional() }),
  head: () => ({
    meta: [
      { title: 'Dokudocs — Dokumen teknis untuk tim' },
      {
        name: 'description',
        content:
          'Tulis catatan Markdown, skema DBML, dan diagram Mermaid bersama dalam satu workspace.',
      },
    ],
  }),
})
