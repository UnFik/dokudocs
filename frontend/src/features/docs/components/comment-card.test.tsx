import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/styles/index.css'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { CommentThread } from '@/lib/domain-api'
import { CommentCard } from './comment-card'

const ME = '00000000-0000-4000-8000-0000000000a1'

const thread: CommentThread = {
  id: '00000000-0000-4000-8000-0000000000c1',
  documentId: 'document',
  authorId: ME,
  authorName: 'Fikri',
  selectedText: 'Judul Dokumen',
  content: 'kayanya ganti deh',
  anchor: null,
  createdAt: '2026-10-07T02:19:31Z',
  replies: [
    {
      id: '00000000-0000-4000-8000-0000000000d1',
      threadId: '00000000-0000-4000-8000-0000000000c1',
      authorId: ME,
      authorName: 'Fikri',
      content: 'setuju',
      createdAt: '2026-10-07T02:20:31Z',
    },
  ],
}

async function renderCard() {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <ul className='w-80 px-4 text-xs'>
        <CommentCard
          thread={thread}
          userID={ME}
          canInteract
          orphaned={false}
          focused={false}
          workspaceID='workspace'
          documentID='document'
          onSelect={vi.fn()}
        />
      </ul>
    </QueryClientProvider>
  )
}

describe('CommentCard layout', () => {
  it('lines the comment, first action, reply box and resolve button up with the avatar', async () => {
    const screen = await renderCard()
    await expect.element(screen.getByText('kayanya ganti deh')).toBeVisible()
    const li = screen.container.querySelector('li')!
    const edge = li
      .querySelector('[data-slot="avatar"]')!
      .getBoundingClientRect().left
    const left = (element: Element | null) => {
      expect(element).not.toBeNull()
      return element!.getBoundingClientRect().left
    }
    const textLeft = (element: Element | null) => {
      const range = document.createRange()
      range.selectNodeContents(element!)
      return range.getBoundingClientRect().left
    }
    // The text of the comment, the first action, the reply box and the resolve
    // button all start where the avatar does.
    const body = li.querySelector('button[aria-label^="Show in document"]')!
    expect(textLeft(body.querySelector('span'))).toBeCloseTo(edge, 0)
    expect(left(li.querySelector('textarea'))).toBeCloseTo(edge, 0)
    for (const name of ['Edit', 'Resolve comment']) {
      const button = [...li.querySelectorAll('button')].find(
        (b) => b.textContent === name
      )!
      expect(textLeft(button)).toBeCloseTo(edge, 0)
    }
  })

  it('keeps every action the same compact height', async () => {
    const screen = await renderCard()
    await expect.element(screen.getByText('kayanya ganti deh')).toBeVisible()
    const heights = [...screen.container.querySelectorAll('button')]
      .filter((b) =>
        ['Edit', 'Delete', 'Send reply', 'Resolve comment'].includes(
          b.textContent ?? ''
        )
      )
      .map((b) => Math.round(b.getBoundingClientRect().height))
    expect(heights.length).toBe(4)
    expect(new Set(heights).size).toBe(1)
  })
})
