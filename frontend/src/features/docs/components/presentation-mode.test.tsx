import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { PresentationMode } from './presentation-mode'

describe('PresentationMode', () => {
  it('shows one slide at a time and moves with the arrow keys', async () => {
    const screen = await render(
      <PresentationMode
        slides={['# First slide', '# Second slide']}
        onClose={() => {}}
      />
    )
    await expect.element(screen.getByText('First slide')).toBeVisible()
    await expect.element(screen.getByText('1 / 2')).toBeVisible()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await expect.element(screen.getByText('Second slide')).toBeVisible()
    await expect.element(screen.getByText('2 / 2')).toBeVisible()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await expect.element(screen.getByText('2 / 2')).toBeVisible()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    await expect.element(screen.getByText('First slide')).toBeVisible()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    await render(<PresentationMode slides={['x']} onClose={onClose} />)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('strips scripts from a slide', async () => {
    const screen = await render(
      <PresentationMode
        slides={['hello <img src=x onerror="document.title=1">']}
        onClose={() => {}}
      />
    )
    await expect.element(screen.getByText('hello')).toBeVisible()
    expect(document.title).not.toBe('1')
  })
})
