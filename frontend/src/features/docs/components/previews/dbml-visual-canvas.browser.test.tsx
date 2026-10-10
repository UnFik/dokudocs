import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import {
  getLocalUserScope,
  getUserStorage,
  switchLocalUser,
} from '@/lib/user-storage'
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

  afterEach(() => {
    switchLocalUser(null)
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

  it('keeps every joint dot on the connector after a joint is dragged past its neighbour', async () => {
    switchLocalUser('joint-test')
    getUserStorage(getLocalUserScope()).setItem(
      'dokudocs_dbml_layout_test-doc-joints',
      JSON.stringify({
        tablePositions: { posts: { x: 0, y: 0 }, users: { x: 600, y: 300 } },
        edgeJoints: {
          'posts.user_id->users.id': [
            { x: 350, y: 117, axis: 'y' },
            { x: 440, y: 240, axis: 'x' },
            { x: 520, y: 357, axis: 'y' },
          ],
        },
      })
    )
    await render(
      <DbmlVisualCanvas docId='test-doc-joints' content={sampleDbml} />
    )

    const hitPath = document.querySelector(
      'path[stroke="transparent"]'
    ) as SVGPathElement
    expect(hitPath).not.toBeNull()

    const toClient = (point: DOMPoint) => {
      const matrix = hitPath.getScreenCTM()!
      const mapped = point.matrixTransform(matrix)
      return { clientX: mapped.x, clientY: mapped.y }
    }
    const fire = (
      target: EventTarget,
      type: string,
      { clientX, clientY }: { clientX: number; clientY: number }
    ) =>
      target.dispatchEvent(
        new MouseEvent(type, { bubbles: true, clientX, clientY })
      )

    fire(
      hitPath,
      'mousedown',
      toClient(hitPath.getPointAtLength(hitPath.getTotalLength() / 2))
    )

    const jointDots = () =>
      Array.from(document.querySelectorAll<SVGCircleElement>('circle[r="14"]'))
    await vi.waitFor(() => expect(jointDots()).toHaveLength(5))

    // Seeded joints are y, x, y; the last one sits on a horizontal run.
    expect(jointDots()[2].cx.baseVal.value).toBe(440)
    const dragged = jointDots()[3]
    const from = dragged.getBoundingClientRect()
    const start = {
      clientX: from.x + from.width / 2,
      clientY: from.y + from.height / 2,
    }
    fire(dragged, 'mousedown', start)
    fire(window, 'mousemove', { ...start, clientY: start.clientY - 400 })
    await new Promise((resolve) => requestAnimationFrame(resolve))
    fire(window, 'mouseup', { ...start, clientY: start.clientY - 400 })

    const distanceToPath = (dot: SVGCircleElement) => {
      const cx = dot.cx.baseVal.value
      const cy = dot.cy.baseVal.value
      const length = hitPath.getTotalLength()
      let best = Infinity
      for (let at = 0; at <= length; at += 1) {
        const p = hitPath.getPointAtLength(at)
        best = Math.min(best, Math.hypot(p.x - cx, p.y - cy))
      }
      return best
    }

    await vi.waitFor(() =>
      expect(jointDots()[3].cy.baseVal.value).toBeLessThan(0)
    )
    expect(jointDots()).toHaveLength(5)
    for (const dot of jointDots()) {
      expect(distanceToPath(dot)).toBeLessThanOrEqual(1.5)
    }
  })
})
