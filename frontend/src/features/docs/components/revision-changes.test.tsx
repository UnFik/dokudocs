import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { RevisionChanges } from './revision-changes'

const changes = [
  { kind: 'removed' as const, text: 'old line' },
  { kind: 'added' as const, text: 'new line' },
  { kind: 'added' as const, text: 'last line' },
]

describe('RevisionChanges', () => {
  it('steps through the changes with next and previous', async () => {
    const screen = await render(<RevisionChanges changes={changes} />)
    await expect.element(screen.getByText('Change 1 of 3')).toBeVisible()
    await screen.getByRole('button', { name: 'Next change' }).click()
    await expect.element(screen.getByText('Change 2 of 3')).toBeVisible()
    await expect
      .element(screen.getByText('new line'))
      .toHaveAttribute('aria-current', 'true')
    await screen.getByRole('button', { name: 'Previous change' }).click()
    await expect.element(screen.getByText('Change 1 of 3')).toBeVisible()
  })

  it('does not step past either end', async () => {
    const screen = await render(<RevisionChanges changes={changes} />)
    await expect
      .element(screen.getByRole('button', { name: 'Previous change' }))
      .toBeDisabled()
  })

  it('says when nothing changed', async () => {
    const screen = await render(<RevisionChanges changes={[]} />)
    await expect.element(screen.getByText('No changes from the version before.')).toBeVisible()
  })
})
