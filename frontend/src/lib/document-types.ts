import { z } from 'zod'
import { Database, FileCode, FileText, GitFork, Network } from 'lucide-react'

export const DOCUMENT_TYPES = [
  {
    value: 'markdown',
    label: 'Markdown',
    keywords: 'document fsd',
    description: 'Specs and technical docs',
    icon: FileText,
    extensions: ['.md', '.markdown'],
  },
  {
    value: 'dbdiagram',
    label: 'DBML',
    keywords: 'database diagram dbml',
    description: 'Database schemas and relationships',
    icon: Database,
    extensions: ['.dbml'],
  },
  {
    value: 'mermaid',
    label: 'Mermaid',
    keywords: 'flowchart diagram',
    description: 'Flowcharts and sequence diagrams',
    icon: GitFork,
    extensions: ['.mermaid', '.mmd'],
  },
  {
    value: 'architecture',
    label: 'Architecture',
    keywords: 'canvas hosts systems',
    description: 'Hosts, systems and connections',
    icon: Network,
    extensions: ['.json'],
  },
] as const

/**
 * A page written through MCP (ADR 0052). It is a document type like the others
 * but is not in DOCUMENT_TYPES, which feeds every menu that makes a document.
 */
const HTML_DOCUMENT_TYPE = {
  value: 'html',
  label: 'HTML',
  keywords: 'page html',
  description: 'A page written through MCP',
  icon: FileCode,
  extensions: [],
} as const

/** The types a person can make from the app. */
export const creatableDocumentTypeSchema = z.enum(
  DOCUMENT_TYPES.map(({ value }) => value)
)

export type CreatableDocType = z.infer<typeof creatableDocumentTypeSchema>

export const documentTypeSchema = z.enum([
  ...DOCUMENT_TYPES.map(({ value }) => value),
  HTML_DOCUMENT_TYPE.value,
])
export type DocType = z.infer<typeof documentTypeSchema>

export function getDocumentType(type: DocType) {
  return (
    [...DOCUMENT_TYPES, HTML_DOCUMENT_TYPE].find(
      ({ value }) => value === type
    ) ?? DOCUMENT_TYPES[0]
  )
}

export const DOCUMENT_IMPORT_EXTENSIONS = DOCUMENT_TYPES.flatMap(
  ({ extensions }) => [...extensions]
).join(',')
