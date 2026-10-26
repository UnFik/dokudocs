import { useRef } from 'react'
import { afterEach, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { useScrollMemory } from './use-scroll-memory'

afterEach(() => sessionStorage.clear())

function Page({ ready = true, restore = true }) {
  const ref = useRef<HTMLDivElement>(null)
  useScrollMemory(ref, { docId: 'doc-1', userId: 'user-1', ready, restore })
  return (
    <div ref={ref} data-testid='page' style={{ height: 100, overflow: 'auto' }}>
      {Array.from({ length: 20 }, (_, index) => (
        <p
          key={index}
          data-node-id={`n${index}`}
          style={{ height: 50, margin: 0 }}
        >
          Block {index}
        </p>
      ))}
    </div>
  )
}
const page = () => document.querySelector<HTMLElement>('[data-testid=page]')!
const scrollTo = async (top: number) => {
  page().scrollTop = top
  await new Promise((resolve) => setTimeout(resolve, 100))
}

it('opens the page where the person left it', async () => {
  const first = await render(<Page />)
  await scrollTo(430)
  await first.unmount()
  await render(<Page />)
  await expect.poll(() => page().scrollTop).toBe(430)
})

it('waits for the page to be ready before moving it', async () => {
  const first = await render(<Page />)
  await scrollTo(430)
  await first.unmount()
  const second = await render(<Page ready={false} />)
  expect(page().scrollTop).toBe(0)
  await second.rerender(<Page ready />)
  await expect.poll(() => page().scrollTop).toBe(430)
})

it('leaves the page at the top when something else says where to look', async () => {
  const first = await render(<Page />)
  await scrollTo(430)
  await first.unmount()
  await render(<Page restore={false} />)
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(page().scrollTop).toBe(0)
})
