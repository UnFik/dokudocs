import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { MarkdownSource } from './markdown-source'

const { success, error } = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success, error } }))

describe('MarkdownSource', () => {
  let writeText: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    success.mockClear()
    error.mockClear()
  })

  it('copies the whole Markdown and says so when the copy button is used', async () => {
    const markdown = '# Title\n\n' + 'line\n'.repeat(200)
    const screen = await render(<MarkdownSource markdown={markdown} />)

    await userEvent.click(screen.getByRole('button', { name: 'Copy Markdown' }))

    expect(writeText).toHaveBeenCalledWith(markdown)
    expect(success).toHaveBeenCalledWith('Document Markdown copied')
    expect(error).not.toHaveBeenCalled()
  })

  it('says the copy failed, and not that it worked, when the browser refuses the clipboard', async () => {
    writeText.mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
    const screen = await render(<MarkdownSource markdown='# Title' />)

    await userEvent.click(screen.getByRole('button', { name: 'Copy Markdown' }))

    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith('Could not copy the Markdown')
    )
    expect(success).not.toHaveBeenCalled()
    await expect
      .element(screen.getByRole('button', { name: 'Copy Markdown' }))
      .toBeInTheDocument()
  })

  it('confirms on the button for a moment after a successful copy', async () => {
    const screen = await render(<MarkdownSource markdown='# Title' />)

    await userEvent.click(screen.getByRole('button', { name: 'Copy Markdown' }))

    await expect
      .element(screen.getByRole('button', { name: 'Copied' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: 'Copy Markdown' }))
      .toBeInTheDocument()
  })

  it('copies from the keyboard with Enter and with Space', async () => {
    const screen = await render(<MarkdownSource markdown='# Title' />)
    const button = screen.getByRole('button', { name: 'Copy Markdown' })

    ;(button.element() as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))

    await expect
      .element(screen.getByRole('button', { name: 'Copy Markdown' }))
      .toBeInTheDocument()
    ;(
      screen
        .getByRole('button', { name: 'Copy Markdown' })
        .element() as HTMLElement
    ).focus()
    await userEvent.keyboard(' ')
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
  })

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
