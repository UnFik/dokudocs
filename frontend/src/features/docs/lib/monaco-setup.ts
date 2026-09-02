import * as monaco from 'monaco-editor'
import EditorWorker from './workers/editor.worker?worker'
import JsonWorker from './workers/json.worker?worker'

let isInitialized = false

export function setupMonaco(): typeof monaco {
  if (typeof window === 'undefined') {
    return monaco
  }

  if (isInitialized) {
    return monaco
  }

  self.MonacoEnvironment = {
    getWorker(_, label) {
      if (label === 'json') {
        return new JsonWorker()
      }
      return new EditorWorker()
    },
  }

  if (!monaco.languages.getLanguages().some((lang) => lang.id === 'dbml')) {
    monaco.languages.register({ id: 'dbml' })
    monaco.languages.setMonarchTokensProvider('dbml', {
      keywords: [
        'Table',
        'TableGroup',
        'Enum',
        'Project',
        'Ref',
        'Records',
        'Record',
        'indexes',
        'as',
        'pk',
        'primary key',
        'null',
        'not null',
        'unique',
        'default',
        'increment',
        'note',
        'headercolor',
      ],
      typeKeywords: [
        'int',
        'integer',
        'bigint',
        'smallint',
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
        'decimal',
        'numeric',
        'float',
        'double',
        'real',
        'json',
        'jsonb',
        'uuid',
        'blob',
      ],
      operators: [
        '>',
        '<',
        '-',
        ':',
        '?>',
        '<?',
        '<>',
        '?-',
        '-?',
        '?-?',
        '>?',
        '?<',
      ],
      tokenizer: {
        root: [
          [/\/\/.*$/, 'comment'],
          [/\/\*/, 'comment', '@comment'],
          [
            /[a-zA-Z_]\w*/,
            {
              cases: {
                '@keywords': 'keyword',
                '@typeKeywords': 'type',
                '@default': 'identifier',
              },
            },
          ],
          [/[{}()\[\]]/, '@brackets'],
          [/[-><:?]+/, 'operator'],
          [/\d+/, 'number'],
          [/"([^"\\]|\\.)*"/, 'string'],
          [/'([^'\\]|\\.)*'/, 'string'],
          [/`([^`\\]|\\.)*`/, 'string'],
        ],
        comment: [
          [/[^\/*]+/, 'comment'],
          [/\*\//, 'comment', '@pop'],
          [/[\/*]/, 'comment'],
        ],
      },
    })
    monaco.languages.setLanguageConfiguration('dbml', {
      comments: {
        lineComment: '//',
        blockComment: ['/*', '*/'],
      },
      brackets: [
        ['{', '}'],
        ['[', ']'],
        ['(', ')'],
      ],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
        { open: '`', close: '`' },
      ],
      surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
        { open: '`', close: '`' },
      ],
    })
  }

  if (!monaco.languages.getLanguages().some((lang) => lang.id === 'mermaid')) {
    monaco.languages.register({ id: 'mermaid' })
    monaco.languages.setMonarchTokensProvider('mermaid', {
      keywords: [
        'flowchart',
        'graph',
        'sequenceDiagram',
        'classDiagram',
        'stateDiagram',
        'stateDiagram-v2',
        'erDiagram',
        'gantt',
        'pie',
        'gitGraph',
        'journey',
        'mindmap',
        'timeline',
        'quadrantChart',
        'sankey-beta',
        'xychart-beta',
        'block-beta',
        'packet-beta',
        'kanban',
        'architecture-beta',
        'subgraph',
        'end',
        'participant',
        'actor',
        'autonumber',
        'activate',
        'deactivate',
        'Note',
        'over',
        'loop',
        'alt',
        'else',
        'opt',
        'par',
        'and',
        'critical',
        'option',
        'break',
        'rect',
        'title',
        'section',
        'commit',
        'branch',
        'checkout',
        'merge',
      ],
      tokenizer: {
        root: [
          [/%%.*$/, 'comment'],
          [
            /[a-zA-Z_]\w*/,
            {
              cases: {
                '@keywords': 'keyword',
                '@default': 'identifier',
              },
            },
          ],
          [/-->|-\.->|==>|->>|-->>|->|--/, 'operator'],
          [/[{}()\[\]]/, '@brackets'],
          [/\d+/, 'number'],
          [/"([^"\\]|\\.)*"/, 'string'],
          [/'([^'\\]|\\.)*'/, 'string'],
        ],
      },
    })
    monaco.languages.setLanguageConfiguration('mermaid', {
      comments: {
        lineComment: '%%',
      },
      brackets: [
        ['{', '}'],
        ['[', ']'],
        ['(', ')'],
      ],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
        { open: '`', close: '`' },
      ],
      surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
        { open: '`', close: '`' },
      ],
    })
  }

  monaco.languages.setLanguageConfiguration('markdown', {
    comments: {
      blockComment: ['<!--', '-->'],
    },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
      ['<', '>'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '<', close: '>' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '`', close: '`' },
      { open: '*', close: '*' },
      { open: '_', close: '_' },
      { open: '~', close: '~' },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '<', close: '>' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '`', close: '`' },
      { open: '*', close: '*' },
      { open: '_', close: '_' },
      { open: '~', close: '~' },
      { open: '**', close: '**' },
    ],
  })

  monaco.editor.defineTheme('dokudocs-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '71717a', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'c084fc', fontStyle: 'bold' },
      { token: 'type', foreground: '38bdf8' },
      { token: 'identifier', foreground: 'f4f4f5' },
      { token: 'string', foreground: '34d399' },
      { token: 'number', foreground: 'fbbf24' },
      { token: 'operator', foreground: 'f472b6' },
    ],
    colors: {
      'editor.background': '#09090b',
      'editor.foreground': '#f4f4f5',
      'editor.lineHighlightBackground': '#18181b',
      'editorLineNumber.foreground': '#52525b',
      'editorLineNumber.activeForeground': '#a1a1aa',
      'editorGutter.background': '#09090b',
      'editor.selectionBackground': '#3f3f4680',
      'editor.inactiveSelectionBackground': '#27272a80',
    },
  })

  monaco.editor.defineTheme('dokudocs-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: 'a1a1aa', fontStyle: 'italic' },
      { token: 'keyword', foreground: '9333ea', fontStyle: 'bold' },
      { token: 'type', foreground: '0284c7' },
      { token: 'identifier', foreground: '09090b' },
      { token: 'string', foreground: '059669' },
      { token: 'number', foreground: 'd97706' },
      { token: 'operator', foreground: 'db2777' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#09090b',
      'editor.lineHighlightBackground': '#f4f4f5',
      'editorLineNumber.foreground': '#a1a1aa',
      'editorLineNumber.activeForeground': '#18181b',
      'editorGutter.background': '#ffffff',
      'editor.selectionBackground': '#e4e4e7',
      'editor.inactiveSelectionBackground': '#f4f4f5',
    },
  })

  isInitialized = true
  return monaco
}
