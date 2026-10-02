import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { PresenceAvatars } from './presence-avatars'

const users = [
  { userID: 'u1', name: 'Ada Lovelace' },
  { userID: 'u2', name: 'Bo Chen' },
  { userID: 'u3' },
]

describe('PresenceAvatars', () => {
  it('shows one labelled avatar per connected user and marks the current user', async () => {
    await render(<PresenceAvatars users={users} currentUserID='u1' />)

    const list = page.getByRole('list', { name: 'People in this document' })
    await expect.element(list).toBeVisible()
    await expect
      .element(page.getByRole('listitem', { name: 'Ada Lovelace (you)' }))
      .toBeVisible()
    await expect
      .element(page.getByRole('listitem', { name: 'Bo Chen' }))
      .toBeVisible()
    await expect
      .element(page.getByRole('listitem', { name: 'Anonymous' }))
      .toBeVisible()
    await expect.element(page.getByText('AL')).toBeVisible()
    await expect.element(page.getByText('BC')).toBeVisible()
  })

  it('collapses extra users into a count', async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      userID: `u${i}`,
      name: `User ${i}`,
    }))
    await render(<PresenceAvatars users={many} currentUserID='u0' />)

    await expect
      .element(page.getByRole('listitem', { name: '3 more people' }))
      .toHaveTextContent('+3')
    expect(page.getByRole('listitem').elements()).toHaveLength(5)
  })

  it('renders nothing when nobody is connected', async () => {
    await render(<PresenceAvatars users={[]} currentUserID='u1' />)
    expect(page.getByRole('list').elements()).toHaveLength(0)
  })
})
