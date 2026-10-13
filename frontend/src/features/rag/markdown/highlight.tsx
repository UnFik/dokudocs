import type { ReactNode } from 'react'
import type { Token, TokenStream } from 'prismjs'

/**
 * Each language and what it needs loaded first. Chunks load on demand, the
 * first time a block names the language; a name not listed stays plain.
 */
const loaders: Record<string, (() => Promise<unknown>)[]> = {
  markup: [() => import('prismjs/components/prism-markup')],
  css: [() => import('prismjs/components/prism-css')],
  clike: [() => import('prismjs/components/prism-clike')],
  javascript: [
    () => import('prismjs/components/prism-clike'),
    () => import('prismjs/components/prism-javascript'),
  ],
  typescript: [
    () => import('prismjs/components/prism-clike'),
    () => import('prismjs/components/prism-javascript'),
    () => import('prismjs/components/prism-typescript'),
  ],
  jsx: [
    () => import('prismjs/components/prism-markup'),
    () => import('prismjs/components/prism-clike'),
    () => import('prismjs/components/prism-javascript'),
    () => import('prismjs/components/prism-jsx'),
  ],
  tsx: [
    () => import('prismjs/components/prism-markup'),
    () => import('prismjs/components/prism-clike'),
    () => import('prismjs/components/prism-javascript'),
    () => import('prismjs/components/prism-jsx'),
    () => import('prismjs/components/prism-typescript'),
    () => import('prismjs/components/prism-tsx'),
  ],
  json: [() => import('prismjs/components/prism-json')],
  bash: [() => import('prismjs/components/prism-bash')],
  yaml: [() => import('prismjs/components/prism-yaml')],
  sql: [() => import('prismjs/components/prism-sql')],
  python: [() => import('prismjs/components/prism-python')],
  go: [
    () => import('prismjs/components/prism-clike'),
    () => import('prismjs/components/prism-go'),
  ],
  diff: [() => import('prismjs/components/prism-diff')],
  docker: [() => import('prismjs/components/prism-docker')],
  markdown: [
    () => import('prismjs/components/prism-markup'),
    () => import('prismjs/components/prism-markdown'),
  ],
}

const aliases: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  yml: 'yaml',
  py: 'python',
  golang: 'go',
  html: 'markup',
  xml: 'markup',
  svg: 'markup',
  md: 'markdown',
  dockerfile: 'docker',
  patch: 'diff',
}

/** The language a fence names, as one this module can colour; undefined when it cannot. */
export function languageOf(fence: string | undefined): string | undefined {
  const name = fence?.trim().toLowerCase()
  if (!name) return undefined
  const canonical = aliases[name] ?? name
  return canonical in loaders ? canonical : undefined
}

/** Splits code into coloured runs; undefined when the language is unknown or fails to load. */
export async function highlight(
  code: string,
  language: string
): Promise<ReactNode | undefined> {
  const steps = loaders[language]
  if (!steps) return undefined
  try {
    const { default: Prism } = await import('prismjs')
    // Language files attach themselves to the global Prism.
    ;(globalThis as { Prism?: unknown }).Prism = Prism
    for (const load of steps) await load()
    const grammar = Prism.languages[language]
    if (!grammar) return undefined
    return renderStream(Prism.tokenize(code, grammar))
  } catch {
    return undefined
  }
}

function renderStream(stream: TokenStream): ReactNode {
  if (typeof stream === 'string') return stream
  if (Array.isArray(stream))
    return stream.map((part, index) => (
      <span key={index} className='contents'>
        {renderStream(part)}
      </span>
    ))
  return renderToken(stream)
}

function renderToken(token: Token): ReactNode {
  const kinds = [token.type, ...[token.alias ?? []].flat()]
  return (
    <span className={`token ${kinds.join(' ')}`}>
      {renderStream(token.content)}
    </span>
  )
}
