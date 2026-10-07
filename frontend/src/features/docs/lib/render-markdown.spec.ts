import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './render-markdown'

function html(markdown: string) {
  const host = document.createElement('div')
  host.innerHTML = renderMarkdown(markdown)
  return host
}

describe('renderMarkdown', () => {
  it('shows :::variant as a notice and +++ as a foldable toggle', () => {
    const host = html(
      ':::tip\nRemember **this**\n:::\n\n+++\nTitle line\nHidden body\n+++'
    )
    const notice = host.querySelector('.dd-notice.dd-notice-tip')!
    expect(notice.textContent).toContain('Remember')
    expect(notice.querySelector('strong')?.textContent).toBe('this')
    const toggle = host.querySelector('details')!
    expect(toggle.querySelector('summary')?.textContent).toBe('Title line')
    expect(toggle.textContent).toContain('Hidden body')
  })

  it('renders inline and block math with KaTeX', () => {
    const host = html('Inline $E = mc^2$ here\n\n$$\n\\int_0^1 x\\,dx\n$$')
    expect(host.querySelectorAll('.katex').length).toBe(2)
    expect(host.querySelector('.katex-display')).not.toBeNull()
    expect(host.textContent).not.toContain('$E')
  })

  it('leaves a mermaid fence for the diagram renderer', () => {
    const host = html('```mermaid\ngraph LR\n  A --> B\n```')
    const block = host.querySelector('[data-mermaid-source]')!
    expect(
      decodeURIComponent(block.getAttribute('data-mermaid-source')!)
    ).toContain('A --> B')
  })

  it('keeps ordinary code and markers inside code untouched', () => {
    const host = html('```js\n:::tip\n$x$\n```')
    expect(host.querySelector('pre code')?.textContent).toContain(':::tip')
    expect(host.querySelector('.dd-notice, .katex')).toBeNull()
  })

  it('drops scripts and event handlers', () => {
    const host = html(
      '<img src=x onerror="alert(1)"><script>alert(1)</script>hi'
    )
    expect(host.querySelector('script')).toBeNull()
    expect(host.innerHTML).not.toContain('onerror')
  })
})
