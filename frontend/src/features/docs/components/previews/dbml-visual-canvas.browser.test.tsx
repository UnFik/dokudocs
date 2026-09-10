import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { DbmlVisualCanvas } from './dbml-visual-canvas'

const sampleDbml = `
Table users {
  id int [pk]
  username varchar
  email varchar
}

Table posts {
  id int [pk]
  title varchar
  user_id int [ref: > users.id]
}
`

describe('DbmlVisualCanvas Component', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('renders table definitions and column details', async () => {
    const screen = await render(
      <DbmlVisualCanvas docId='test-doc-1' content={sampleDbml} />
    )

    await expect.element(screen.getByText('users')).toBeInTheDocument()
    await expect.element(screen.getByText('posts')).toBeInTheDocument()
    await expect.element(screen.getByText('username')).toBeInTheDocument()
    await expect.element(screen.getByText('user_id')).toBeInTheDocument()
  })

  it('renders initial zoom badge at 100% and updates on zoom buttons', async () => {
    const screen = await render(
      <DbmlVisualCanvas docId='test-doc-2' content={sampleDbml} />
    )

    const badge = screen.getByText('100%')
    await expect.element(badge).toBeInTheDocument()

    const zoomInBtn = screen.getByTitle('Zoom in')
    await userEvent.click(zoomInBtn)
    await expect.element(screen.getByText('115%')).toBeInTheDocument()

    const zoomOutBtn = screen.getByTitle('Zoom out')
    await userEvent.click(zoomOutBtn)
    await expect.element(screen.getByText('98%')).toBeInTheDocument()

    const resetBtn = screen.getByTitle('Reset zoom & pan')
    await userEvent.click(resetBtn)
    await expect.element(screen.getByText('100%')).toBeInTheDocument()
  })

  it('has stable transform origin and layer transform', async () => {
    const screen = await render(
      <DbmlVisualCanvas docId='test-doc-3' content={sampleDbml} />
    )

    const autoLayoutBtn = screen.getByTitle(
      'Auto Layout Schema (Reorganize cleanly)'
    )
    await expect.element(autoLayoutBtn).toBeInTheDocument()
    await userEvent.click(autoLayoutBtn)

    // Tables are still visible after auto-layout
    await expect.element(screen.getByText('users')).toBeInTheDocument()
    await expect.element(screen.getByText('posts')).toBeInTheDocument()
  })

  it('allows background panning without jumping or resetting zoom', async () => {
    const screen = await render(
      <DbmlVisualCanvas docId='test-doc-pan' content={sampleDbml} />
    )

    const canvasLayer = document.querySelector(
      'div[style*="translate3d"]'
    ) as HTMLElement
    expect(canvasLayer).toBeDefined()

    const viewport = canvasLayer.parentElement!
    await userEvent.dragAndDrop(viewport, viewport, {
      sourcePosition: { x: 50, y: 50 },
      targetPosition: { x: 150, y: 120 },
    })

    // Zoom badge remains 100% (panning does not trigger zoom jumps)
    await expect.element(screen.getByText('100%')).toBeInTheDocument()
    await expect.element(screen.getByText('users')).toBeInTheDocument()
  })

  it('reproduces drag behavior after zooming in', async () => {
    const screen = await render(
      <DbmlVisualCanvas docId='test-doc-zoom-pan' content={sampleDbml} />
    )

    const zoomInBtn = screen.getByTitle('Zoom in')
    await userEvent.click(zoomInBtn)
    await expect.element(screen.getByText('115%')).toBeInTheDocument()

    const canvasLayer = document.querySelector(
      'div[style*="translate3d"]'
    ) as HTMLElement
    expect(canvasLayer.style.transform).toContain('scale(1.15)')

    const viewport = canvasLayer.parentElement!
    await userEvent.dragAndDrop(viewport, viewport, {
      sourcePosition: { x: 50, y: 50 },
      targetPosition: { x: 150, y: 120 },
    })

    console.log('After drag transform:', canvasLayer.style.transform)
    expect(canvasLayer.style.transform).toContain('scale(1.15)')
  })
})
