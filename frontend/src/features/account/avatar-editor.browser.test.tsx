import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/styles/index.css'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import { AvatarEditor } from './avatar-editor'

const key = (url: string, init: RequestInit = {}) =>
  `${init.method ?? 'GET'} ${new URL(url).pathname}`

function mount(avatar = '') {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AvatarEditor name='Current Person' avatar={avatar} initials='CU' />
    </QueryClientProvider>
  )
}

async function pngFile(width = 500, height = 300) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.fillRect(0, 0, width, height)
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), 'image/png')
  )
  return new File([blob], 'me.png', { type: 'image/png' })
}

const fileInput = () =>
  document.querySelector('input[type="file"]') as HTMLInputElement
const overlay = () =>
  document.querySelector('[data-slot="avatar-edit-overlay"]') as HTMLElement
const opacity = () => Number(getComputedStyle(overlay()).opacity)

beforeEach(() => useAuthStore.getState().auth.setSession(testSession()))
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

it('shows a pencil over a dimmed picture on hover and on keyboard focus, not at rest', async () => {
  vi.stubGlobal('fetch', vi.fn())
  const screen = await mount()
  const button = screen.getByRole('button', { name: 'Change profile photo' })
  await expect.element(button).toBeVisible()
  expect(opacity()).toBe(0)

  await button.hover()
  await vi.waitFor(() => expect(opacity()).toBe(1))
  await userEvent.unhover(button)
  await vi.waitFor(() => expect(opacity()).toBe(0))

  await userEvent.tab()
  expect(document.activeElement).toBe(button.element())
  await vi.waitFor(() => expect(opacity()).toBe(1))
})

it('cuts the chosen picture to a square and sends it as the avatar', async () => {
  const fetch = vi.fn((url: string, init?: RequestInit) =>
    Promise.resolve(
      key(url, init) === 'PUT /api/v1/users/me/avatar'
        ? jsonResponse({ avatarUrl: '/api/v1/avatars/abc' })
        : jsonResponse({})
    )
  )
  vi.stubGlobal('fetch', fetch)
  await mount()
  await userEvent.upload(fileInput(), await pngFile())

  await vi.waitFor(() =>
    expect(
      fetch.mock.calls.some(
        ([u, i]) => key(u, i) === 'PUT /api/v1/users/me/avatar'
      )
    ).toBe(true)
  )
  const [, init] = fetch.mock.calls.find(
    ([u, i]) => key(u, i) === 'PUT /api/v1/users/me/avatar'
  )!
  expect(init!.body).toBeInstanceOf(FormData)
  const sent = (init!.body as FormData).get('file') as Blob
  expect(['image/webp', 'image/jpeg']).toContain(sent.type)
  const bitmap = await createImageBitmap(sent)
  expect([bitmap.width, bitmap.height]).toEqual([256, 256])
})

it('refuses a file that is not a picture without asking the server', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const screen = await mount()
  await userEvent.upload(
    fileInput(),
    new File(['hello'], 'notes.txt', { type: 'text/plain' })
  )
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('Choose a PNG, JPEG or WebP picture.')
  expect(fetch).not.toHaveBeenCalled()
})

it.each([
  [413, 'too large'],
  [400, 'PNG, JPEG or WebP'],
  [500, 'Could not save the photo'],
])('explains a %s from the server', async (status, message) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(jsonResponse({ title: 'x' }, status)))
  )
  const screen = await mount()
  await userEvent.upload(fileInput(), await pngFile())
  await expect.element(screen.getByRole('alert')).toHaveTextContent(message)
})

it('marks the button busy while the picture is sent', async () => {
  let release: (response: Response) => void = () => {}
  const fetch = vi.fn(
    () => new Promise<Response>((resolve) => (release = resolve))
  )
  vi.stubGlobal('fetch', fetch)
  const screen = await mount()
  await userEvent.upload(fileInput(), await pngFile())
  const button = screen.getByRole('button', { name: 'Change profile photo' })
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
  await expect.element(button).toHaveAttribute('aria-busy', 'true')
  await expect.element(button).toBeDisabled()
  release(jsonResponse({}))
  await expect.element(button).toHaveAttribute('aria-busy', 'false')
})

it('offers Remove photo only when there is a photo, and removes it', async () => {
  const fetch = vi.fn(() =>
    Promise.resolve(new Response(null, { status: 204 }))
  )
  vi.stubGlobal('fetch', fetch)
  const empty = await mount()
  expect(
    empty.getByRole('button', { name: 'Remove photo' }).elements()
  ).toHaveLength(0)
  await empty.unmount()

  const screen = await mount('data:image/gif;base64,R0lGODlhAQABAAAAACw=')
  await screen.getByRole('button', { name: 'Remove photo' }).click()
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
  expect(key(url, init)).toBe('DELETE /api/v1/users/me/avatar')
})
