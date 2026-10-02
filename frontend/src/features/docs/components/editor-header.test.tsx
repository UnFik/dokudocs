import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { EditorHeader } from './editor-header'

async function renderHeader(withPresence: boolean) {
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
