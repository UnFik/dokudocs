// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Format from '../../block/base/format'
import { Muya } from '../../muya'

const bootedHosts: HTMLElement[] = []

beforeEach(() => {
  window.MUYA_VERSION = 'test'
})

afterEach(() => {
  while (bootedHosts.length) bootedHosts.pop()!.remove()
  delete (window as Partial<Window>).MUYA_VERSION
})

function bootMuya(markdown: string): Muya {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const muya = new Muya(host, { markdown } as ConstructorParameters<
    typeof Muya
  >[1])
  muya.init()
  bootedHosts.push(muya.domNode)
  return muya
}

function undoDepth(muya: Muya): number {
  // @ts-expect-error — reach into the private stack for test assertions.
  return muya.editor.history._stack.undo.length
}

describe('history selection tracking', () => {
  it('captures initial cursor and restores it on first undo', async () => {
    const muya = bootMuya('First paragraph\n')
    const first =
      muya.editor.scrollPage!.firstContentInDescendant() as unknown as Format
    muya.editor.activeContentBlock = first
    first.setCursor(6, 6, true)

    first.text = 'First edited paragraph'
    first.checkInlineUpdate()

    await vi.waitFor(() => {
      expect(undoDepth(muya)).toBe(1)
    })

    // @ts-expect-error — inspect recorded selection
    const recordedSel = muya.editor.history._stack.undo[0].selection
    expect(recordedSel).not.toBeNull()
    expect(recordedSel?.anchor.offset).toBe(6)

    muya.undo()

    await vi.waitFor(() => {
      expect(muya.getMarkdown()).toContain('First paragraph')
    })
  })

  it('isolates selections between edits across different blocks without stale anchors', async () => {
    const muya = bootMuya('First line\n\nSecond line\n')
    const first =
      muya.editor.scrollPage!.firstContentInDescendant() as unknown as Format
    const second =
      muya.editor.scrollPage!.lastContentInDescendant() as unknown as Format

    muya.editor.activeContentBlock = first
    first.setCursor(2, 2, true)
    first.text = 'Fi123rst line'
    first.checkInlineUpdate()

    await vi.waitFor(() => {
      expect(undoDepth(muya)).toBe(1)
    })

    muya.editor.activeContentBlock = second
    second.setCursor(7, 7, true)
    second.text = 'Second edited line'
    second.checkInlineUpdate()

    await vi.waitFor(() => {
      expect(undoDepth(muya)).toBe(2)
    })

    // @ts-expect-error — inspect recorded selections
    const undoStack = muya.editor.history._stack.undo
    expect(undoStack[0].selection?.anchor.offset).toBe(2)
    expect(undoStack[1].selection?.anchor.offset).toBe(7)
  })
})
