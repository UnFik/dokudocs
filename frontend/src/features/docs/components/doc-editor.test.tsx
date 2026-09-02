import type { DocumentItem, ProjectItem } from '@/types/dokudocs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { DocEditor } from './doc-editor'

let currentDocId = 'doc-1'

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useParams: () => ({ docId: currentDocId }),
    Link: ({
      children,
      to,
      ...props
    }: {
      children: React.ReactNode
      to: string
      [key: string]: unknown
    }) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  }
})

const sampleMarkdownDoc: DocumentItem = {
  id: 'doc-1',
  title: 'My Project Architecture',
  type: 'markdown',
  content: '# System Overview\nDetailed documentation',
  projectId: 'proj-1',
  projectName: 'Core Platform',
  categories: ['Architecture'],
  category: 'Architecture',
  orgId: 'org-1',
  author: {
    id: 'usr-1',
    name: 'Fikri',
    email: 'fikri@dokudocs.app',
    avatar: '/avatars/01.png',
  },
  isDraft: false,
  isStarred: false,
  isShared: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const sampleDbmlDoc: DocumentItem = {
  id: 'doc-2',
  title: 'Database Schema',
  type: 'dbdiagram',
  content: 'Table users {\n  id int [pk]\n  email varchar\n}',
  projectId: 'proj-1',
  projectName: 'Core Platform',
  categories: ['Database'],
  category: 'Database',
  orgId: 'org-1',
  author: {
    id: 'usr-1',
    name: 'Fikri',
    email: 'fikri@dokudocs.app',
    avatar: '/avatars/01.png',
  },
  isDraft: false,
  isStarred: false,
  isShared: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const sampleMermaidDoc: DocumentItem = {
  id: 'doc-3',
  title: 'Flow Diagram',
  type: 'mermaid',
  content: 'flowchart TD\n  A --> B',
  projectId: 'proj-1',
  projectName: 'Core Platform',
  categories: ['Diagram'],
  category: 'Diagram',
  orgId: 'org-1',
  author: {
    id: 'usr-1',
    name: 'Fikri',
    email: 'fikri@dokudocs.app',
    avatar: '/avatars/01.png',
  },
  isDraft: false,
  isStarred: false,
  isShared: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const sampleProject: ProjectItem = {
  id: 'proj-1',
  name: 'Core Platform',
  categories: [],
  orgId: 'org-1',
  documentIds: ['doc-1', 'doc-2', 'doc-3'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

describe('DocEditor component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDokudocsStore.setState({
      documents: [sampleMarkdownDoc, sampleDbmlDoc, sampleMermaidDoc],
      projects: [{ ...sampleProject }],
    })
  })

  it('renders not found state if document is absent', async () => {
    currentDocId = 'non-existent'
    const screen = await render(<DocEditor />)

    await expect
      .element(screen.getByText('Document Not Found'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('Back to Dashboard'))
      .toBeInTheDocument()
  })

  it('renders markdown document and header controls', async () => {
    currentDocId = 'doc-1'
    const screen = await render(<DocEditor />)

    await expect
      .element(screen.getByRole('heading', { name: 'My Project Architecture' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: /^Editor$/i }))
      .toBeInTheDocument()
  })

  it('renders dbdiagram document type', async () => {
    currentDocId = 'doc-2'
    const screen = await render(<DocEditor />)

    await expect
      .element(screen.getByRole('heading', { name: 'Database Schema' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByTitle('Beautify schema code'))
      .toBeInTheDocument()
  })

  it('renders mermaid document type with templates button', async () => {
    currentDocId = 'doc-3'
    const screen = await render(<DocEditor />)

    await expect
      .element(screen.getByRole('heading', { name: 'Flow Diagram' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByTitle('Insert Mermaid Template'))
      .toBeInTheDocument()
  })

  it('handles copying raw document code to clipboard', async () => {
    currentDocId = 'doc-1'
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    const screen = await render(<DocEditor />)

    const exportBtn = screen.getByRole('button', { name: /^Export$/i })
    await userEvent.click(exportBtn)

    const copyRawItem = page.getByText('Copy Raw Code')
    await userEvent.click(copyRawItem)

    expect(writeTextSpy).toHaveBeenCalledWith(sampleMarkdownDoc.content)
  })

  it('opens mermaid export dialog directly when clicking Export in mermaid document', async () => {
    currentDocId = 'doc-3'
    const screen = await render(<DocEditor />)

    const exportBtn = screen.getByRole('button', { name: /^Export$/i })
    await userEvent.click(exportBtn)

    await expect
      .element(page.getByText('Export Mermaid Diagram'))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: /^PNG$/i }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: /^SVG$/i }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: /^PDF$/i }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: /^MMD$/i }))
      .toBeInTheDocument()
  })
})

