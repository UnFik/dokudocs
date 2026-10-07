import DOMPurify from 'dompurify'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { Marked, type TokenizerAndRendererExtension } from 'marked'

const noticeVariants = ['info', 'success', 'warning', 'tip']

function math(source: string, displayMode: boolean) {
  try {
    return katex.renderToString(source, { displayMode, throwOnError: false })
  } catch {
    return source
  }
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

function renderer(): Marked {
  const marked = new Marked({ gfm: true, breaks: true })
  const extensions: TokenizerAndRendererExtension[] = [
    {
      name: 'notice',
      level: 'block',
      start: (src) => src.match(/^:::\w+/m)?.index,
      tokenizer(src) {
        const found = /^:::(\w+)[ \t]*\n([\s\S]*?)\n:::[ \t]*(?:\n|$)/.exec(src)
        if (!found || !noticeVariants.includes(found[1]!)) return undefined
        return {
          type: 'notice',
          raw: found[0],
          variant: found[1]!,
          tokens: this.lexer.blockTokens(found[2]!),
        }
      },
      renderer(token) {
        const variant = String(token.variant)
        return `<div class="dd-notice dd-notice-${variant}" role="note">${this.parser.parse(token.tokens ?? [])}</div>\n`
      },
    },
    {
      name: 'toggle',
      level: 'block',
      start: (src) => src.match(/^\+\+\+[ \t]*$/m)?.index,
      tokenizer(src) {
        const found = /^\+\+\+[ \t]*\n([\s\S]*?)\n\+\+\+[ \t]*(?:\n|$)/.exec(
          src
        )
        if (!found) return undefined
        const [title = '', ...rest] = found[1]!.split('\n')
        return {
          type: 'toggle',
          raw: found[0],
          title: title.replace(/^#{1,6}\s+/, ''),
          tokens: this.lexer.blockTokens(rest.join('\n')),
        }
      },
      renderer(token) {
        return `<details class="dd-toggle"><summary>${escape(String(token.title))}</summary>${this.parser.parse(token.tokens ?? [])}</details>\n`
      },
    },
    {
      name: 'mathBlock',
      level: 'block',
      start: (src) => src.match(/^\$\$/m)?.index,
      tokenizer(src) {
        const found = /^\$\$[ \t]*\n([\s\S]*?)\n\$\$[ \t]*(?:\n|$)/.exec(src)
        if (!found) return undefined
        return { type: 'mathBlock', raw: found[0], text: found[1]! }
      },
      renderer: (token) =>
        `<div class="dd-math-block">${math(String(token.text), true)}</div>\n`,
    },
    {
      name: 'mathInline',
      level: 'inline',
      start: (src) => src.indexOf('$'),
      tokenizer(src) {
        const found = /^\$([^$\n]+?)\$(?!\d)/.exec(src)
        if (!found) return undefined
        return { type: 'mathInline', raw: found[0], text: found[1]! }
      },
      renderer: (token) => math(String(token.text), false),
    },
  ]
  marked.use({
    extensions,
    renderer: {
      code({ text, lang }) {
        if (lang === 'mermaid')
          return `<div class="dd-diagram" data-mermaid-source="${encodeURIComponent(text)}"></div>\n`
        return false
      },
    },
  })
  return marked
}

const marked = renderer()

/** Markdown as safe HTML, with notices, toggles, math and diagram placeholders. */
export function renderMarkdown(markdown: string): string {
  return DOMPurify.sanitize(marked.parse(markdown) as string, {
    USE_PROFILES: { html: true, svg: true, mathMl: true },
    ADD_ATTR: ['data-mermaid-source'],
  })
}

let sequence = 0

/** Draws the diagrams a rendered page asks for; call it after the HTML is in the page. */
export async function drawDiagrams(root: HTMLElement) {
  const blocks = [
    ...root.querySelectorAll<HTMLElement>('[data-mermaid-source]'),
  ]
  if (!blocks.length) return
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'default',
  })
  for (const block of blocks) {
    try {
      const { svg } = await mermaid.render(
        `dd-preview-diagram-${++sequence}`,
        decodeURIComponent(block.dataset.mermaidSource ?? '')
      )
      block.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true } })
    } catch {
      document.getElementById(`dd-preview-diagram-${sequence}`)?.remove()
      block.textContent = decodeURIComponent(block.dataset.mermaidSource ?? '')
    }
  }
}
