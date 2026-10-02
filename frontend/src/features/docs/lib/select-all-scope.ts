const ownField =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="combobox"]'

/**
 * Whether Select all should be taken over to select the document body. It is
 * left to the browser inside form fields, dialogs, and menus, and to the
 * editor's own keymap when focus is already in the editor.
 */
export function shouldSelectDocumentBody(
  event: Pick<
    KeyboardEvent,
    'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'defaultPrevented'
  > & { target: EventTarget | null },
  editorRoot: Element | null
): boolean {
  if (event.defaultPrevented || event.altKey || event.shiftKey) return false
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a')
    return false
  if (!editorRoot) return false
  const target = event.target
  if (target instanceof Element && target.closest(ownField)) return false
  return true
}
