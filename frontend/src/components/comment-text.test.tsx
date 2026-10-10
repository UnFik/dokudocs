import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { CommentText } from './comment-text'

const ANA = '11111111-1111-4111-8111-111111111111'

describe('CommentText', () => {
  it('shows a mention as a chip with the name and keeps the line breaks', async () => {
    const screen = await render(
      <CommentText content={`hi @[Ana Bo](user:${ANA}),\nare you free?`} />
    )
    const chip = screen.container.querySelector('[data-mention]')
    expect(chip?.textContent).toBe('@Ana Bo')
    expect(chip?.getAttribute('data-mention')).toBe(ANA)
    expect(screen.container.textContent).toBe('hi @Ana Bo,\nare you free?')
    expect(screen.container.textContent).not.toContain('user:')
  })

  it('shows text with no token as it is, @ signs and brackets included', async () => {
    const screen = await render(
      <CommentText content='mail a@b.id, see [x](y) and @ home' />
    )
    expect(screen.container.querySelector('[data-mention]')).toBeNull()
    expect(screen.container.textContent).toBe(
      'mail a@b.id, see [x](y) and @ home'
    )
  })

  it('names the person to a screen reader and not the id', async () => {
    const screen = await render(
      <CommentText content={`@[Ana Bo](user:${ANA})`} />
    )
    await expect.element(screen.getByText('@Ana Bo')).toBeVisible()
  })
})
