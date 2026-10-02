import { describe, expect, it } from 'vitest'
import { mountTestEditor, paragraphsBody } from './editorTestKit'

describe('editor stylesheet', () => {
  it('preserves typed spaces instead of letting the browser write NBSP', () => {
    const harness = mountTestEditor(paragraphsBody('hello'))
    try {
      expect(getComputedStyle(harness.editor.view.dom).whiteSpace).toBe(
        'break-spaces'
      )
    } finally {
      harness.cleanup()
    }
  })
})
