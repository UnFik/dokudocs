import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { DocumentTitleRow } from './document-title-row'

describe('DocumentTitleRow', () => {
  it('shows the title as a heading-sized field with a name', async () => {
    const screen = await render(
      <DocumentTitleRow
        title='Plan'
        readOnly={false}
        onCommit={() => {}}
        onEnterBody={() => {}}
      />
    )
    await expect
      .element(screen.getByRole('textbox', { name: 'Document title' }))
      .toHaveValue('Plan')
  })

  it('saves a changed title when the field loses focus', async () => {
    const onCommit = vi.fn()
    const screen = await render(
      <DocumentTitleRow
        title='Plan'
        readOnly={false}
        onCommit={onCommit}
        onEnterBody={() => {}}
      />
    )
    const field = screen.getByRole('textbox', { name: 'Document title' })
    await userEvent.fill(field, 'Plan B')
    await userEvent.tab()
    expect(onCommit).toHaveBeenCalledWith('Plan B')
  })

  it('does not save an empty or unchanged title', async () => {
    const onCommit = vi.fn()
    const screen = await render(
      <DocumentTitleRow
        title='Plan'
        readOnly={false}
        onCommit={onCommit}
        onEnterBody={() => {}}
      />
    )
    const field = screen.getByRole('textbox', { name: 'Document title' })
    await userEvent.fill(field, '   ')
    await userEvent.tab()
    expect(onCommit).not.toHaveBeenCalled()
    await expect.element(field).toHaveValue('Plan')
  })

  it('moves into the text on Enter and on Arrow Down', async () => {
    const onEnterBody = vi.fn()
    const screen = await render(
      <DocumentTitleRow
        title='Plan'
        readOnly={false}
        onCommit={() => {}}
        onEnterBody={onEnterBody}
      />
    )
    await userEvent.click(
      screen.getByRole('textbox', { name: 'Document title' })
    )
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('{ArrowDown}')
    expect(onEnterBody).toHaveBeenCalledTimes(2)
  })

  it('cannot be edited when read only', async () => {
    const screen = await render(
      <DocumentTitleRow
        title='Plan'
        readOnly
        onCommit={() => {}}
        onEnterBody={() => {}}
      />
    )
    await expect
      .element(screen.getByRole('textbox', { name: 'Document title' }))
      .toHaveAttribute('readonly')
  })
})
