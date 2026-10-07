import { useState } from 'react'
import '@/styles/index.css'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { ReplyReveal, ReviewCardHeader, SuggestionTitle } from './review-card'

describe('ReviewCardHeader', () => {
  it('shows the name above the time, beside the avatar', async () => {
    const screen = await render(
      <ReviewCardHeader
        name='Fikri Ilham Arifin'
        createdAt={new Date().toISOString()}
      />
    )
    await expect.element(screen.getByText('Fikri Ilham Arifin')).toBeVisible()
    await expect.element(screen.getByText(/Today$/)).toBeVisible()
    await expect.element(screen.getByText('FI', { exact: true })).toBeVisible()
    const name = screen.getByText('Fikri Ilham Arifin').element()
    const time = screen.getByText(/Today$/).element()
    expect(name.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      time.getBoundingClientRect().top + 1
    )
  })
})

describe('SuggestionTitle', () => {
  it.each([
    ['Add: "penambahan"', 'Add:', '“penambahan”'],
    ['Delete: "melakukan"', 'Delete:', '“melakukan”'],
  ])(
    'sets the label in bold and the quoted text in italic: %s',
    async (title, label, quoted) => {
      const screen = await render(<SuggestionTitle title={title} />)
      const strong = screen.container.querySelector('strong')!
      expect(strong.textContent).toBe(label)
      expect(screen.container.querySelector('em')!.textContent).toBe(quoted)
    }
  )

  it('handles replace with two quoted parts and the word between them', async () => {
    const screen = await render(
      <SuggestionTitle title={'Replace: "member" with "replace"'} />
    )
    const quoted = [...screen.container.querySelectorAll('em')].map(
      (e) => e.textContent
    )
    expect(quoted).toEqual(['“member”', '“replace”'])
    expect(screen.container.textContent).toBe(
      'Replace: “member” with “replace”'
    )
  })

  it('leaves a title without a label as plain text', async () => {
    const screen = await render(<SuggestionTitle title='Split paragraph' />)
    expect(screen.container.querySelector('strong')).toBeNull()
    expect(screen.container.textContent).toBe('Split paragraph')
  })
})

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <section className='group'>
      <ReplyReveal open={open} onOpen={() => setOpen(true)}>
        <textarea aria-label='Reply' />
      </ReplyReveal>
    </section>
  )
}

describe('ReplyReveal', () => {
  it('shows a Reply button first and the box only after it is pressed', async () => {
    const screen = await render(<Harness />)
    expect(screen.getByRole('textbox').elements()).toHaveLength(0)
    await screen.getByRole('button', { name: 'Reply' }).click()
    await expect.element(screen.getByRole('textbox')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Reply' }).elements()
    ).toHaveLength(0)
  })

  it('keeps the button out of sight until the card is hovered or focused', async () => {
    const screen = await render(<Harness />)
    const button = screen.getByRole('button', { name: 'Reply' })
    await expect.element(button).toHaveStyle({ opacity: '0' })
    await userEvent.hover(screen.container.querySelector('section')!)
    await expect.element(button).toHaveStyle({ opacity: '1' })
  })

  it('is there for the keyboard even while unseen', async () => {
    const screen = await render(<Harness />)
    await userEvent.tab()
    await expect
      .element(screen.getByRole('button', { name: 'Reply' }))
      .toHaveFocus()
    await expect
      .element(screen.getByRole('button', { name: 'Reply' }))
      .toHaveStyle({ opacity: '1' })
  })
})
