import { expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { DocBodySkeleton, DocEditorSkeleton } from './document-skeleton'

const count = (container: ParentNode) =>
  container.querySelectorAll('[data-slot="skeleton"]').length

it('draws text lines for markdown', async () => {
  const { container } = await render(
    <DocBodySkeleton label='Loading' type='markdown' />
  )
  expect(count(container)).toBe(5)
})

it.each(['dbdiagram', 'mermaid'] as const)(
  'draws source beside a preview for %s',
  async (type) => {
    const { container } = await render(
      <DocBodySkeleton label='Loading' type={type} />
    )
    expect(count(container)).toBe(7)
  }
)

it('draws nodes on a canvas for architecture', async () => {
  const { container } = await render(
    <DocBodySkeleton label='Loading' type='architecture' />
  )
  expect(count(container)).toBe(5)
})

it('stays neutral while the type is unknown', async () => {
  const { container } = await render(<DocEditorSkeleton label='Loading' />)
  const body = container.querySelector('[data-slot="doc-skeleton-body"]')!
  expect(count(body)).toBe(1)
})

it('loads the header on its own, ahead of the body', async () => {
  const { container } = await render(<DocEditorSkeleton label='Loading' />)
  const header = container.querySelector('header')!
  expect(count(header)).toBeGreaterThan(3)
})

it('shows the known type and title in the header', async () => {
  const { container } = await render(
    <DocEditorSkeleton label='Loading' type='mermaid' title='Order flow' />
  )
  expect(container.querySelector('header h1')?.textContent).toBe('Order flow')
})
