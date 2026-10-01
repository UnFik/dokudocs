import { act } from 'react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import type { DocumentItem } from '@/types/dokudocs'
import * as monaco from 'monaco-editor'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { switchLocalUser } from '@/lib/local-user-data'
import { getLocalUserScope, getUserStorage } from '@/lib/user-storage'
import { DocEditor } from './doc-editor'

const userA = '11111111-1111-4111-8111-111111111111'
const userB = '22222222-2222-4222-8222-222222222222'
const doc: DocumentItem = {
  id: 'isolated-editor',
  title: 'Private draft A',
  type: 'dbdiagram',
  content: 'Table original {\n id int\n}',
  projectId: null,
  projectName: null,
  category: null,
  categories: [],
  orgId: 'workspace',
  author: { id: userA, name: 'A', email: 'a@example.com', avatar: '' },
  isDraft: true,
  isShared: false,
  isStarred: false,
  thumbnail: 'existing thumbnail',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

beforeEach(() => {
  switchLocalUser(userA)
  useDokudocsStore.setState({
    documents: [{ ...doc }],
    projects: [],
    revisions: {},
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  switchLocalUser(null)
})

async function renderEditor() {
  const root = createRootRoute()
  const route = createRoute({
    getParentRoute: () => root,
    path: '/docs/$docId',
    component: DocEditor,
  })
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/docs/isolated-editor'] }),
  })
  await router.load()
  return render(<RouterProvider router={router} />)
}

it('flushes pending Monaco content to its owner before switching and restores only that owner', async () => {
  const screen = await renderEditor()
  await expect
    .element(screen.getByRole('heading', { name: doc.title }))
    .toBeInTheDocument()
  const model = monaco.editor
    .getModels()
    .find((model) => model.getValue() === doc.content)
  expect(model).toBeDefined()

  act(() => {
    model?.setValue('Table private_a {\n id int\n}')
    switchLocalUser(userB)
    useDokudocsStore.setState({
      documents: [
        {
          ...doc,
          title: 'Private draft B',
          content: 'Table private_b {\n id int\n}',
        },
      ],
      revisions: {},
    })
  })
  await expect
    .element(screen.getByRole('heading', { name: 'Private draft B' }))
    .toBeInTheDocument()
  expect(useDokudocsStore.getState().documents[0].content).toContain(
    'private_b'
  )
  expect(useDokudocsStore.getState().getDocRevisions(doc.id)).toEqual([])

  act(() => switchLocalUser(userA))
  await expect
    .element(screen.getByRole('heading', { name: doc.title }))
    .toBeInTheDocument()
  expect(useDokudocsStore.getState().documents[0].content).toBe(
    'Table private_a {\n id int\n}'
  )
  expect(useDokudocsStore.getState().getDocRevisions(doc.id)[0]?.content).toBe(
    'Table private_a {\n id int\n}'
  )
  await screen.unmount()
})

it('flushes pending Muya input before logout', async () => {
  useDokudocsStore.setState({ documents: [{ ...doc, type: 'markdown', content: 'Original paragraph' }] })
  const screen = await renderEditor()
  await screen.getByTestId('preview-mode-edit').click()
  const editable = document.querySelector<HTMLElement>('.muya-container [contenteditable="true"]')
  if (!editable) throw new Error('Muya editable paragraph is missing')
  await userEvent.click(editable)
  await userEvent.keyboard('{Control>}a{/Control}')
  await userEvent.type(editable, 'Pending private Muya paragraph')
  act(() => switchLocalUser(null))
  expect(useDokudocsStore.getState().documents).toEqual([])
  act(() => switchLocalUser(userA))
  await expect.element(screen.getByRole('heading', { name: doc.title })).toBeInTheDocument()
  expect(useDokudocsStore.getState().documents[0].content).toContain('Pending private Muya paragraph')
  expect(useDokudocsStore.getState().getDocRevisions(doc.id)[0]?.content).toContain('Pending private Muya paragraph')
  await screen.unmount()
})

it('keeps canvas layout in the owner namespace and does not read the legacy backup', async () => {
  const key = `dokudocs_dbml_layout_${doc.id}`
  const legacy = JSON.stringify({ zoom: 4, pan: { x: 99, y: 99 } })
  localStorage.setItem(key, legacy)
  const storageA = getUserStorage(getLocalUserScope())
  storageA.removeItem(key)
  const screen = await renderEditor()
  await expect
    .element(screen.getByText('100%', { exact: true }))
    .toBeInTheDocument()
  await screen.getByTitle('Zoom in', { exact: true }).click()
  await expect
    .element(screen.getByText('115%', { exact: true }))
    .toBeInTheDocument()
  expect(storageA.getItem(key)).toContain('1.15')
  expect(localStorage.getItem(key)).toBe(legacy)

  act(() => {
    switchLocalUser(userB)
    getUserStorage(getLocalUserScope()).removeItem(key)
    useDokudocsStore.setState({
      documents: [{ ...doc, title: 'Private draft B' }],
    })
  })
  await expect
    .element(screen.getByText('100%', { exact: true }))
    .toBeInTheDocument()
  act(() => switchLocalUser(userA))
  await expect
    .element(screen.getByText('115%', { exact: true }))
    .toBeInTheDocument()
  await screen.unmount()
  localStorage.removeItem(key)
})

it('saves content before rasterization and rejects a delayed thumbnail after A to B to A', async () => {
  const setSource = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    'src'
  )?.set
  if (!setSource) throw new Error('Browser image source setter is missing')
  const pendingImages: Array<() => void> = []
  vi.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(
    function (this: HTMLImageElement, value: string) {
      if (value.startsWith('blob:'))
        pendingImages.push(() => setSource.call(this, value))
      else setSource.call(this, value)
    }
  )
  const screen = await renderEditor()
  await expect
    .element(screen.getByRole('heading', { name: doc.title }))
    .toBeInTheDocument()
  const model = monaco.editor
    .getModels()
    .find((model) => model.getValue() === doc.content)
  act(() => model?.setValue('Table waiting_for_thumbnail {\n id int\n}'))
  await vi.waitFor(() => expect(pendingImages.length).toBeGreaterThan(0), {
    timeout: 4000,
  })
  expect(useDokudocsStore.getState().documents[0].content).toContain(
    'waiting_for_thumbnail'
  )
  expect(
    useDokudocsStore.getState().getDocRevisions(doc.id)[0]?.content
  ).toContain('waiting_for_thumbnail')

  act(() => {
    switchLocalUser(userB)
    switchLocalUser(userA)
    useDokudocsStore
      .getState()
      .updateDocument(doc.id, {
        content: 'Table newest_a {\n id int\n}',
        thumbnail: 'new session thumbnail',
      })
  })
  for (const release of pendingImages) release()
  await new Promise((resolve) => setTimeout(resolve, 400))
  expect(useDokudocsStore.getState().documents[0].content).toContain('newest_a')
  expect(useDokudocsStore.getState().documents[0].thumbnail).toBe(
    'new session thumbnail'
  )
  await screen.unmount()
})

it('does not advertise local document URLs as public sharing', async () => {
  const screen = await renderEditor()
  await expect
    .element(screen.getByRole('button', { name: 'Share', exact: true }))
    .toBeDisabled()
})
