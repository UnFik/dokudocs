import { create } from 'zustand'

export const noticeShownMs = 3000

interface CanvasNotice {
  message: string | null
  held: boolean
  /** Pause the countdown while the person reads the message. */
  hold: (held: boolean) => void
  dismiss: () => void
}

let timer: ReturnType<typeof setTimeout> | undefined

function arm() {
  clearTimeout(timer)
  timer = setTimeout(() => {
    if (!useCanvasNotice.getState().held) useCanvasNotice.getState().dismiss()
  }, noticeShownMs)
}

export const useCanvasNotice = create<CanvasNotice>((set) => ({
  message: null,
  held: false,
  hold: (held) => {
    set({ held })
    if (!held && useCanvasNotice.getState().message !== null) arm()
  },
  dismiss: () => {
    clearTimeout(timer)
    set({ message: null, held: false })
  },
}))

/** A success the canvas shows as a check beside its tool bar, instead of a toast. */
export function showCanvasNotice(message: string) {
  useCanvasNotice.setState({ message })
  arm()
}
