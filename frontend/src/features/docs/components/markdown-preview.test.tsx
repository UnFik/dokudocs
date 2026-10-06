import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { MarkdownPreview } from './markdown-preview'

describe('MarkdownPreview', () => {
  it('shows the Markdown as it will read, in a labelled pane', async () => {
    const screen = await render(<MarkdownPreview markdown={'# Title\n\nSome **bold** words'} />)
    await expect.element(screen.getByRole('complementary', { name: 'Preview' })).toBeInTheDocument()
    await expect.element(screen.getByRole('heading', { name: 'Title' })).toBeVisible()
    await expect.element(screen.getByText('bold')).toBeVisible()
  })

  it('drops scripts', async () => {
    await render(<MarkdownPreview markdown={'<img src=x onerror="document.title=1">hi'} />)
    expect(document.title).not.toBe('1')
  })
})
