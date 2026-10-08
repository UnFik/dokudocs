import { useState } from 'react'
import '@/styles/index.css'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { panelWidths } from '../lib/panel-width'
import { PanelResizer } from './panel-resizer'

function Harness(props: {
  side: 'palette' | 'props'
  onCommit: (w: number) => void
}) {
  const [width, setWidth] = useState<number>(panelWidths[props.side].default)
  return (
    <div style={{ display: 'flex', width: 1000, height: 300 }}>
      {props.side === 'palette' && (
        <div data-testid='panel' style={{ width }} />
      )}
      <PanelResizer
        side={props.side}
        width={width}
        onResize={setWidth}
        onCommit={props.onCommit}
      />
      <div style={{ flex: 1 }} />
      {props.side === 'props' && <div data-testid='panel' style={{ width }} />}
    </div>
  )
}

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

describe('dragging the edge of a side panel', () => {
  it('widens the palette to the right and keeps the new width when let go', async () => {
    const onCommit = vi.fn()
    await render(<Harness side='palette' onCommit={onCommit} />)
    const handle = page.getByRole('separator', { name: 'Resize the palette' })
    await expect.element(handle).toHaveAttribute('aria-valuenow', '216')
    const edge = handle.element()
    const x = edge.getBoundingClientRect().x
    pointer(edge, 'pointerdown', x)
    pointer(edge, 'pointermove', x + 40)
    pointer(edge, 'pointermove', x + 64)
    expect(onCommit).not.toHaveBeenCalled()
    pointer(edge, 'pointerup', x + 64)
    await expect.element(handle).toHaveAttribute('aria-valuenow', '280')
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(280)
  })

  it('widens the properties panel to the left, and never past its widest', async () => {
    const onCommit = vi.fn()
    await render(<Harness side='props' onCommit={onCommit} />)
    const edge = page
      .getByRole('separator', { name: 'Resize the properties panel' })
      .element()
    const x = edge.getBoundingClientRect().x
    pointer(edge, 'pointerdown', x)
    pointer(edge, 'pointermove', x - 600)
    pointer(edge, 'pointerup', x - 600)
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(panelWidths.props.max)
  })
})

describe('the edge from the keyboard', () => {
  it('moves with the arrows, jumps with Home and End, and resets on double click', async () => {
    const onCommit = vi.fn()
    await render(<Harness side='palette' onCommit={onCommit} />)
    const handle = page.getByRole('separator', { name: 'Resize the palette' })
    ;(handle.element() as HTMLElement).focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(handle).toHaveAttribute('aria-valuenow', '232')
    await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}')
    await expect.element(handle).toHaveAttribute('aria-valuenow', '180')
    await userEvent.keyboard('{End}')
    await expect
      .element(handle)
      .toHaveAttribute('aria-valuenow', String(panelWidths.palette.max))
    await userEvent.dblClick(handle)
    await expect.element(handle).toHaveAttribute('aria-valuenow', '216')
    expect(onCommit).toHaveBeenLastCalledWith(216)
  })
})
