import { act } from 'react'
import type { DocumentItem, ProjectItem } from '@/types/dokudocs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { useDocEditor } from './use-doc-editor'

const mockDoc: DocumentItem = {
  id: 'doc-test-1',
  title: 'Test Architecture',
  type: 'markdown',
  content: '# Heading 1\nInitial content',
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

const mockDoc2: DocumentItem = {
  id: 'doc-test-2',
  title: 'Second Document',
  type: 'dbdiagram',
  content: 'Table users {\n  id int\n}',
  projectId: null,
  projectName: null,
  categories: ['Database'],
  category: 'Database',
  orgId: 'org-1',
  author: {
    id: 'usr-1',
    name: 'Fikri',
    email: 'fikri@dokudocs.app',
    avatar: '/avatars/01.png',
  },
  isDraft: true,
  isStarred: false,
  isShared: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const mockProject: ProjectItem = {
  id: 'proj-1',
  name: 'Core Platform',
  categories: [],
  orgId: 'org-1',
  documentIds: ['doc-test-1'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

describe('useDocEditor hook', () => {
  beforeEach(() => {
    useDokudocsStore.setState({
      documents: [{ ...mockDoc }, { ...mockDoc2 }],
      projects: [{ ...mockProject }],
    })
  })

  it('loads document data correctly when found', async () => {
    const { result } = await renderHook(() => useDocEditor('doc-test-1'))

    expect(result.current.document).toBeDefined()
    expect(result.current.title).toBe('Test Architecture')
    expect(result.current.content).toBe('# Heading 1\nInitial content')
    expect(result.current.projectId).toBe('proj-1')
    expect(result.current.categories).toEqual(['Architecture'])
    expect(result.current.isDirty).toBe(false)
  })

  it('returns undefined document if docId is not in store', async () => {
    const { result } = await renderHook(() => useDocEditor('non-existent'))

    expect(result.current.document).toBeUndefined()
    expect(result.current.title).toBe('')
    expect(result.current.content).toBe('')
  })

  it('updates title and triggers auto-save with debounce', async () => {
    const { result } = await renderHook(() => useDocEditor('doc-test-1'))

    act(() => {
      result.current.setTitle('Updated Architecture Title')
    })

    expect(result.current.title).toBe('Updated Architecture Title')
    expect(result.current.isDirty).toBe(true)

    await vi.waitFor(
      () => {
        const docAfterDebounce = useDokudocsStore
          .getState()
          .documents.find((d) => d.id === 'doc-test-1')
        expect(docAfterDebounce?.title).toBe('Updated Architecture Title')
        expect(result.current.isDirty).toBe(false)
      },
      { timeout: 2500 }
    )
  })

  it('updates content and persists change after debounce', async () => {
    const { result } = await renderHook(() => useDocEditor('doc-test-1'))

    act(() => {
      result.current.setContent('# New Header\nBrand new typed text')
    })

    expect(result.current.content).toBe('# New Header\nBrand new typed text')
    expect(result.current.isDirty).toBe(true)
    expect(result.current.isSaving).toBe(false)

    await vi.waitFor(
      () => {
        const updatedDoc = useDokudocsStore
          .getState()
          .documents.find((d) => d.id === 'doc-test-1')
        expect(updatedDoc?.content).toBe('# New Header\nBrand new typed text')
        expect(result.current.isDirty).toBe(false)
        expect(result.current.isSaving).toBe(false)
      },
      { timeout: 2500 }
    )
  })

  it('updates category and project associations', async () => {
    const { result } = await renderHook(() => useDocEditor('doc-test-1'))

    act(() => {
      result.current.setCategory('Design')
    })

    expect(result.current.categories).toEqual(['Design'])

    await vi.waitFor(
      () => {
        const docAfter = useDokudocsStore
          .getState()
          .documents.find((d) => d.id === 'doc-test-1')
        expect(docAfter?.categories).toEqual(['Design'])
      },
      { timeout: 2500 }
    )
  })

  it('flushes pending changes on unmount when dirty', async () => {
    const { result, unmount } = await renderHook(() =>
      useDocEditor('doc-test-1')
    )

    act(() => {
      result.current.setContent('Unsaved content before unmount')
    })

    unmount()

    const docAfterUnmount = useDokudocsStore
      .getState()
      .documents.find((d) => d.id === 'doc-test-1')
    expect(docAfterUnmount?.content).toBe('Unsaved content before unmount')
  })

  it('switches state when docId prop changes', async () => {
    let currentId = 'doc-test-1'
    const { result, rerender } = await renderHook(() => useDocEditor(currentId))

    expect(result.current.title).toBe('Test Architecture')

    currentId = 'doc-test-2'
    await rerender()

    expect(result.current.title).toBe('Second Document')
    expect(result.current.content).toBe('Table users {\n  id int\n}')
    expect(result.current.isDirty).toBe(false)
  })
})
