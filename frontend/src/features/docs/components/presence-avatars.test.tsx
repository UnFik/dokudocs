import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
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

  it('follows another person when their avatar is pressed, and stops on a second press', async () => {
    const calls: (string | null)[] = []
    const screen = await render(
      <PresenceAvatars
        users={users}
        currentUserID='u1'
        followedID='u2'
        onFollow={(id) => calls.push(id)}
      />
    )
    await expect
      .element(screen.getByRole('button', { name: 'Stop following Bo Chen' }))
      .toHaveAttribute('aria-pressed', 'true')
    await screen.getByRole('button', { name: 'Stop following Bo Chen' }).click()
    await screen.getByRole('button', { name: 'Follow Anonymous' }).click()
    expect(calls).toEqual([null, 'u3'])
    expect(
      screen.getByRole('button', { name: /Ada Lovelace/ }).elements()
    ).toHaveLength(0)
  })

  it("shows the person's name in a popover when their avatar is hovered", async () => {
    const screen = await render(
      <PresenceAvatars users={users} currentUserID='u1' />
    )
    await userEvent.hover(screen.getByText('BC'))
    await expect.element(page.getByRole('tooltip')).toHaveTextContent('Bo Chen')
  })

  it('names the people behind the +N count when it is hovered', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      userID: `u${i}`,
      name: `User ${i}`,
    }))
    const screen = await render(
      <PresenceAvatars users={many} currentUserID='u0' />
    )
    await userEvent.hover(screen.getByText('+2'))
    await expect
      .element(page.getByRole('tooltip'))
      .toHaveTextContent('User 4, User 5')
  })
})

describe('PresenceAvatars initials', () => {
  it('centers the initials inside the circle', async () => {
    await render(
      <PresenceAvatars
        users={[{ userID: 'u2', name: 'Fikri' }]}
        currentUserID='u1'
      />
    )
    const letter = page.getByText('F').element() as HTMLElement
    const circle = letter.closest('[data-slot="avatar"]') as HTMLElement
    const l = letter.getBoundingClientRect()
    const c = circle.getBoundingClientRect()
    expect(
      Math.abs(l.left + l.width / 2 - (c.left + c.width / 2))
    ).toBeLessThanOrEqual(1)
    expect(
      Math.abs(l.top + l.height / 2 - (c.top + c.height / 2))
    ).toBeLessThanOrEqual(1)
  })
})
