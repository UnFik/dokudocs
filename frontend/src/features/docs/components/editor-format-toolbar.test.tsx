import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import {
  emptyInlineState,
  type InlineState,
} from '../lib/prosemirror/inlineMarks'
import { HistoryButtons, SelectionToolbar } from './editor-format-toolbar'

const selected: InlineState = {
  hasSelection: true,
  block: 'paragraph',
  marks: {
    strong: true,
    em: false,
    strike: false,
    code: false,
    underline: false,
    highlight: false,
  },
  link: null,
  rect: { top: 100, bottom: 120, left: 40, right: 140 },
}

function selectionProps(overrides = {}) {
  return {
    inline: selected,
    onToggleMark: vi.fn(),
    onSetLink: vi.fn(() => true),
    onRemoveLink: vi.fn(),
    onSetHeading: vi.fn(),
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

  it('stays inside the viewport when the selection is near the right edge', async () => {
    const props = selectionProps({
      inline: {
        ...selected,
        rect: { top: 100, bottom: 120, left: 9000, right: 9100 },
      },
    })
    const view = await render(<SelectionToolbar {...props} />)
    await view.getByRole('button', { name: 'Link' }).click()
    const toolbar = view.container.querySelector('[role="toolbar"]')!
    const box = toolbar.getBoundingClientRect()
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.right).toBeLessThanOrEqual(window.innerWidth)
  })
})

describe('SelectionToolbar highlight', () => {
  it('offers Highlight next to the other marks', async () => {
    const onToggleMark = vi.fn()
    const screen = await render(
      <SelectionToolbar {...selectionProps({ onToggleMark })} />
    )
    await screen.getByRole('button', { name: /Highlight/ }).click()
    expect(onToggleMark.mock.calls.map(([name]) => name)).toEqual(['highlight'])
  })
})

describe('SelectionToolbar blocks', () => {
  it('sets a heading level, and clears it when that level is pressed again', async () => {
    const onSetHeading = vi.fn()
    const view = await render(
      <SelectionToolbar
        {...selectionProps({
          onSetHeading,
          inline: { ...selected, block: 'heading-2' },
        })}
      />
    )
    await view.getByRole('button', { name: 'Heading 1' }).click()
    await view.getByRole('button', { name: 'Heading 2' }).click()
    expect(onSetHeading.mock.calls.map(([level]) => level)).toEqual([1, 0])
    await expect
      .element(view.getByRole('button', { name: 'Heading 2' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('wraps a plain line in a list, quote or toggle', async () => {
    const onWrapBlock = vi.fn()
    const view = await render(
      <SelectionToolbar
        {...selectionProps({
          onWrapBlock,
          inline: { ...selected, block: 'paragraph' },
        })}
      />
    )
    for (const name of [
      'Quote',
      'Toggle block',
      'Task list',
      'Bulleted list',
      'Numbered list',
    ])
      await view.getByRole('button', { name }).click()
    expect(onWrapBlock.mock.calls.map(([kind]) => kind)).toEqual([
      'quote',
      'toggle',
      'task-list',
      'bullet-list',
      'ordered-list',
    ])
  })

  it('disables the wrapping buttons where a line cannot be wrapped', async () => {
    const view = await render(
      <SelectionToolbar
        {...selectionProps({ inline: { ...selected, block: 'paragraph' } })}
      />
    )
    await expect
      .element(view.getByRole('button', { name: 'Quote' }))
      .toBeDisabled()
  })
})

describe('SelectionToolbar comment', () => {
  it('offers an Add comment icon that starts a comment on the selection', async () => {
    const onComment = vi.fn()
    const view = await render(
      <SelectionToolbar {...selectionProps({ onComment })} />
    )
    await view.getByRole('button', { name: 'Add comment' }).click()
    expect(onComment).toHaveBeenCalledOnce()
  })

  it('has no comment icon when commenting is not possible', async () => {
    const view = await render(<SelectionToolbar {...selectionProps()} />)
    expect(
      view.getByRole('button', { name: 'Add comment' }).elements()
    ).toHaveLength(0)
  })
})
