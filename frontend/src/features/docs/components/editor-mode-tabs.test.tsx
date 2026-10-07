import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { EditorModeTabs, modeTabStates, resolveMode } from './editor-mode-tabs'

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
  const trigger = () => page.getByRole('button', { name: /Editor mode/ })
  const item = (name: string) =>
    page.getByRole('menuitemradio', { name, exact: true })

  it('shows the current mode on a button and lists View, Edit and Suggest when opened', async () => {
    await render(
      <EditorModeTabs
        mode='edit'
        states={modeTabStates(editor)}
        onChange={vi.fn()}
      />
    )
    await expect.element(trigger()).toHaveTextContent('Edit')
    await trigger().click()
    await expect.element(item('Edit')).toHaveAttribute('aria-checked', 'true')
    await expect.element(item('View')).toHaveAttribute('aria-checked', 'false')
    await expect.element(item('Suggest')).toBeVisible()
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
    await trigger().click()
    await item('Suggest').click()
    expect(onChange).toHaveBeenCalledWith('suggest')
  })

  it('keeps a disabled mode listed, says why, and ignores it', async () => {
    const onChange = vi.fn()
    await render(
      <EditorModeTabs
        mode='view'
        states={modeTabStates({ ...editor, canEdit: false })}
        onChange={onChange}
      />
    )
    await trigger().click()
    await expect.element(item('Edit')).toHaveAttribute('aria-disabled', 'true')
    await expect
      .element(page.getByText('Edit needs edit access to this document.'))
      .toBeVisible()
    await item('Edit').click({ force: true })
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('resolveMode', () => {
  it('keeps a mode the user may use', () => {
    expect(resolveMode('edit', { canEdit: true, suggestEnabled: true })).toBe(
      'edit'
    )
    expect(
      resolveMode('suggest', { canEdit: false, suggestEnabled: true })
    ).toBe('suggest')
  })

  it('falls back to view when edit is no longer allowed', () => {
    expect(resolveMode('edit', { canEdit: false, suggestEnabled: true })).toBe(
      'view'
    )
  })

  it('falls back from Suggest to Edit for an editor, and to View when the user cannot edit', () => {
    expect(
      resolveMode('suggest', { canEdit: true, suggestEnabled: false })
    ).toBe('edit')
    expect(
      resolveMode('suggest', { canEdit: false, suggestEnabled: false })
    ).toBe('view')
  })
})
