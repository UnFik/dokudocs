import '@/styles/index.css'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { RepositoryJump } from './repository-jump'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('jumping to a System repository', () => {
  it('asks first, showing the full address, and opens nothing until confirmed', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await render(
      <RepositoryJump url='https://github.com/acme/billing' name='Billing' />
    )

    await page.getByRole('button', { name: /repository/i }).click()

    const dialog = page.getByRole('alertdialog')
    await expect.element(dialog).toBeVisible()
    await expect
      .element(dialog.getByText('https://github.com/acme/billing'))
      .toBeVisible()
    expect(open).not.toHaveBeenCalled()
  })

  it('opens the address in a new tab, cut off from this one, on confirm', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await render(
      <RepositoryJump url='https://github.com/acme/billing' name='Billing' />
    )

    await page.getByRole('button', { name: /repository/i }).click()
    await page.getByRole('button', { name: 'Open repository' }).click()

    expect(open).toHaveBeenCalledExactlyOnceWith(
      'https://github.com/acme/billing',
      '_blank',
      'noopener,noreferrer'
    )
  })

  it('closes on Cancel and on Escape without opening anything', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await render(
      <RepositoryJump url='https://github.com/acme/billing' name='Billing' />
    )

    await page.getByRole('button', { name: /repository/i }).click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()

    await page.getByRole('button', { name: /repository/i }).click()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()

    expect(open).not.toHaveBeenCalled()
  })

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,<p>x</p>'],
    ['not a url'],
    [''],
    ['ftp://example.com/repo'],
  ])('shows no button for %j', async (url) => {
    await render(<RepositoryJump url={url} name='Billing' />)

    await expect
      .element(page.getByRole('button', { name: /repository/i }))
      .not.toBeInTheDocument()
  })
})
