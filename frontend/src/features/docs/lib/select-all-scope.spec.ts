import { describe, expect, it } from 'vitest'
import { shouldSelectDocumentBody } from './select-all-scope'

const root = document.createElement('div')
const key = (
  target: EventTarget | null,
  init: Partial<Parameters<typeof shouldSelectDocumentBody>[0]> = {}
) => ({
  key: 'a',
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  defaultPrevented: false,
  target,
  ...init,
})

describe('shouldSelectDocumentBody', () => {
  it('takes over Ctrl+A and Cmd+A pressed on the page', () => {
    expect(shouldSelectDocumentBody(key(document.body), root)).toBe(true)
    expect(
      shouldSelectDocumentBody(
        key(document.body, { ctrlKey: false, metaKey: true, key: 'A' }),
        root
      )
    ).toBe(true)
  })

  it('leaves other shortcuts alone', () => {
    for (const init of [
      { key: 'b' },
      { ctrlKey: false },
      { shiftKey: true },
      { altKey: true },
      { defaultPrevented: true },
    ])
      expect(shouldSelectDocumentBody(key(document.body, init), root)).toBe(
        false
      )
  })

  it('leaves form fields, dialogs, and menus to the browser', () => {
    const field = document.createElement('input')
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const inDialog = document.createElement('button')
    dialog.append(inDialog)
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    for (const target of [field, inDialog, editable])
      expect(shouldSelectDocumentBody(key(target), root)).toBe(false)
  })

  it('does nothing without an editor', () => {
    expect(shouldSelectDocumentBody(key(document.body), null)).toBe(false)
  })
})
