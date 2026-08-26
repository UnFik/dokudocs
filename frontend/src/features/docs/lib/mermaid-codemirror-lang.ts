import { StreamLanguage, StringStream } from '@codemirror/language'
import { autocompletion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { getMermaidSuggestions } from './mermaid-intellisense'

const MERMAID_DIAGRAM_TYPES = new Set([
  'sequencediagram',
  'flowchart',
  'graph',
  'classdiagram',
  'erdiagram',
  'statediagram',
  'statediagram-v2',
  'journey',
  'gantt',
  'pie',
  'gitgraph',
  'mindmap',
  'quadrantchart',
  'c4diagram',
  'sankey-beta',
  'block-beta',
  'xychart-beta',
  'architecture-beta',
])

const MERMAID_KEYWORDS = new Set([
  'participant',
  'actor',
  'autonumber',
  'note',
  'over',
  'as',
  'loop',
  'end',
  'alt',
  'else',
  'opt',
  'par',
  'and',
  'critical',
  'option',
  'break',
  'rect',
  'activate',
  'deactivate',
  'subgraph',
  'style',
  'classdef',
  'class',
  'linkstyle',
  'click',
  'callback',
  'td',
  'tb',
  'lr',
  'rl',
  'bt',
])

interface MermaidState {
  inString: string | null
}

const mermaidStreamParser = {
  startState: (): MermaidState => ({
    inString: null,
  }),

  token: (stream: StringStream, state: MermaidState): string | null => {
    if (state.inString) {
      const quote = state.inString
      while (!stream.eol()) {
        const ch = stream.next()
        if (ch === '\\') {
          stream.next()
        } else if (ch === quote) {
          state.inString = null
          break
        }
      }
      return 'string'
    }

    if (stream.eatSpace()) {
      return null
    }

    if (stream.match('%%')) {
      stream.skipToEnd()
      return 'comment'
    }

    const ch = stream.peek()
    if (ch === '"' || ch === "'") {
      state.inString = stream.next() || null
      return 'string'
    }

    if (stream.match(/^[0-9]+/)) {
      return 'number'
    }

    if (
      stream.match(/^(-->>|->>|-x|-\)|-->|-\.->|==>|->|---|<-|<--|<==|<-\.)/)
    ) {
      return 'operator'
    }

    if (stream.match(/^[{}()[\]:|;]/)) {
      return 'punctuation'
    }

    if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_-]*/)) {
      const word = stream.current().toLowerCase()

      if (MERMAID_DIAGRAM_TYPES.has(word)) {
        return 'heading'
      }

      if (MERMAID_KEYWORDS.has(word)) {
        return 'keyword'
      }

      return 'variableName'
    }

    stream.next()
    return null
  },
}

export const mermaidLanguage = StreamLanguage.define(mermaidStreamParser)

export function mermaidCompletionSource(context: CompletionContext): CompletionResult | null {
  const text = context.state.doc.toString()
  const pos = context.pos
  const { suggestions, matchPrefix } = getMermaidSuggestions(text, pos)

  if (suggestions.length === 0) return null

  return {
    from: pos - matchPrefix.length,
    options: suggestions.map((s) => ({
      label: s.label,
      type: s.kind === 'keyword' ? 'keyword' : s.kind === 'snippet' ? 'snippet' : 'variable',
      detail: s.detail,
      apply: s.insertText,
    })),
  }
}

export function mermaidExtension() {
  return [
    mermaidLanguage,
    autocompletion({
      override: [mermaidCompletionSource],
    }),
  ]
}
