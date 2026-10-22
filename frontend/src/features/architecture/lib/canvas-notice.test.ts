import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  noticeShownMs,
  showCanvasNotice,
  useCanvasNotice,
} from './canvas-notice'

describe('the success notice on the canvas', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useCanvasNotice.getState().dismiss()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the message, then goes away after a few seconds', () => {
    showCanvasNotice('Version “v1” tagged.')
    expect(useCanvasNotice.getState().message).toBe('Version “v1” tagged.')

    vi.advanceTimersByTime(noticeShownMs - 1)
    expect(useCanvasNotice.getState().message).toBe('Version “v1” tagged.')

    vi.advanceTimersByTime(1)
    expect(useCanvasNotice.getState().message).toBeNull()
  })

  it('stays between two and four seconds', () => {
    expect(noticeShownMs).toBeGreaterThanOrEqual(2000)
    expect(noticeShownMs).toBeLessThanOrEqual(4000)
  })

  it('restarts the wait when a second notice arrives', () => {
    showCanvasNotice('First')
    vi.advanceTimersByTime(noticeShownMs - 500)
    showCanvasNotice('Second')

    vi.advanceTimersByTime(noticeShownMs - 1)
    expect(useCanvasNotice.getState().message).toBe('Second')

    vi.advanceTimersByTime(1)
    expect(useCanvasNotice.getState().message).toBeNull()
  })

  it('waits while the person is reading it, then leaves after they let go', () => {
    showCanvasNotice('Canvas restored.')
    useCanvasNotice.getState().hold(true)
    vi.advanceTimersByTime(noticeShownMs * 3)
    expect(useCanvasNotice.getState().message).toBe('Canvas restored.')

    useCanvasNotice.getState().hold(false)
    vi.advanceTimersByTime(noticeShownMs)
    expect(useCanvasNotice.getState().message).toBeNull()
  })
})
