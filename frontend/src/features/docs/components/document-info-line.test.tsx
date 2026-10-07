import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { DocumentInfoLine } from './document-info-line'

const now = new Date('2026-10-06T12:00:00Z')

describe('DocumentInfoLine', () => {
  it('says who updated the document and how long ago', async () => {
    const screen = await render(
      <DocumentInfoLine
        updatedAt='2026-10-06T11:55:00Z'
        updatedBy='Rina'
        author='Dewi'
        isDraft={false}
        tasks={{ done: 0, total: 0 }}
        now={now}
      />
    )
    await expect
      .element(screen.getByText('Updated by Rina 5 minutes ago'))
      .toBeInTheDocument()
  })

  it('falls back to the author when nobody has edited yet', async () => {
    const screen = await render(
      <DocumentInfoLine
        updatedAt='2026-10-06T09:00:00Z'
        updatedBy={null}
        author='Dewi'
        isDraft={false}
        tasks={{ done: 0, total: 0 }}
        now={now}
      />
    )
    await expect
      .element(screen.getByText('Created by Dewi about 3 hours ago'))
      .toBeInTheDocument()
  })

  it('shows Draft and the task count only when they apply', async () => {
    const screen = await render(
      <DocumentInfoLine
        updatedAt='2026-10-06T11:59:30Z'
        updatedBy='Rina'
        author='Dewi'
        isDraft
        tasks={{ done: 2, total: 5 }}
        now={now}
      />
    )
    await expect.element(screen.getByText('Draft')).toBeInTheDocument()
    await expect
      .element(screen.getByText('2 of 5 tasks done'))
      .toBeInTheDocument()
  })

  it('opens the comments panel from the Comment action beside the update time', async () => {
    let clicks = 0
    const screen = await render(
      <DocumentInfoLine
        updatedAt='2026-10-06T11:55:00Z'
        updatedBy='Rina'
        author='Dewi'
        isDraft={false}
        tasks={{ done: 0, total: 0 }}
        now={now}
        onToggleComments={() => clicks++}
        commentsOpen={false}
      />
    )
    await screen.getByRole('button', { name: 'Comment' }).click()
    expect(clicks).toBe(1)
  })
})
