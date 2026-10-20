import { describe, expect, it, vi } from 'vitest'
import {
  createPageBridge,
  MAX_PAGE_FILE_BYTES,
  safeFileName,
  type PageFile,
} from './page-bridge'

function setup(
  options: { capabilities?: string[]; activation?: boolean } = {}
) {
  const frame = { postMessage: vi.fn() } as unknown as Window
  const saved: PageFile[] = []
  const bridge = createPageBridge({
    frame: () => frame,
    capabilities: options.capabilities ?? ['theme', 'download'],
    theme: () => ({ mode: 'dark', vars: { '--background': '#000000' } }),
    activation: () => options.activation ?? true,
    save: (file) => saved.push(file),
  })
  return { frame, saved, bridge }
}

const from = (source: unknown, data: unknown) => ({ source, data })

describe('the page bridge', () => {
  it('answers ready with the theme, only to a page that declared theme', () => {
    const on = setup()
    on.bridge.handle(from(on.frame, { dokudocs: 1, type: 'ready' }))
    expect(on.frame.postMessage).toHaveBeenCalledWith(
      { dokudocs: 'theme', mode: 'dark', vars: { '--background': '#000000' } },
      '*'
    )

    const off = setup({ capabilities: ['download'] })
    off.bridge.handle(from(off.frame, { dokudocs: 1, type: 'ready' }))
    expect(off.frame.postMessage).not.toHaveBeenCalled()
  })

  it('ignores a message that does not come from its own frame', () => {
    const { frame, saved, bridge } = setup()
    const other = {} as Window
    for (const source of [other, null, window, undefined]) {
      bridge.handle(from(source, { dokudocs: 1, type: 'ready' }))
      bridge.handle(
        from(source, {
          dokudocs: 1,
          type: 'download',
          name: 'a.txt',
          content: 'x',
        })
      )
    }
    expect(frame.postMessage).not.toHaveBeenCalled()
    expect(saved).toEqual([])
  })

  it('ignores messages that are not the bridge protocol', () => {
    const { frame, saved, bridge } = setup()
    for (const data of [
      null,
      undefined,
      'ready',
      42,
      [],
      {},
      { type: 'ready' },
      { dokudocs: 2, type: 'ready' },
      { dokudocs: 1, type: 'unknown' },
    ]) {
      bridge.handle(from(frame, data))
    }
    expect(frame.postMessage).not.toHaveBeenCalled()
    expect(saved).toEqual([])
  })

  it('saves a download only after a click or key press, and only if declared', () => {
    const message = {
      dokudocs: 1,
      type: 'download',
      name: 'report.csv',
      mime: 'text/csv',
      content: 'a,b',
    }

    const ok = setup()
    ok.bridge.handle(from(ok.frame, message))
    expect(ok.saved).toEqual([
      { name: 'report.csv', mime: 'text/csv', content: 'a,b' },
    ])

    const noClick = setup({ activation: false })
    noClick.bridge.handle(from(noClick.frame, message))
    expect(noClick.saved).toEqual([])

    const undeclared = setup({ capabilities: ['theme'] })
    undeclared.bridge.handle(from(undeclared.frame, message))
    expect(undeclared.saved).toEqual([])
  })

  it('refuses a file that is too large or not text, and tames its name and type', () => {
    const { frame, saved, bridge } = setup()
    bridge.handle(
      from(frame, {
        dokudocs: 1,
        type: 'download',
        name: 'big.txt',
        content: 'x'.repeat(MAX_PAGE_FILE_BYTES + 1),
      })
    )
    bridge.handle(
      from(frame, {
        dokudocs: 1,
        type: 'download',
        name: 'bin',
        content: { not: 'text' },
      })
    )
    expect(saved).toEqual([])

    bridge.handle(
      from(frame, {
        dokudocs: 1,
        type: 'download',
        name: '../../etc/passwd',
        mime: 'application/x-msdownload',
        content: 'x',
      })
    )
    expect(saved).toEqual([
      { name: 'passwd', mime: 'text/plain', content: 'x' },
    ])
  })
})

describe('safeFileName', () => {
  it('keeps a plain name and strips paths, control characters and leading dots', () => {
    expect(safeFileName('notes.txt')).toBe('notes.txt')
    expect(safeFileName('C:\\temp\\a.csv')).toBe('a.csv')
    expect(safeFileName('../x/.hidden')).toBe('hidden')
    expect(safeFileName('a\u0000b<c>.txt')).toBe('abc.txt')
    expect(safeFileName('')).toBe('download.txt')
    expect(safeFileName(undefined)).toBe('download.txt')
    expect(safeFileName('x'.repeat(300)).length).toBe(100)
  })
})
