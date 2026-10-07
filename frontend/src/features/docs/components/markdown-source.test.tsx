import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { MarkdownSource } from './markdown-source'

describe('MarkdownSource', () => {
  it('shows the Markdown text exactly as it is, in a labelled read-only pane', async () => {
    const markdown = ':::tip\nRemember **this**\n:::\n\n- a\n- b'
    const screen = await render(<MarkdownSource markdown={markdown} />)
    const pane = screen.getByRole('complementary', { name: 'Markdown source' })
    await expect.element(pane).toBeInTheDocument()
    await expect.element(pane.getByText(':::tip')).toBeVisible()
    expect((pane.element() as HTMLElement).textContent).toBe(markdown)
    expect(pane.getByRole('textbox').elements()).toHaveLength(0)
  })

  it('does not run markup in the text', async () => {
    await render(
      <MarkdownSource markdown={'<img src=x onerror="document.title=1">'} />
    )
    expect(document.title).not.toBe('1')
    expect(document.querySelector('aside img')).toBeNull()
  })
})
