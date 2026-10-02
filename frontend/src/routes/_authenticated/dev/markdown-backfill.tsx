import { lazy } from 'react'
import { createFileRoute, notFound } from '@tanstack/react-router'

const MarkdownBackfillPage = import.meta.env.DEV
  ? lazy(() => import('@/features/docs/components/markdown-backfill-dev-page'))
  : () => null

export const Route = createFileRoute('/_authenticated/dev/markdown-backfill')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  component: MarkdownBackfillPage,
})
