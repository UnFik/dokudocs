import { StreamLanguage, StringStream } from '@codemirror/language'
import { autocompletion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { getDbmlSuggestions } from './dbml-intellisense'

const DBML_KEYWORDS = new Set([
  'table',
  'tablegroup',
  'enum',
  'ref',
  'project',
  'indexes',
  'note',
  'as',
])

const DBML_ATTRIBUTES = new Set([
  'pk',
  'primary key',
  'unique',
  'not null',
  'null',
  'increment',
  'auto_increment',
  'default',
  'headercolor',
  'color',
  'fill',
  'type',
  'btree',
  'hash',
])

const DBML_TYPES = new Set([
  'int',
  'integer',
  'bigint',
  'smallint',
  'tinyint',
  'serial',
  'bigserial',
  'varchar',
  'char',
  'text',
  'boolean',
  'bool',
  'timestamp',
  'timestamptz',
  'datetime',
  'date',
  'time',
  'json',
  'jsonb',
  'decimal',
  'numeric',
  'float',
  'real',
  'double',
  'uuid',
  'blob',
  'bytea',
])

interface DbmlState {
  inBlockComment: boolean
  inString: string | null
}

const dbmlStreamParser = {
  startState: (): DbmlState => ({
    inBlockComment: false,
    inString: null,
  }),

  token: (stream: StringStream, state: DbmlState): string | null => {
    if (state.inBlockComment) {
      if (stream.match('*/')) {
        state.inBlockComment = false
      } else {
        stream.next()
      }
      return 'comment'
    }

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

    if (stream.match('//')) {
      stream.skipToEnd()
      return 'comment'
    }

    if (stream.match('/*')) {
      state.inBlockComment = true
      return 'comment'
    }

    const ch = stream.peek()
    if (ch === '"' || ch === "'") {
      state.inString = stream.next() || null
      return 'string'
    }

    if (stream.match(/^[0-9]+(\.[0-9]+)?/)) {
      return 'number'
    }

    if (stream.match(/^(>|<|-)/)) {
      return 'operator'
    }

    if (stream.match(/^[{}()[\]:,.]/)) {
      return 'punctuation'
    }

    if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
      const word = stream.current().toLowerCase()

      if (DBML_KEYWORDS.has(word)) {
        return 'keyword'
      }

      if (DBML_ATTRIBUTES.has(word)) {
        return 'attributeName'
      }

      if (DBML_TYPES.has(word)) {
        return 'typeName'
      }

      return 'variableName'
    }

    stream.next()
    return null
  },
}

export const dbmlLanguage = StreamLanguage.define(dbmlStreamParser)

export function dbmlCompletionSource(context: CompletionContext): CompletionResult | null {
  const text = context.state.doc.toString()
  const pos = context.pos
  const { suggestions, replaceStart } = getDbmlSuggestions(text, pos)

  if (suggestions.length === 0) return null

  return {
    from: replaceStart,
    options: suggestions.map((s) => ({
      label: s.label,
      type: s.kind === 'table' ? 'class' : s.kind === 'snippet' ? 'snippet' : 'keyword',
      detail: s.detail,
      apply: s.insertText,
    })),
  }
}

export function dbmlExtension() {
  return [
    dbmlLanguage,
    autocompletion({
      override: [dbmlCompletionSource],
    }),
  ]
}
