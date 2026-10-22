import '@/styles/index.css'
import { beforeEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { showCanvasNotice, useCanvasNotice } from '../lib/canvas-notice'
import { CanvasNotice } from './canvas-notice'

describe('the check beside the canvas tool bar', () => {
  beforeEach(() => {
    useCanvasNotice.getState().dismiss()
  })

  it('shows nothing until something succeeded', async () => {
    await render(<CanvasNotice />)
    expect(document.querySelector('[data-slot="canvas-notice"]')).toBeNull()
  })

  it('shows a check once something succeeded', async () => {
    await render(<CanvasNotice />)
    showCanvasNotice('Version “v1” tagged.')
    await expect
      .element(page.getByRole('button', { name: 'Done' }))
      .toBeVisible()
  })

  it('reads out the message when the person points at the check', async () => {
    await render(<CanvasNotice />)
    showCanvasNotice('Version “v1” tagged.')
    await userEvent.hover(page.getByRole('button', { name: 'Done' }))
    await expect.element(page.getByText('Version “v1” tagged.')).toBeVisible()
  })
})
