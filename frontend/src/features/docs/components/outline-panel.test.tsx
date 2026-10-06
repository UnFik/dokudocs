import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { OutlinePanel } from './outline-panel'

const items = [
  { nodeID: 'a', level: 1, text: 'Intro' },
  { nodeID: 'b', level: 2, text: 'Part one' },
]

describe('OutlinePanel', () => {
  it('lists the headings under a Contents label and marks the active one', async () => {
    const screen = await render(
      <OutlinePanel items={items} activeID='b' onSelect={() => {}} />
    )
    await expect
      .element(screen.getByRole('navigation', { name: 'Contents' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: 'Part one' }))
      .toHaveAttribute('aria-current', 'location')
    await expect
      .element(screen.getByRole('link', { name: 'Intro' }))
      .not.toHaveAttribute('aria-current')
  })

  it('goes to a heading when its entry is clicked', async () => {
    const onSelect = vi.fn()
    const screen = await render(
      <OutlinePanel items={items} activeID={null} onSelect={onSelect} />
    )
    await screen.getByRole('link', { name: 'Intro' }).click()
    expect(onSelect).toHaveBeenCalledWith('a')
  })

  it('says so when there are no headings', async () => {
    const screen = await render(
      <OutlinePanel items={[]} activeID={null} onSelect={() => {}} />
    )
    await expect
      .element(screen.getByText('Headings you add will show up here.'))
      .toBeInTheDocument()
  })
})
