import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import {
  emptyInlineState,
  type InlineState,
} from '../lib/prosemirror/inlineMarks'
import { HistoryButtons, SelectionToolbar } from './editor-format-toolbar'

const selected: InlineState = {
  hasSelection: true,
  marks: { strong: true, em: false, strike: false, code: false },
  link: null,
  rect: { top: 100, bottom: 120, left: 40, right: 140 },
}

function selectionProps(overrides = {}) {
  return {
    inline: selected,
    onToggleMark: vi.fn(),
    onSetLink: vi.fn(() => true),
    onRemoveLink: vi.fn(),
    linkRequest: 0,
    ...overrides,
  }
}

describe('HistoryButtons', () => {
  it('disables undo and redo with no history and runs them when enabled', async () => {
    const onUndo = vi.fn()
    const onRedo = vi.fn()
    const view = await render(
      <HistoryButtons
        history={{ canUndo: false, canRedo: true }}
        onUndo={onUndo}
        onRedo={onRedo}
      />
    )
    await expect
      .element(view.getByRole('button', { name: 'Undo' }))
      .toBeDisabled()
    await view.getByRole('button', { name: 'Redo' }).click()
    expect(onRedo).toHaveBeenCalledOnce()
    expect(onUndo).not.toHaveBeenCalled()
  })

  it('disables both buttons when the editor is not editable', async () => {
    const view = await render(
      <HistoryButtons
        disabled
        history={{ canUndo: true, canRedo: true }}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
      />
    )
    await expect
      .element(view.getByRole('button', { name: 'Undo' }))
      .toBeDisabled()
    await expect
      .element(view.getByRole('button', { name: 'Redo' }))
      .toBeDisabled()
  })
})

describe('SelectionToolbar', () => {
  it('renders nothing without a text selection', async () => {
    const view = await render(
      <SelectionToolbar {...selectionProps({ inline: emptyInlineState })} />
    )
    expect(view.container.querySelector('[role="toolbar"]')).toBeNull()
  })

  it('shows pressed state and toggles marks', async () => {
    const props = selectionProps()
    const view = await render(<SelectionToolbar {...props} />)
    await expect
      .element(view.getByRole('button', { name: 'Bold' }))
      .toHaveAttribute('aria-pressed', 'true')
    await expect
      .element(view.getByRole('button', { name: 'Italic' }))
      .toHaveAttribute('aria-pressed', 'false')
    await view.getByRole('button', { name: 'Italic' }).click()
    expect(props.onToggleMark).toHaveBeenCalledWith('em')
  })

  it('collects a link target and rejects an unsafe one', async () => {
    const props = selectionProps({
      onSetLink: vi.fn((href: string) => href.startsWith('https')),
    })
    const view = await render(<SelectionToolbar {...props} />)
    await view.getByRole('button', { name: 'Link' }).click()
    const input = view.getByRole('textbox', { name: 'Link address' })
    await input.fill('javascript:alert(1)')
    await view.getByRole('button', { name: 'Apply link' }).click()
    await expect.element(view.getByRole('alert')).toBeVisible()
    await input.fill('https://example.com')
    await view.getByRole('button', { name: 'Apply link' }).click()
    expect(props.onSetLink).toHaveBeenLastCalledWith('https://example.com')
  })

  it('removes an existing link', async () => {
    const props = selectionProps({
      inline: { ...selected, link: 'https://example.com' },
    })
    const view = await render(<SelectionToolbar {...props} />)
    await view.getByRole('button', { name: 'Remove link' }).click()
    expect(props.onRemoveLink).toHaveBeenCalledOnce()
  })

  it('opens the link field when a link is requested from the keyboard', async () => {
    const props = selectionProps()
    const view = await render(<SelectionToolbar {...props} />)
    await view.rerender(<SelectionToolbar {...props} linkRequest={1} />)
    await expect
      .element(view.getByRole('textbox', { name: 'Link address' }))
      .toBeVisible()
  })
})
