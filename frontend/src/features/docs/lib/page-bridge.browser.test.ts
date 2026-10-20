import { afterEach, describe, expect, it } from 'vitest'
// The script the server puts at the top of every page (the Go side fills in the two placeholders).
import bootstrap from '../../../../../backend/internal/application/htmlpage/bootstrap.js?raw'
import { createPageBridge, type PageFile } from './page-bridge'

const frames: HTMLIFrameElement[] = []
const listeners: Array<(event: MessageEvent) => void> = []
afterEach(() => {
  frames.splice(0).forEach((frame) => frame.remove())
  listeners.splice(0).forEach((l) => window.removeEventListener('message', l))
})

/** A page as the server serves it: the bridge script first, then the page's own script. */
function open(capabilities: string[], pageScript: string) {
  const script = bootstrap
    .replace('__CAPABILITIES__', JSON.stringify(capabilities))
    .replace('__APP_ORIGIN__', JSON.stringify(window.location.origin))
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.srcdoc = `<!doctype html><html><head><script>${script}</script></head><body><script>${pageScript}</script></body></html>`
  frames.push(frame)
  return frame
}

function connect(
  frame: HTMLIFrameElement,
  capabilities: string[],
  options: { activation?: boolean } = {}
) {
  const saved: PageFile[] = []
  const bridge = createPageBridge({
    frame: () => frame.contentWindow,
    capabilities,
    theme: () => ({
      mode: 'dark',
      vars: { '--background': '#101010', '--signal': '#38bdf8' },
    }),
    activation: () => options.activation ?? true,
    save: (file) => saved.push(file),
  })
  const onMessage = (event: MessageEvent) => bridge.handle(event)
  listeners.push(onMessage)
  window.addEventListener('message', onMessage)
  document.body.appendChild(frame)
  return saved
}

/** The page reports back what it saw, so the test can look at it. */
const report = `
  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    if (e.data && e.data.report) {
      var root = document.documentElement;
      parent.postMessage({ report: 1, mode: root.getAttribute('data-theme'),
        background: root.style.getPropertyValue('--background'), signal: root.style.getPropertyValue('--signal'),
        hasTheme: !!(window.dokudocs && window.dokudocs.theme), hasDownload: !!(window.dokudocs && window.dokudocs.download),
        frozen: Object.isFrozen(window.dokudocs) }, '*');
    }
  });
`

function ask<T>(frame: HTMLIFrameElement): Promise<T> {
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      if (event.source === frame.contentWindow && event.data?.report) {
        window.removeEventListener('message', onMessage)
        resolve(event.data as T)
      }
    }
    window.addEventListener('message', onMessage)
    setTimeout(() => frame.contentWindow?.postMessage({ report: 1 }, '*'), 400)
  })
}

describe('the script in a served page and the bridge in the application', () => {
  it('hand over the theme when the page says it is ready', async () => {
    const frame = open(['theme'], report)
    connect(frame, ['theme'])
    const seen = await ask<Record<string, unknown>>(frame)
    expect(seen).toMatchObject({
      mode: 'dark',
      background: '#101010',
      signal: '#38bdf8',
      hasTheme: true,
      hasDownload: false,
      frozen: true,
    })
  })

  it('give a page only what it declared', async () => {
    const frame = open(['download'], report)
    connect(frame, ['download'])
    const seen = await ask<Record<string, unknown>>(frame)
    expect(seen).toMatchObject({
      hasTheme: false,
      hasDownload: true,
      mode: null,
    })
  })

  it('save a file the page offers, after a click, and not otherwise', async () => {
    const offer = `window.dokudocs.download('report.csv', 'a,b', 'text/csv');`
    const withClick = open(['download'], offer)
    const saved = connect(withClick, ['download'], { activation: true })
    await expect.poll(() => saved.length).toBe(1)
    expect(saved[0]).toEqual({
      name: 'report.csv',
      mime: 'text/csv',
      content: 'a,b',
    })

    const withoutClick = open(['download'], offer)
    const none = connect(withoutClick, ['download'], { activation: false })
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(none).toEqual([])
  })

  it('cannot be overwritten by the page', async () => {
    const frame = open(
      ['theme'],
      `try { window.dokudocs = {}; } catch (e) {} try { window.dokudocs.theme = null; } catch (e) {} ${report}`
    )
    connect(frame, ['theme'])
    const seen = await ask<Record<string, unknown>>(frame)
    expect(seen).toMatchObject({ hasTheme: true, frozen: true })
  })
})
