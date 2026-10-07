import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { ReviewCardHeader, SuggestionTitle } from './review-card'

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
