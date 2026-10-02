import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { page } from 'vitest/browser'
import { EditorModeTabs, modeTabStates } from './editor-mode-tabs'

const editor = { canEdit: true, canSuggest: true, online: true, synced: true }

describe('modeTabStates', () => {
  it('enables all three tabs for an editor who is online and synced', () => {
    const states = modeTabStates(editor)
    expect(states.view.disabledReason).toBeNull()
    expect(states.edit.disabledReason).toBeNull()
    expect(states.suggest.disabledReason).toBeNull()
  })

  it('lets a commenter view and suggest but not edit', () => {
    const states = modeTabStates({ ...editor, canEdit: false })
    expect(states.edit.disabledReason).toBe(
      'Edit needs edit access to this document.'
    )
    expect(states.suggest.disabledReason).toBeNull()
  })

  it('disables Suggest for a viewer with the access reason', () => {
    const states = modeTabStates({
      ...editor,
      canEdit: false,
      canSuggest: false,
    })
    expect(states.suggest.disabledReason).toBe(
      'Suggest needs comment or edit access to this document.'
    )
  })

  it('disables Suggest offline but keeps Edit, which stores changes on the device', () => {
    const states = modeTabStates({ ...editor, online: false })
    expect(states.suggest.disabledReason).toBe(
      'Suggestions are sent to the server, so Suggest needs a connection.'
    )
    expect(states.edit.disabledReason).toBeNull()
  })

  it('disables Suggest until the document has synced', () => {
    const states = modeTabStates({ ...editor, synced: false })
    expect(states.suggest.disabledReason).toBe(
      'Suggest is available once the document has synced.'
    )
  })
})

describe('EditorModeTabs', () => {
  it('renders View, Edit and Suggest as tabs and marks the active one', async () => {
    await render(
      <EditorModeTabs
        mode='edit'
        states={modeTabStates(editor)}
        onChange={vi.fn()}
      />
    )
    await expect
      .element(page.getByRole('tablist', { name: 'Editor mode' }))
      .toBeVisible()
    await expect
      .element(page.getByRole('tab', { name: 'Edit', exact: true }))
      .toHaveAttribute('aria-selected', 'true')
    await expect
      .element(page.getByRole('tab', { name: 'View', exact: true }))
      .toHaveAttribute('aria-selected', 'false')
    await expect
      .element(page.getByRole('tab', { name: 'Suggest', exact: true }))
      .toBeVisible()
  })

  it('reports the chosen mode', async () => {
    const onChange = vi.fn()
    await render(
      <EditorModeTabs
        mode='edit'
        states={modeTabStates(editor)}
        onChange={onChange}
      />
    )
    await page.getByRole('tab', { name: 'Suggest', exact: true }).click()
    expect(onChange).toHaveBeenCalledWith('suggest')
  })

  it('keeps a disabled tab visible, explains why, and ignores clicks', async () => {
    const onChange = vi.fn()
    await render(
      <EditorModeTabs
        mode='view'
        states={modeTabStates({ ...editor, canEdit: false })}
        onChange={onChange}
      />
    )
    const edit = page.getByRole('tab', { name: 'Edit', exact: true })
    await expect.element(edit).toHaveAttribute('aria-disabled', 'true')
    await userEvent.hover(edit)
    await expect
      .element(page.getByRole('tooltip'))
      .toHaveTextContent('Edit needs edit access to this document.')
    await edit.click({ force: true })
    expect(onChange).not.toHaveBeenCalled()
  })
})
