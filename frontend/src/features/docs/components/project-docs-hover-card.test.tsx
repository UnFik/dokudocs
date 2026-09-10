import '@/styles/index.css'
import type { DocumentItem, ProjectItem } from '@/types/dokudocs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { ProjectDocsHoverCard } from './project-docs-hover-card'

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    Link: ({
      children,
      to,
      params,
      ...props
    }: {
      children: React.ReactNode
      to: string
      params?: Record<string, string>
      [key: string]: unknown
    }) => {
      let resolvedTo = to
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          resolvedTo = resolvedTo.replace(`$${k}`, v)
        })
      }
      return (
        <a href={resolvedTo} {...props}>
          {children}
        </a>
      )
    },
  }
})

const sampleProject: ProjectItem = {
  id: 'proj-hover-1',
  name: 'Test Project',
  categories: ['Backend'],
  orgId: 'org-1',
  documentIds: ['doc-h1', 'doc-h2', 'doc-h3'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const sampleDocs: DocumentItem[] = [
  {
    id: 'doc-h1',
    title: 'Architecture Overview',
    type: 'markdown',
    content: '# Architecture',
    projectId: 'proj-hover-1',
    projectName: 'Test Project',
    categories: ['Backend'],
    category: 'Backend',
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
  },
  {
    id: 'doc-h2',
    title: 'Entity Relationship Diagram',
    type: 'dbdiagram',
    content: 'Table users {}',
    projectId: 'proj-hover-1',
    projectName: 'Test Project',
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
  },
  {
    id: 'doc-h3',
    title: 'Workflow Flowchart',
    type: 'mermaid',
    content: 'flowchart TD\n  A --> B',
    projectId: 'proj-hover-1',
    projectName: 'Test Project',
    categories: ['Workflow'],
    category: 'Workflow',
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
  },
]

describe('ProjectDocsHoverCard component', () => {
  beforeEach(() => {
    useDokudocsStore.setState({
      projects: [sampleProject],
      documents: sampleDocs,
    })
  })

  it('renders trigger element and reveals project documents on hover', async () => {
    render(
      <ProjectDocsHoverCard projectId='proj-hover-1' currentDocId='doc-h1'>
        <button type='button'>Hover Target Project</button>
      </ProjectDocsHoverCard>
    )

    const trigger = page.getByRole('button', { name: 'Hover Target Project' })
    await expect.element(trigger).toBeInTheDocument()

    // Hover to reveal card
    await userEvent.hover(trigger)

    // Wait for Radix HoverCard open delay (200ms)
    await new Promise((r) => setTimeout(r, 400))

    // Check project header inside hover card
    await expect.element(page.getByText('Test Project')).toBeInTheDocument()
    await expect.element(page.getByText('3 docs')).toBeInTheDocument()

    // Check documents in list
    await expect
      .element(page.getByText('Architecture Overview'))
      .toBeInTheDocument()
    await expect
      .element(page.getByText('Entity Relationship Diagram'))
      .toBeInTheDocument()
    await expect
      .element(page.getByText('Workflow Flowchart'))
      .toBeInTheDocument()

    // Check "Current" badge on doc-h1
    await expect.element(page.getByText('Current')).toBeInTheDocument()
  })

  it('reveals project documents on click as well', async () => {
    render(
      <ProjectDocsHoverCard projectId='proj-hover-1' currentDocId='doc-h1'>
        <button type='button'>Click Target Project</button>
      </ProjectDocsHoverCard>
    )

    const trigger = page.getByRole('button', { name: 'Click Target Project' })
    await userEvent.click(trigger)

    // Check project header inside hover card immediately without hover delay
    await expect.element(page.getByText('Test Project')).toBeInTheDocument()
    await expect.element(page.getByText('3 docs')).toBeInTheDocument()
    await expect
      .element(page.getByText('Architecture Overview'))
      .toBeInTheDocument()
  })

  it('filters project documents with search input', async () => {
    render(
      <ProjectDocsHoverCard projectId='proj-hover-1' currentDocId='doc-h1'>
        <button type='button'>Hover Target Project Search</button>
      </ProjectDocsHoverCard>
    )

    const trigger = page.getByRole('button', {
      name: 'Hover Target Project Search',
    })
    await userEvent.hover(trigger)
    await new Promise((r) => setTimeout(r, 400))

    const searchInput = page.getByPlaceholder('Search in project...')
    await expect.element(searchInput).toBeInTheDocument()

    // Type "Entity" into search input
    await userEvent.fill(searchInput, 'Entity')

    await expect
      .element(page.getByText('Entity Relationship Diagram'))
      .toBeInTheDocument()
    await expect
      .element(page.getByText('Architecture Overview'))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByText('Workflow Flowchart'))
      .not.toBeInTheDocument()
  })

  it('handles max-height and displays scrollbar slider when there are many documents', async () => {
    const manyDocs: DocumentItem[] = Array.from({ length: 12 }, (_, i) => ({
      id: `doc-many-${i}`,
      title: `Doc Number ${i + 1}`,
      type: 'markdown',
      content: 'Content',
      projectId: 'proj-hover-1',
      projectName: 'Test Project',
      categories: ['Backend'],
      category: 'Backend',
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
    }))

    useDokudocsStore.setState({
      projects: [
        {
          ...sampleProject,
          documentIds: manyDocs.map((d) => d.id),
        },
      ],
      documents: manyDocs,
    })

    render(
      <ProjectDocsHoverCard projectId='proj-hover-1' currentDocId='doc-many-0'>
        <button type='button'>Hover Many Docs</button>
      </ProjectDocsHoverCard>
    )

    const trigger = page.getByRole('button', {
      name: 'Hover Many Docs',
    })
    await userEvent.hover(trigger)
    await new Promise((r) => setTimeout(r, 400))

    // Verify 12 docs header
    await expect.element(page.getByText('12 docs')).toBeInTheDocument()

    // Viewport has max-h-64 constraint and scrolls
    const viewport = document.querySelector(
      '[data-slot="scroll-area-viewport"]'
    ) as HTMLElement
    expect(viewport).not.toBeNull()
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight)

    // Scrollbar slider elements are present
    const scrollbar = document.querySelector(
      '[data-slot="scroll-area-scrollbar"]'
    )
    expect(scrollbar).not.toBeNull()

    const scrollThumb = document.querySelector(
      '[data-slot="scroll-area-thumb"]'
    )
    expect(scrollThumb).not.toBeNull()
  })
})
