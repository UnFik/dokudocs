import { act } from 'react'
import type { DocumentItem, ProjectItem } from '@/types/dokudocs'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { useCommentStore } from '@/stores/comment-store'
import { useEditorPreferenceStore } from '@/stores/editor-preference-store'
import { useDocEditor } from '../hooks/use-doc-editor'

describe('Editor Mode Switching & Store Mutation Persistence', () => {
  const initialDoc: DocumentItem = {
    id: 'doc-mode-test-1',
    title: 'Initial Document Title',
    type: 'markdown',
    content: '# Initial Content\n\nThis is initial text.',
    projectId: 'proj-1',
    projectName: 'Project 1',
    categories: [],
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

  const initialProject: ProjectItem = {
    id: 'proj-1',
    name: 'Project 1',
    categories: [],
    orgId: 'org-1',
    documentIds: ['doc-mode-test-1'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  beforeEach(() => {
    useDokudocsStore.setState({
      documents: [{ ...initialDoc }],
      projects: [{ ...initialProject }],
    })
    useCommentStore.setState({
      threads: [],
      activeThreadId: null,
      isSidebarOpen: false,
    })
    useEditorPreferenceStore.setState({
      preferencesByUser: {
        'test-user': {
          viewMode: 'split',
          previewMode: 'edit',
          splitPercent: 50,
          isLiveRenderActive: true,
          syncScroll: true,
          showOutline: false,
        },
      },
    })
  })

  it('immediately mutates useDokudocsStore when setContent is invoked in useDocEditor', async () => {
    const { result } = await renderHook(() => useDocEditor('doc-mode-test-1'))

    expect(result.current.content).toBe('# Initial Content\n\nThis is initial text.')

    act(() => {
      result.current.setContent('# Updated Content\n\nBrand new line.')
    })

    expect(result.current.content).toBe('# Updated Content\n\nBrand new line.')

    const storeDoc = useDokudocsStore
      .getState()
      .documents.find((d) => d.id === 'doc-mode-test-1')

    expect(storeDoc).toBeDefined()
    expect(storeDoc?.content).toBe('# Updated Content\n\nBrand new line.')
  })

  it('preserves content when switching viewMode between editor, split, and preview', async () => {
    const { result } = await renderHook(() => useDocEditor('doc-mode-test-1'))

    act(() => {
      result.current.setContent('# Modified in Monaco\n\nTyping code here.')
    })

    act(() => {
      useEditorPreferenceStore.getState().setViewMode('test-user', 'preview')
    })

    const currentPref = useEditorPreferenceStore.getState().preferencesByUser['test-user']
    expect(currentPref?.viewMode).toBe('preview')

    const storeDoc = useDokudocsStore
      .getState()
      .documents.find((d) => d.id === 'doc-mode-test-1')
    expect(storeDoc?.content).toBe('# Modified in Monaco\n\nTyping code here.')

    act(() => {
      useEditorPreferenceStore.getState().setViewMode('test-user', 'code')
    })

    const codeDoc = useDokudocsStore
      .getState()
      .documents.find((d) => d.id === 'doc-mode-test-1')
    expect(codeDoc?.content).toBe('# Modified in Monaco\n\nTyping code here.')
  })

  it('switches previewMode between view and edit cleanly', async () => {
    const { result } = await renderHook(() => useDocEditor('doc-mode-test-1'))

    act(() => {
      result.current.setContent('# Phase 1 Draft\n\nContent in edit mode.')
      useEditorPreferenceStore.getState().setPreviewMode('test-user', 'view')
    })

    const prefView = useEditorPreferenceStore.getState().preferencesByUser['test-user']
    expect(prefView?.previewMode).toBe('view')

    act(() => {
      useEditorPreferenceStore.getState().setPreviewMode('test-user', 'edit')
    })

    const prefEdit = useEditorPreferenceStore.getState().preferencesByUser['test-user']
    expect(prefEdit?.previewMode).toBe('edit')

    const latestDoc = useDokudocsStore
      .getState()
      .documents.find((d) => d.id === 'doc-mode-test-1')
    expect(latestDoc?.content).toBe('# Phase 1 Draft\n\nContent in edit mode.')
  })

  it('immediately updates title and metadata in store on change', async () => {
    const { result } = await renderHook(() => useDocEditor('doc-mode-test-1'))

    act(() => {
      result.current.setTitle('Renamed Document Title')
      result.current.setCategory('Documentation')
    })

    const updatedDoc = useDokudocsStore
      .getState()
      .documents.find((d) => d.id === 'doc-mode-test-1')

    expect(updatedDoc?.title).toBe('Renamed Document Title')
    expect(updatedDoc?.category).toBe('Documentation')
    expect(updatedDoc?.categories).toEqual(['Documentation'])
  })
})

