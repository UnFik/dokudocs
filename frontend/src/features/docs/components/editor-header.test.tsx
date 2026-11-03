import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { EditorHeader } from './editor-header'

async function renderHeader(
  withPresence: boolean,
  props: Partial<React.ComponentProps<typeof EditorHeader>> = {}
) {
  const root = createRootRoute()
  const route = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <EditorHeader
        docId='d1'
        title='Spec'
        type='markdown'
        projectId={null}
        projectName='Platform'
        isSaving={false}
        isDirty={false}
        lastSaved={null}
        onTitleChange={() => undefined}
        presenceUsers={
          withPresence ? [{ userID: 'u1', name: 'Ada Lovelace' }] : undefined
        }
        currentUserID='u1'
        {...props}
      />
    ),
  })
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(<RouterProvider router={router} />)
}

describe('EditorHeader presence', () => {
  it('places the active-user avatars in the right group, before the folder chip', async () => {
    await renderHeader(true)
    const avatars = document.querySelector(
      '[aria-label="People in this document"]'
    )
    const folder = [...document.querySelectorAll('header span')].find(
      (element) => element.textContent === 'Platform'
    )
    expect(avatars).not.toBeNull()
    expect(folder).toBeDefined()
    expect(
      avatars!.compareDocumentPosition(folder!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('renders no avatar list when nobody is connected', async () => {
    await renderHeader(false)
    expect(
      document.querySelector('[aria-label="People in this document"]')
    ).toBeNull()
  })
})

describe('EditorHeader export', () => {
  it('has no Export button when there is nothing to export', async () => {
    await renderHeader(false)

    expect(
      page.getByRole('button', { name: /^Export$/ }).elements()
    ).toHaveLength(0)
  })

  it('hands Export to the page, without a menu, when it opens its own dialog', async () => {
    const onOpenExport = vi.fn()
    await renderHeader(false, { onOpenExport })
    ;(
      page.getByRole('button', { name: /^Export$/ }).element() as HTMLElement
    ).click()

    expect(onOpenExport).toHaveBeenCalledTimes(1)
    expect(page.getByRole('menu').elements()).toHaveLength(0)
  })
})
