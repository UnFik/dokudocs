import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { DocumentInsightsDialog } from './document-insights-dialog'

describe('DocumentInsightsDialog', () => {
  it('shows views, versions and who has worked on the page', async () => {
    const screen = await render(
      <DocumentInsightsDialog
        open
        onOpenChange={() => {}}
        insights={{
          views: 42,
          versions: 7,
          contributors: 3,
          createdBy: 'Rina',
          createdAt: '2026-01-02T03:04:05Z',
        }}
      />
    )
    await expect.element(screen.getByRole('dialog', { name: 'Insights' })).toBeInTheDocument()
    await expect.element(screen.getByText('42')).toBeInTheDocument()
    await expect.element(screen.getByText('7')).toBeInTheDocument()
    await expect.element(screen.getByText('Rina')).toBeInTheDocument()
  })

  it('says versions are loading until they are known', async () => {
    const screen = await render(
      <DocumentInsightsDialog
        open
        onOpenChange={() => {}}
        insights={{ views: 1, versions: null, contributors: null, createdBy: 'Rina', createdAt: '2026-01-02T03:04:05Z' }}
      />
    )
    await expect.element(screen.getByText('Loading…').first()).toBeInTheDocument()
  })
})
