import { expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { DocBodySkeleton, DocEditorSkeleton } from './document-skeleton'

const count = (container: Element) =>
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
  expect(count(container)).toBe(2)
})
