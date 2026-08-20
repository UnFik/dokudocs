import { DocType } from '@/types/dokudocs'

const ACRONYMS = new Set([
  'FSD',
  'ERD',
  'DB',
  'DBML',
  'API',
  'UI',
  'UX',
  'SQL',
  'CRUD',
  'REST',
  'GRPC',
  'HTTP',
  'HTTPS',
  'SDK',
  'CLI',
  'ID',
  'UUID',
  'JWT',
  'URL',
  'OAUTH',
  'CI',
  'CD',
  'SSO',
  'PDF',
  'CSV',
  'JSON',
  'XML',
  'YAML',
  'YML',
  'HTML',
  'CSS',
  'JS',
  'TS',
  'MD',
  'MMD',
  'AI',
  'ML',
])

export function parseProperCaseTitle(fileName: string): string {
  const withoutExt = fileName.replace(/\.[^/.]+$/, '')
  const spaced = withoutExt
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[-_.]+/g, ' ')
    .trim()

  if (!spaced) return 'Untitled Document'

  const words = spaced.split(/\s+/)
  const formattedWords = words.map((word) => {
    const upper = word.toUpperCase()
    if (ACRONYMS.has(upper)) {
      if (upper === 'OAUTH') return 'OAuth'
      return upper
    }
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  })

  return formattedWords.join(' ')
}

export function detectDocTypeAndContent(
  fileName: string,
  rawContent: string
): { type: DocType; content: string; detectedReason: string } {
  const extMatch = fileName.match(/\.([a-zA-Z0-9]+)$/)
  const ext = extMatch ? extMatch[1].toLowerCase() : ''
  const trimmed = rawContent.trim()

  if (ext === 'dbml') {
    return {
      type: 'dbdiagram',
      content: trimmed,
      detectedReason: '.dbml extension',
    }
  }

  if (ext === 'mermaid' || ext === 'mmd') {
    return {
      type: 'mermaid',
      content: trimmed,
      detectedReason: `.${ext} extension`,
    }
  }

  const mermaidBlockMatch = trimmed.match(/^```(?:mermaid)\s*([\s\S]*?)\s*```$/i)
  if (mermaidBlockMatch) {
    return {
      type: 'mermaid',
      content: mermaidBlockMatch[1].trim(),
      detectedReason: 'Mermaid code block',
    }
  }

  const dbmlBlockMatch = trimmed.match(
    /^```(?:dbml|dbdiagram)\s*([\s\S]*?)\s*```$/i
  )
  if (dbmlBlockMatch) {
    return {
      type: 'dbdiagram',
      content: dbmlBlockMatch[1].trim(),
      detectedReason: 'DBML code block',
    }
  }

  const hasMarkdownHeadings = /^(?:#{1,6}\s+|[-*]\s+|\d+\.\s+)/m.test(trimmed)

  const isPureMermaid =
    /^\s*(?:graph\s+(?:TD|TB|BT|RL|LR)|flowchart\s+(?:TD|TB|BT|RL|LR)|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|quadrantChart|timeline|C4Context|zenuml|sankey-beta|block-beta|kanban|architecture-beta)\b/i.test(
      trimmed
    )

  const isPureDbml =
    /^\s*(?:Table\s+["']?[a-zA-Z0-9_]+["']?\s*\{|TableGroup\s+|Enum\s+|Project\s+|Ref\s*:)/i.test(
      trimmed
    )

  if (isPureMermaid) {
    return {
      type: 'mermaid',
      content: trimmed,
      detectedReason: 'Mermaid diagram syntax',
    }
  }

  if (isPureDbml) {
    return {
      type: 'dbdiagram',
      content: trimmed,
      detectedReason: 'DBML schema syntax',
    }
  }

  if (!hasMarkdownHeadings) {
    const hasAnyDbmlTable =
      /(?:^|\n)\s*Table\s+["']?[a-zA-Z0-9_]+["']?\s*\{/i.test(trimmed)
    const hasAnyDbmlRef =
      /(?:^|\n)\s*Ref\s*:\s*[a-zA-Z0-9_.]+\s*[><-]\s*[a-zA-Z0-9_.]+/i.test(
        trimmed
      )
    if (hasAnyDbmlTable || hasAnyDbmlRef) {
      return {
        type: 'dbdiagram',
        content: trimmed,
        detectedReason: 'DBML keywords detected',
      }
    }

    const hasAnyMermaid =
      /(?:^|\n)\s*(?:graph\s+(?:TD|TB|BT|RL|LR)|flowchart\s+(?:TD|TB|BT|RL|LR)|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram)\b/i.test(
        trimmed
      )
    if (hasAnyMermaid) {
      return {
        type: 'mermaid',
        content: trimmed,
        detectedReason: 'Mermaid keywords detected',
      }
    }
  }

  return {
    type: 'markdown',
    content: trimmed,
    detectedReason: 'FSD / Markdown content',
  }
}
