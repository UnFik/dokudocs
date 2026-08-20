export interface DbmlSuggestion {
  label: string
  insertText: string
  kind: 'keyword' | 'type' | 'attribute' | 'snippet' | 'table' | 'column'
  detail: string
  documentation?: string
}

export interface DbmlColumnInfo {
  name: string
  type: string
  attributes?: string
}

export interface DbmlTableInfo {
  name: string
  columns: DbmlColumnInfo[]
}

export const DBML_KEYWORDS: DbmlSuggestion[] = [
  {
    label: 'Table',
    insertText: 'Table ${1:table_name} {\n  id int [pk, increment]\n  created_at timestamp [default: `now()`]\n}',
    kind: 'snippet',
    detail: 'Table definition',
    documentation: 'Define a new database table with fields and attributes.',
  },
  {
    label: 'Enum',
    insertText: 'Enum ${1:status_type} {\n  active\n  inactive\n  pending\n}',
    kind: 'snippet',
    detail: 'Enum definition',
    documentation: 'Define a set of named scalar constants.',
  },
  {
    label: 'TableGroup',
    insertText: 'TableGroup ${1:group_name} {\n  ${2:table_name}\n}',
    kind: 'snippet',
    detail: 'Table group',
    documentation: 'Group related tables together visually in the schema canvas.',
  },
  {
    label: 'Ref',
    insertText: 'Ref: ${1:table1}.${2:col1} > ${3:table2}.${4:col2}',
    kind: 'snippet',
    detail: 'Foreign key relation',
    documentation: 'Define a relationship between two tables (> many-to-one, < one-to-many, - one-to-one).',
  },
  {
    label: 'Project',
    insertText: "Project ${1:project_name} {\n  database_type: 'PostgreSQL'\n  Note: 'Project documentation'\n}",
    kind: 'snippet',
    detail: 'Project metadata',
    documentation: 'Define global project metadata and database target.',
  },
  {
    label: 'indexes',
    insertText: 'indexes {\n  ${1:column_name} [name: "${2:idx_name}"]\n}',
    kind: 'snippet',
    detail: 'Table indexes',
    documentation: 'Define composite or unique indexes for a table.',
  },
  {
    label: 'Note',
    insertText: "Note: '${1:Description}'",
    kind: 'keyword',
    detail: 'Table/Project note',
    documentation: 'Add descriptive notes to a table or project.',
  },
]

export const DBML_DATA_TYPES: DbmlSuggestion[] = [
  {
    label: 'int',
    insertText: 'int',
    kind: 'type',
    detail: 'Integer (32-bit)',
    documentation: 'Standard 4-byte signed integer (-2,147,483,648 to 2,147,483,647).',
  },
  {
    label: 'bigint',
    insertText: 'bigint',
    kind: 'type',
    detail: 'Large integer (64-bit)',
    documentation: '8-byte signed integer for large IDs and counters.',
  },
  {
    label: 'smallint',
    insertText: 'smallint',
    kind: 'type',
    detail: 'Small integer (16-bit)',
    documentation: '2-byte signed integer (-32,768 to 32,767).',
  },
  {
    label: 'varchar(255)',
    insertText: 'varchar(255)',
    kind: 'type',
    detail: 'Variable string',
    documentation: 'Variable-length character string with maximum length constraint.',
  },
  {
    label: 'text',
    insertText: 'text',
    kind: 'type',
    detail: 'Unlimited text',
    documentation: 'Unlimited length UTF-8 string for articles and descriptions.',
  },
  {
    label: 'boolean',
    insertText: 'boolean',
    kind: 'type',
    detail: 'Boolean flag',
    documentation: 'Logical true/false boolean data type.',
  },
  {
    label: 'timestamp',
    insertText: 'timestamp',
    kind: 'type',
    detail: 'Timestamp (date + time)',
    documentation: 'Date and time with optional timezone precision.',
  },
  {
    label: 'datetime',
    insertText: 'datetime',
    kind: 'type',
    detail: 'Date & time value',
    documentation: 'Standard ISO datetime value representation.',
  },
  {
    label: 'date',
    insertText: 'date',
    kind: 'type',
    detail: 'Calendar date',
    documentation: 'Year, month, day calendar date representation.',
  },
  {
    label: 'time',
    insertText: 'time',
    kind: 'type',
    detail: 'Time of day',
    documentation: 'Time representation without date offset.',
  },
  {
    label: 'json',
    insertText: 'json',
    kind: 'type',
    detail: 'JSON document',
    documentation: 'Structured textual JSON data format.',
  },
  {
    label: 'jsonb',
    insertText: 'jsonb',
    kind: 'type',
    detail: 'Binary JSON (indexed)',
    documentation: 'Decomposed binary JSON format with indexing support.',
  },
  {
    label: 'uuid',
    insertText: 'uuid',
    kind: 'type',
    detail: 'Universally Unique ID',
    documentation: '128-bit RFC 4122 universally unique identifier.',
  },
  {
    label: 'decimal(10,2)',
    insertText: 'decimal(10,2)',
    kind: 'type',
    detail: 'Exact fixed-point decimal',
    documentation: 'Exact numerical precision for currency and financials.',
  },
  {
    label: 'float',
    insertText: 'float',
    kind: 'type',
    detail: 'Floating point',
    documentation: 'Single precision floating-point number.',
  },
  {
    label: 'double',
    insertText: 'double',
    kind: 'type',
    detail: 'Double precision float',
    documentation: 'Double precision 64-bit IEEE floating-point number.',
  },
  {
    label: 'bytea',
    insertText: 'bytea',
    kind: 'type',
    detail: 'Binary raw data',
    documentation: 'Variable-length binary data blob.',
  },
  {
    label: 'serial',
    insertText: 'serial',
    kind: 'type',
    detail: 'Auto-incrementing integer',
    documentation: 'Sequential integer with auto-generating sequence.',
  },
]

export const DBML_ATTRIBUTES: DbmlSuggestion[] = [
  {
    label: '[pk]',
    insertText: '[pk]',
    kind: 'attribute',
    detail: 'Primary key constraint',
    documentation: 'Designates this column as the unique primary key identifier.',
  },
  {
    label: '[pk, increment]',
    insertText: '[pk, increment]',
    kind: 'attribute',
    detail: 'Auto-incrementing primary key',
    documentation: 'Auto-incrementing primary key sequence ID.',
  },
  {
    label: '[not null]',
    insertText: '[not null]',
    kind: 'attribute',
    detail: 'Not null constraint',
    documentation: 'Ensures that column cannot store NULL values.',
  },
  {
    label: '[null]',
    insertText: '[null]',
    kind: 'attribute',
    detail: 'Nullable field',
    documentation: 'Explicitly permits NULL values in column.',
  },
  {
    label: '[unique]',
    insertText: '[unique]',
    kind: 'attribute',
    detail: 'Unique constraint',
    documentation: 'Ensures all non-null values across this column remain unique.',
  },
  {
    label: '[increment]',
    insertText: '[increment]',
    kind: 'attribute',
    detail: 'Auto-increment',
    documentation: 'Increments column value automatically on row insert.',
  },
  {
    label: '[default: `now()`]',
    insertText: '[default: `now()`]',
    kind: 'attribute',
    detail: 'Current timestamp default',
    documentation: 'Automatically populates column with the current timestamp.',
  },
  {
    label: "[default: 'active']",
    insertText: "[default: '${1:active}']",
    kind: 'attribute',
    detail: 'Default string value',
    documentation: 'Fallback value if not provided during record insertion.',
  },
  {
    label: "[note: 'description']",
    insertText: "[note: '${1:description}']",
    kind: 'attribute',
    detail: 'Column note',
    documentation: 'Documentation note attached to this field.',
  },
  {
    label: '[ref: > table.id]',
    insertText: '[ref: > ${1:table}.${2:id}]',
    kind: 'attribute',
    detail: 'Foreign key reference',
    documentation: 'Reference relationship to another table column.',
  },
  {
    label: '[headercolor: #d35400]',
    insertText: '[headercolor: #${1:d35400}]',
    kind: 'attribute',
    detail: 'Table header color',
    documentation: 'Customize table card header background color.',
  },
  {
    label: '[color: #3498db]',
    insertText: '[color: #${1:3498db}]',
    kind: 'attribute',
    detail: 'Group/Table color',
    documentation: 'Customize visual theme color for table or table group.',
  },
]

function stripDbmlComments(rawContent: string): string {
  const withoutBlock = rawContent.replace(/\/\*[\s\S]*?\*\//g, '')
  return withoutBlock
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//')
      if (idx !== -1) {
        return line.substring(0, idx)
      }
      return line
    })
    .join('\n')
}

export function parseDbmlTables(content: string): DbmlTableInfo[] {
  const cleanContent = stripDbmlComments(content)
  const tables: DbmlTableInfo[] = []
  const tableRegex = /Table\s+(\w+)\s*\{([^}]+)\}/gi

  let match: RegExpExecArray | null
  while ((match = tableRegex.exec(cleanContent)) !== null) {
    const tableName = match[1]
    const body = match[2]
    const lines = body.split('\n')
    const columns: DbmlColumnInfo[] = []

    lines.forEach((line) => {
      const trimmed = line.trim()
      if (
        !trimmed ||
        trimmed.startsWith('indexes') ||
        trimmed.startsWith('Note:')
      )
        return

      const colMatch = trimmed.match(/^(\w+)\s+([\w()]+)(.*)$/)
      if (colMatch) {
        columns.push({
          name: colMatch[1],
          type: colMatch[2],
          attributes: colMatch[3]?.trim(),
        })
      }
    })

    tables.push({ name: tableName, columns })
  }

  return tables
}

export function getDbmlSuggestions(
  content: string,
  cursorPosition: number
): { suggestions: DbmlSuggestion[]; prefix: string; replaceStart: number } {
  const textBeforeCursor = content.substring(0, cursorPosition)
  const currentLine = textBeforeCursor.split('\n').pop() || ''
  const trimmedLine = currentLine.trimStart()

  const tables = parseDbmlTables(content)

  const dotMatch = textBeforeCursor.match(/([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]*)$/)
  if (dotMatch) {
    const targetTableName = dotMatch[1]
    const colPrefix = dotMatch[2] || ''
    const replaceStart = cursorPosition - colPrefix.length

    const matchedTable = tables.find(
      (t) => t.name.toLowerCase() === targetTableName.toLowerCase()
    )

    if (matchedTable) {
      const colSuggestions: DbmlSuggestion[] = matchedTable.columns
        .filter((col) =>
          col.name.toLowerCase().startsWith(colPrefix.toLowerCase())
        )
        .map((col) => ({
          label: col.name,
          insertText: col.name,
          kind: 'column',
          detail: `${matchedTable.name}.${col.name} (${col.type})`,
          documentation: `Column on table ${matchedTable.name} of type ${col.type}.`,
        }))

      return {
        suggestions: colSuggestions,
        prefix: colPrefix,
        replaceStart,
      }
    }
  }

  const tableSuggestions: DbmlSuggestion[] = tables.map((t) => ({
    label: t.name,
    insertText: t.name,
    kind: 'table',
    detail: `Table (${t.columns.length} columns)`,
    documentation: `Reference to schema table ${t.name}.`,
  }))

  const lastWordMatch = currentLine.match(/[\w()]+$/)
  const prefix = lastWordMatch ? lastWordMatch[0] : ''
  const replaceStart = cursorPosition - prefix.length

  const allAvailable = [
    ...DBML_KEYWORDS,
    ...DBML_DATA_TYPES,
    ...DBML_ATTRIBUTES,
    ...tableSuggestions,
  ]

  if (!prefix) {
    if (trimmedLine.startsWith('Table ') || trimmedLine.includes('{')) {
      return {
        suggestions: [...DBML_DATA_TYPES, ...DBML_ATTRIBUTES],
        prefix: '',
        replaceStart: cursorPosition,
      }
    }
    if (trimmedLine.startsWith('Ref:') || trimmedLine.startsWith('Ref ')) {
      return {
        suggestions: tableSuggestions,
        prefix: '',
        replaceStart: cursorPosition,
      }
    }
    return {
      suggestions: allAvailable.slice(0, 12),
      prefix: '',
      replaceStart: cursorPosition,
    }
  }

  const filtered = allAvailable.filter((item) =>
    item.label.toLowerCase().includes(prefix.toLowerCase())
  )

  return {
    suggestions: filtered,
    prefix,
    replaceStart,
  }
}
