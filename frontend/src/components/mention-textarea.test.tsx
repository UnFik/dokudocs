import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import { MentionTextarea } from './mention-textarea'

const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const documentID = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const ANA = '11111111-1111-4111-8111-111111111111'
const BO = '22222222-2222-4222-8222-222222222222'
const CA = '33333333-3333-4333-8333-333333333333'

const people = [
  { userId: ANA, name: 'Ana Bo', email: 'ana@example.com', canRead: true },
  { userId: BO, name: 'Bo Ca', email: 'bo@example.com', canRead: true },
  { userId: CA, name: 'Cy Anders', email: 'cy@example.com', canRead: false },
]

beforeEach(() => useAuthStore.getState().auth.setSession(testSession()))
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

function stub(respond: () => Response = () => jsonResponse(people)) {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/mentionable')) return respond()
    throw new Error(`Unexpected request: ${path}`)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function Harness(props: {
  initial?: string
  onChange: (value: string) => void
  onKeyDown?: (event: React.KeyboardEvent) => void
}) {
  const [value, setValue] = useState(props.initial ?? '')
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <label htmlFor='box'>Comment</label>
      <MentionTextarea
        id='box'
        workspaceID={workspaceID}
        documentID={documentID}
        value={value}
        onValueChange={(next) => {
          setValue(next)
          props.onChange(next)
        }}
        onKeyDown={props.onKeyDown}
      />
      <output data-testid='stored'>{value}</output>
    </QueryClientProvider>
  )
}

describe('MentionTextarea', () => {
  it('opens the list of people on @ and narrows it as the name is typed', async () => {
    stub()
    const screen = await render(<Harness onChange={vi.fn()} />)
    const box = screen.getByLabelText('Comment')
    await box.click()
    await userEvent.keyboard('hi @')
    await expect
      .element(screen.getByRole('option', { name: /Ana Bo/ }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('option', { name: /Bo Ca/ }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('option', { name: /Cy Anders/ }))
      .toBeVisible()

    await userEvent.keyboard('an')
    await expect
      .element(screen.getByRole('option', { name: /Ana Bo/ }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('option', { name: /Cy Anders/ }))
      .toBeVisible()
    expect(screen.container.textContent).not.toContain('Bo Ca')

    await userEvent.keyboard('a')
    expect(screen.container.textContent).not.toContain('Cy Anders')
  })

  it('shows someone who cannot read the document as unavailable, and does not pick them', async () => {
    stub()
    const onChange = vi.fn()
    const screen = await render(<Harness onChange={onChange} />)
    await screen.getByLabelText('Comment').click()
    await userEvent.keyboard('@cy')
    const locked = screen.getByRole('option', { name: /Cy Anders/ })
    await expect.element(locked).toHaveAttribute('aria-disabled', 'true')
    await expect.element(locked).toHaveTextContent('no access')
    await userEvent.keyboard('{Enter}')
    expect(screen.getByLabelText('Comment').element()).toHaveProperty(
      'value',
      '@cy'
    )
  })

  it('picks with the keyboard and stores a token, while the box reads @Name', async () => {
    stub()
    const onChange = vi.fn()
    const screen = await render(<Harness onChange={onChange} />)
    await screen.getByLabelText('Comment').click()
    await userEvent.keyboard('ping @b')
    await expect
      .element(screen.getByRole('option', { name: /Bo Ca/ }))
      .toBeVisible()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByLabelText('Comment').element()).toHaveProperty(
      'value',
      'ping @Bo Ca '
    )
    expect(onChange).toHaveBeenLastCalledWith(`ping @[Bo Ca](user:${BO}) `)
    expect(screen.container.querySelector('[role="listbox"]')).toBeNull()
  })

  it('picks with the mouse', async () => {
    stub()
    const onChange = vi.fn()
    const screen = await render(<Harness onChange={onChange} />)
    await screen.getByLabelText('Comment').click()
    await userEvent.keyboard('@')
    await screen.getByRole('option', { name: /Ana Bo/ }).click()
    expect(onChange).toHaveBeenLastCalledWith(`@[Ana Bo](user:${ANA}) `)
  })

  it('moves through the list with the arrow keys', async () => {
    stub()
    const onChange = vi.fn()
    const screen = await render(<Harness onChange={onChange} />)
    await screen.getByLabelText('Comment').click()
    await userEvent.keyboard('@')
    await expect
      .element(screen.getByRole('option', { name: /Bo Ca/ }))
      .toBeVisible()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenLastCalledWith(`@[Bo Ca](user:${BO}) `)
  })

  it('closes the list on Escape without passing the key on', async () => {
    stub()
    const onKeyDown = vi.fn()
    const screen = await render(
      <Harness onChange={vi.fn()} onKeyDown={onKeyDown} />
    )
    await screen.getByLabelText('Comment').click()
    await userEvent.keyboard('@')
    await expect.element(screen.getByRole('listbox')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    expect(screen.container.querySelector('[role="listbox"]')).toBeNull()
    expect(onKeyDown).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: 'Escape' })
    )
    await userEvent.keyboard('{Escape}')
    expect(onKeyDown).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'Escape' })
    )
  })

  it('does not open the list for an email address', async () => {
    stub()
    const screen = await render(<Harness onChange={vi.fn()} />)
    await screen.getByLabelText('Comment').click()
    await userEvent.keyboard('mail me@exa')
    expect(screen.container.querySelector('[role="listbox"]')).toBeNull()
  })

  it('shows an existing mention as @Name and makes it plain text when its name is edited', async () => {
    stub()
    const onChange = vi.fn()
    const screen = await render(
      <Harness initial={`see @[Ana Bo](user:${ANA}) now`} onChange={onChange} />
    )
    const box = screen.getByLabelText('Comment')
    expect(box.element()).toHaveProperty('value', 'see @Ana Bo now')
    await box.click()
    const element = box.element() as HTMLTextAreaElement
    element.setSelectionRange(11, 11)
    await userEvent.keyboard('{Backspace}')
    expect(onChange).toHaveBeenLastCalledWith('see @Ana B now')
  })

  it('says so when no one matches', async () => {
    stub()
    const screen = await render(<Harness onChange={vi.fn()} />)
    await screen.getByLabelText('Comment').click()
    await userEvent.keyboard('@zzz')
    await expect
      .element(screen.getByText(/No one in this workspace matches/))
      .toBeVisible()
  })

  it('says so when the people cannot be loaded, and leaves the text alone', async () => {
    stub(() => new Response('{}', { status: 500 }))
    const onChange = vi.fn()
    const screen = await render(<Harness onChange={onChange} />)
    await screen.getByLabelText('Comment').click()
    await userEvent.keyboard('@a')
    await expect
      .element(screen.getByText(/Could not load people/))
      .toBeVisible()
    expect(onChange).toHaveBeenLastCalledWith('@a')
  })
})
