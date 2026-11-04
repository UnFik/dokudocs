import githubMarkdownCss from 'github-markdown-css/github-markdown-light.css?inline'
import { assetObjectURL } from './assets'
import printCss from './export-print.css?inline'
import { drawDiagrams, renderMarkdown } from './render-markdown'

function toDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

let katexReady: Promise<string> | undefined

/**
 * KaTeX's stylesheet with its fonts written into it as data: addresses, because the
 * page may load nothing. Loaded once, and only for a document that has a formula.
 */
function katexStyles(): Promise<string> {
  katexReady ??= (async () => {
    const { default: css } = await import('katex/dist/katex.min.css?inline')
    const faces = css.match(/@font-face\{[^}]*\}/g) ?? []
    const embedded = await Promise.all(
      faces.map(async (face) => {
        const address = /url\(["']?([^)"']+\.woff2)["']?\)/.exec(face)?.[1]
        if (!address) return ''
        const font = await toDataURL(await (await fetch(address)).blob())
        return face.replace(/src:[^}]*/, `src:url(${font}) format("woff2")`)
      })
    )
    return css.replace(/@font-face\{[^}]*\}/g, '') + embedded.join('')
  })()
  katexReady.catch(() => (katexReady = undefined))
  return katexReady
}

/**
 * The page may load nothing, so every image has to be on it. A stored image is read
 * with the reader's own session and written into the page; one that cannot be, or
 * that lives on another host, becomes its alt text.
 */
async function inlineImages(root: Element, workspaceID: string) {
  await Promise.all(
    [...root.querySelectorAll('img')].map(async (image) => {
      const src = image.getAttribute('src') ?? ''
      if (src.startsWith('data:')) return
      try {
        if (!src.startsWith('/') || src.startsWith('//'))
          throw new Error('not a stored image')
        const blob = await (
          await fetch(await assetObjectURL(workspaceID, src))
        ).blob()
        image.setAttribute('src', await toDataURL(blob))
      } catch {
        image.replaceWith(
          document.createTextNode(image.getAttribute('alt') ?? '')
        )
      }
    })
  )
}

/**
 * The page the PDF service prints for a document, as one HTML fragment: its styles
 * and its body. The API adds the document shell and the policy the page runs under.
 */
export async function buildExportHtml(
  markdown: string,
  options: { workspaceID: string }
): Promise<string> {
  // An inert document: reading the page must not make the browser fetch its images.
  const body = new DOMParser().parseFromString(
    `<body>${renderMarkdown(markdown)}</body>`,
    'text/html'
  ).body
  for (const toggle of body.querySelectorAll('details'))
    toggle.setAttribute('open', '')
  // A printed page is white, whatever theme the reader works in.
  await drawDiagrams(body, { dark: false, htmlLabels: false })
  await inlineImages(body, options.workspaceID)
  const formulas = body.querySelector('.katex') ? await katexStyles() : ''
  return `<style>${githubMarkdownCss}${formulas}${printCss}</style><article class="markdown-body">${body.innerHTML}</article>`
}
