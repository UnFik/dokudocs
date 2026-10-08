import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { DocumentStatsDialog } from './document-stats-dialog'

const stats = {
  words: 1200,
  characters: 7000,
  readingMinutes: 6,
  headings: 4,
  tasks: { done: 2, total: 5 },
}

describe('DocumentStatsDialog', () => {
  it('lists what the page holds', async () => {
    const screen = await render(
      <DocumentStatsDialog open stats={stats} limit={1_000_000} onOpenChange={() => {}} />
    )
    await expect.element(screen.getByRole('dialog', { name: 'Page statistics' })).toBeInTheDocument()
    await expect.element(screen.getByText('1,200')).toBeInTheDocument()
    await expect.element(screen.getByText('6 min')).toBeInTheDocument()
    await expect.element(screen.getByText('2 of 5 done')).toBeInTheDocument()
    await expect.element(screen.getByText('7,000 of 1,000,000')).toBeInTheDocument()
  })

  it('renders nothing while closed', async () => {
    const screen = await render(
      <DocumentStatsDialog open={false} stats={stats} limit={1000} onOpenChange={() => {}} />
    )
    expect(screen.getByRole('dialog').elements()).toHaveLength(0)
  })
})
