/**
 * The bridge between the application and the sandboxed frame of an HTML
 * document (ADR 0052). The page lives on an opaque origin and can only send
 * messages; this module decides which of them do anything. A capability the
 * page did not declare is off, and so is every message that does not come from
 * the frame this bridge was made for.
 */

export type PageCapability = 'theme' | 'download'

export interface PageTheme {
  mode: 'light' | 'dark'
  vars: Record<string, string>
}

export interface PageFile {
  name: string
  mime: string
  content: string
}

export interface PageBridgeOptions {
  /** The window of the frame this bridge serves. */
  frame: () => Window | null | undefined
  /** What the page declared and the server accepted. */
  capabilities: readonly string[]
  theme: () => PageTheme
  /** Whether the person clicked or pressed a key a moment ago. */
  activation: () => boolean
  save: (file: PageFile) => void
}

export const MAX_PAGE_FILE_BYTES = 2 * 1024 * 1024

const FILE_TYPES =
  /^(text\/(plain|html|csv|css|markdown)|application\/json|image\/svg\+xml)$/

/** A name safe to hand to the browser as a download name. */
export function safeFileName(name: unknown): string {
  const base = String(name ?? '')
    .split(/[\\/]/)
    .pop()!
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 100)
  return base || 'download.txt'
}

export function createPageBridge(options: PageBridgeOptions) {
  const has = (capability: PageCapability) =>
    options.capabilities.includes(capability)

  function sendTheme() {
    if (!has('theme')) return
    const { mode, vars } = options.theme()
    // The frame's origin is opaque, so no target origin can name it; what is sent is only colours.
    options.frame()?.postMessage({ dokudocs: 'theme', mode, vars }, '*')
  }

  function handle(event: { source: unknown; data: unknown }) {
    const frame = options.frame()
    if (!frame || event.source !== frame) return
    const data = event.data as Record<string, unknown> | null
    if (!data || typeof data !== 'object' || data.dokudocs !== 1) return

    if (data.type === 'ready') {
      sendTheme()
      return
    }
    if (data.type === 'download') {
      if (!has('download') || !options.activation()) return
      if (
        typeof data.content !== 'string' ||
        data.content.length > MAX_PAGE_FILE_BYTES
      )
        return
      const mime =
        typeof data.mime === 'string' && FILE_TYPES.test(data.mime)
          ? data.mime
          : 'text/plain'
      options.save({
        name: safeFileName(data.name),
        mime,
        content: data.content,
      })
    }
  }

  return { handle, sendTheme }
}

/** Saves a file the page made, the way a download link would. */
export function saveTextFile({ name, mime, content }: PageFile) {
  const url = URL.createObjectURL(
    new Blob([content], { type: `${mime};charset=utf-8` })
  )
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
