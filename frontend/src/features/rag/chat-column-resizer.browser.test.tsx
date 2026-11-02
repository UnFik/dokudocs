import '@/styles/index.css'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { CHAT_COLUMN_WIDTH } from './chat-column-width'
import { ChatColumnResizer } from './chat-column-resizer'

const pointer = (target: Element, type: string, x: number) =>
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: 100,
      pointerId: 1,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      isPrimary: true,
    })
  )

const keydown = (target: Element, key: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))

describe('dragging the left edge of the chat column', () => {
  it('widens the column to the left and keeps the width when let go', async () => {
    const onCommit = vi.fn()
    await render(
      <ChatColumnResizer
        width={CHAT_COLUMN_WIDTH.default}
        onResize={() => {}}
        onCommit={onCommit}
      />
    )
    const handle = page.getByRole('separator', { name: 'Resize the AI chat' })
    const edge = handle.element()
    const x = edge.getBoundingClientRect().x
    pointer(edge, 'pointerdown', x)
    pointer(edge, 'pointermove', x - 40)
    expect(onCommit).not.toHaveBeenCalled()
    pointer(edge, 'pointerup', x - 40)
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(424)
  })
})

describe('the keyboard and double click on the edge', () => {
  it('moves the width with the arrow keys, and Home and End go to the limits', async () => {
    const onCommit = vi.fn()
    await render(
      <ChatColumnResizer
        width={CHAT_COLUMN_WIDTH.default}
        onResize={() => {}}
        onCommit={onCommit}
      />
    )
    const edge = page
      .getByRole('separator', { name: 'Resize the AI chat' })
      .element()
    keydown(edge, 'ArrowLeft')
    expect(onCommit).toHaveBeenLastCalledWith(400)
    keydown(edge, 'Home')
    expect(onCommit).toHaveBeenLastCalledWith(CHAT_COLUMN_WIDTH.min)
    keydown(edge, 'End')
    expect(onCommit).toHaveBeenLastCalledWith(CHAT_COLUMN_WIDTH.max)
  })

  it('puts the default width back on a double click', async () => {
    const onCommit = vi.fn()
    await render(
      <ChatColumnResizer width={500} onResize={() => {}} onCommit={onCommit} />
    )
    const edge = page
      .getByRole('separator', { name: 'Resize the AI chat' })
      .element()
    edge.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(CHAT_COLUMN_WIDTH.default)
  })
})
