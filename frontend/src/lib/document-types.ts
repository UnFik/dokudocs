import { z } from 'zod'
import { Database, FileText, GitFork, Network } from 'lucide-react'

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

export const documentTypeSchema = z.enum(
  DOCUMENT_TYPES.map(({ value }) => value)
)
export type DocType = z.infer<typeof documentTypeSchema>

export function getDocumentType(type: DocType) {
  return DOCUMENT_TYPES.find(({ value }) => value === type) ?? DOCUMENT_TYPES[0]
}

export const DOCUMENT_IMPORT_EXTENSIONS = DOCUMENT_TYPES.flatMap(
  ({ extensions }) => [...extensions]
).join(',')
