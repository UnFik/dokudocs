// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Content from '../block/base/content'
import { de, en, es, fr, ja, ko, pt, zhCN, zhTW } from '../locales'
import { Muya } from '../muya'

// REGRESSION GUARD — #4424 / #4427 (Phase-G migration crash).
//
// Typing `#` (then a space) converts a paragraph to an ATX heading. That path
// once called `muya.i18n.t(...)` with a key missing from the locale resources,
// and `I18n.t` fell through to `resources.en[key]`, which is `undefined` under
// a non-`en` locale, so it threw. These tests pin that creating a heading under
// every shipped locale does not throw, and that `I18n.t` stays crash-safe for a
// missing key.

const bootedHosts: HTMLElement[] = []
let originalVersion: string | undefined
let hadVersion = false

beforeEach(() => {
  hadVersion = 'MUYA_VERSION' in window
  originalVersion = window.MUYA_VERSION
  window.MUYA_VERSION = 'test'
})

afterEach(() => {
  while (bootedHosts.length) {
    const host = bootedHosts.pop()!
    host.remove()
  }
  // Drop any document-global Selection so a stale Range can't point into a
  // removed host node and break a later test's setCursor.
  window.getSelection()?.removeAllRanges()
  if (hadVersion) window.MUYA_VERSION = originalVersion as string
  else delete (window as Partial<Window>).MUYA_VERSION
})

function bootMuya(markdown: string, locale: typeof en): Muya {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const muya = new Muya(host, {
    markdown,
    locale,
  } as ConstructorParameters<typeof Muya>[1])
  muya.init()
  bootedHosts.push(muya.domNode)
  return muya
}

// Drive the real "type `# x`" input path: write the text into the active
// content block's contenteditable node, place the caret, and run the block's
// `inputHandler` the way a keystroke does. `inputHandler` reads the DOM text
// and runs `_convertIfNeeded`, which converts the paragraph to an ATX heading —
// the exact path that creates the heading block. (We invoke
// `inputHandler` directly because happy-dom does not deliver a dispatched
// `input` event to the engine's listener.) The conversion's state flush lands
// on the next animation frame, so callers await `flush()` before asserting on
// `getState()`.
function typeHeading(muya: Muya, raw: string): void {
  const content = muya.editor.scrollPage!.firstContentInDescendant() as Content
  muya.editor.activeContentBlock = content
  content.domNode!.textContent = raw
  content.setCursor(raw.length, raw.length)
  content.inputHandler(
    new InputEvent('input', { bubbles: true, inputType: 'insertText' })
  )
}

function flush(): Promise<void> {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

describe('typing `#` to create a heading under a non-en locale (#4424 / #4427)', () => {
  it('does not throw when converting a paragraph to an ATX heading under zh-CN', async () => {
    const muya = bootMuya('\n', zhCN)

    expect(() => typeHeading(muya, '# Heading')).not.toThrow()

    // The conversion actually happened — otherwise the i18n path that used
    // to crash would never have run.
    await flush()
    expect(muya.getState()[0].name).toBe('atx-heading')
  })

  it('i18n.t stays crash-safe and falls back to the raw key for a key missing from a non-en locale', () => {
    // Guards the optional-chaining fix in I18n.t directly: under a non-en
    // locale `resources.en` is undefined, so a missing key must fall back
    // to the raw key instead of throwing.
    const muya = bootMuya('\n', zhCN)
    const missingKey = '__definitely_not_a_real_i18n_key__'
    expect(() => muya.i18n.t(missingKey)).not.toThrow()
    expect(muya.i18n.t(missingKey)).toBe(missingKey)
  })

  it('converts a paragraph to a heading under every shipped locale', async () => {
    const shippedLocales = [de, en, es, fr, ja, ko, pt, zhCN, zhTW]
    for (const locale of shippedLocales) {
      const muya = bootMuya('\n', locale)
      expect(() => typeHeading(muya, '# Heading')).not.toThrow()
      await flush()
      expect(muya.getState()[0].name).toBe('atx-heading')
    }
  })
})
