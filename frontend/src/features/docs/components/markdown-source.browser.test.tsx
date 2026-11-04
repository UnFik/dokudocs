import '@/styles/index.css'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { MarkdownSource } from './markdown-source'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const panel = (markdown: string) => (
  <div className='flex h-64 w-96 flex-col'>
    <MarkdownSource markdown={markdown} />
  </div>
)

const rect = (element: Element) => element.getBoundingClientRect()

function overlaps(a: DOMRect, b: DOMRect) {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  )
}

afterEach(async () => {
  await page.viewport(1280, 800)
})

describe('MarkdownSource copy button layout', () => {
  it('stays in the top corner of the panel while the source scrolls', async () => {
    const screen = await render(panel('line\n'.repeat(400)))
    const pane = screen
      .getByRole('complementary', { name: 'Markdown source' })
      .element() as HTMLElement
    const button = screen
      .getByRole('button', { name: 'Copy Markdown' })
      .element() as HTMLElement
    const before = rect(button)

    pane.scrollTop = pane.scrollHeight
    await vi.waitFor(() => expect(pane.scrollTop).toBeGreaterThan(1000))

    const after = rect(button)
    expect(after.top).toBeCloseTo(before.top, 0)
    expect(after.right).toBeCloseTo(before.right, 0)
    expect(after.top - rect(pane).top).toBeLessThan(24)
    expect(rect(pane).right - after.right).toBeLessThan(24)
  })

  it('wraps a long first line before the button, never under it', async () => {
    const screen = await render(panel('x'.repeat(3000)))
    const pre = screen
      .getByRole('complementary', { name: 'Markdown source' })
      .element()
      .querySelector('pre') as HTMLElement
    const button = screen
      .getByRole('button', { name: 'Copy Markdown' })
      .element() as HTMLElement

    const range = document.createRange()
    range.selectNodeContents(pre)
    const lines = Array.from(range.getClientRects())

    expect(lines.length).toBeGreaterThan(1)
    expect(lines.some((line) => overlaps(line, rect(button)))).toBe(false)
  })

  it('is at least 44 by 44 pixels on a phone-sized screen', async () => {
    await page.viewport(390, 800)
    const screen = await render(panel('# Title'))
    const button = rect(
      screen.getByRole('button', { name: 'Copy Markdown' }).element()
    )

    expect(button.width).toBeGreaterThanOrEqual(44)
    expect(button.height).toBeGreaterThanOrEqual(44)
  })
})
