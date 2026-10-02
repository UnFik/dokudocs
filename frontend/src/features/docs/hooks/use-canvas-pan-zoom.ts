import { useCallback, useMemo, useRef, useState } from 'react'
import {
  getLocalUserScope,
  getUserStorage,
  registerLocalUserFlush,
} from '@/lib/user-storage'
import { useMountEffect } from '@/hooks/use-mount-effect'

interface UseCanvasPanZoomOptions {
  docId?: string
  initialPan?: { x: number; y: number }
  initialZoom?: number
  storagePrefix?: string
}

export function useCanvasPanZoom({
  docId,
  initialPan = { x: 0, y: 0 },
  initialZoom = 1,
  storagePrefix = 'dokudocs_canvas_layout_',
}: UseCanvasPanZoomOptions = {}) {
  const [storage] = useState(() => getUserStorage(getLocalUserScope()))
  const viewportRef = useRef<HTMLDivElement>(null)
  const isPanningRef = useRef(false)

  const initialPanValue = useMemo(() => {
    if (docId) {
      try {
        const saved = storage.getItem(`${storagePrefix}${docId}`)
        if (saved) {
          const parsed = JSON.parse(saved)
          if (parsed.pan && typeof parsed.pan.x === 'number') {
            return parsed.pan
          }
        }
      } catch {
        return initialPan
      }
    }
    return initialPan
  }, [docId, storagePrefix, storage, initialPan.x, initialPan.y])

  const initialZoomValue = useMemo(() => {
    if (docId) {
      try {
        const saved = storage.getItem(`${storagePrefix}${docId}`)
        if (saved) {
          const parsed = JSON.parse(saved)
          if (typeof parsed.zoom === 'number') {
            return parsed.zoom
          }
        }
      } catch {
        return initialZoom
      }
    }
    return initialZoom
  }, [docId, storagePrefix, storage, initialZoom])

  const panRef = useRef<{ x: number; y: number }>(initialPanValue)
  const zoomRef = useRef<number>(initialZoomValue)

  const prevDocIdRef = useRef(docId)
  if (prevDocIdRef.current !== docId) {
    prevDocIdRef.current = docId
    panRef.current = initialPanValue
    zoomRef.current = initialZoomValue
  }

  const canvasLayerNodeRef = useRef<HTMLDivElement | null>(null)
  const zoomBadgeNodeRef = useRef<HTMLSpanElement | null>(null)

  const wheelRafRef = useRef<number | null>(null)
  const mouseMoveRafRef = useRef<number | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragStartRef = useRef<{
    x: number
    y: number
    origPanX: number
    origPanY: number
  } | null>(null)

  const applyCanvasTransform = useCallback(
    (currentPan: { x: number; y: number }, currentZoom: number) => {
      if (canvasLayerNodeRef.current) {
        canvasLayerNodeRef.current.style.transform = `translate3d(${currentPan.x}px, ${currentPan.y}px, 0) scale(${currentZoom})`
      }
      if (zoomBadgeNodeRef.current) {
        zoomBadgeNodeRef.current.textContent = `${Math.round(currentZoom * 100)}%`
      }
    },
    []
  )

  const applyCanvasTransformRef = useRef(applyCanvasTransform)
  applyCanvasTransformRef.current = applyCanvasTransform

  const canvasLayerRef = useCallback((node: HTMLDivElement | null) => {
    canvasLayerNodeRef.current = node
    if (node) {
      node.style.transform = `translate3d(${panRef.current.x}px, ${panRef.current.y}px, 0) scale(${zoomRef.current})`
    }
  }, []) as unknown as React.RefCallback<HTMLDivElement> & {
    current: HTMLDivElement | null
  }

  Object.defineProperty(canvasLayerRef, 'current', {
    get() {
      return canvasLayerNodeRef.current
    },
    set(node: HTMLDivElement | null) {
      canvasLayerNodeRef.current = node
      if (node) {
        node.style.transform = `translate3d(${panRef.current.x}px, ${panRef.current.y}px, 0) scale(${zoomRef.current})`
      }
    },
    configurable: true,
  })

  const zoomBadgeRef = useCallback((node: HTMLSpanElement | null) => {
    zoomBadgeNodeRef.current = node
    if (node) {
      node.textContent = `${Math.round(zoomRef.current * 100)}%`
    }
  }, []) as unknown as React.RefCallback<HTMLSpanElement> & {
    current: HTMLSpanElement | null
  }

  Object.defineProperty(zoomBadgeRef, 'current', {
    get() {
      return zoomBadgeNodeRef.current
    },
    set(node: HTMLSpanElement | null) {
      zoomBadgeNodeRef.current = node
      if (node) {
        node.textContent = `${Math.round(zoomRef.current * 100)}%`
      }
    },
    configurable: true,
  })

  const saveLayout = useCallback(() => {
    if (docId) {
      try {
        const key = `${storagePrefix}${docId}`
        const saved = storage.getItem(key)
        const parsed = saved ? JSON.parse(saved) : {}
        storage.setItem(
          key,
          JSON.stringify({
            ...parsed,
            zoom: zoomRef.current,
            pan: panRef.current,
          })
        )
      } catch {
        return
      }
    }
  }, [docId, storagePrefix, storage])

  const saveLayoutRef = useRef(saveLayout)
  saveLayoutRef.current = saveLayout

  const setPanAndZoom = useCallback(
    (nextPan: { x: number; y: number }, nextZoom: number) => {
      panRef.current = nextPan
      zoomRef.current = nextZoom
      applyCanvasTransform(nextPan, nextZoom)
      saveLayout()
    },
    [applyCanvasTransform, saveLayout]
  )

  const handleZoomIn = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    const centerX = rect.width / 2
    const centerY = rect.height / 2

    const currentZoom = zoomRef.current
    const currentPan = panRef.current
    const newZoom = Math.min(currentZoom * 1.15, 12)

    const worldX = (centerX - currentPan.x) / currentZoom
    const worldY = (centerY - currentPan.y) / currentZoom

    const newPanX = centerX - worldX * newZoom
    const newPanY = centerY - worldY * newZoom

    setPanAndZoom({ x: newPanX, y: newPanY }, newZoom)
  }, [setPanAndZoom])

  const handleZoomOut = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    const centerX = rect.width / 2
    const centerY = rect.height / 2

    const currentZoom = zoomRef.current
    const currentPan = panRef.current
    const newZoom = Math.max(currentZoom * 0.85, 0.1)

    const worldX = (centerX - currentPan.x) / currentZoom
    const worldY = (centerY - currentPan.y) / currentZoom

    const newPanX = centerX - worldX * newZoom
    const newPanY = centerY - worldY * newZoom

    setPanAndZoom({ x: newPanX, y: newPanY }, newZoom)
  }, [setPanAndZoom])

  const handleResetView = useCallback(() => {
    setPanAndZoom(initialPan, initialZoom)
  }, [initialPan, initialZoom, setPanAndZoom])

  const handleMouseDownBackground = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 && e.button !== 1) return
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      origPanX: panRef.current.x,
      origPanY: panRef.current.y,
    }
    isPanningRef.current = true
    if (viewportRef.current) {
      viewportRef.current.dataset.panning = 'true'
      viewportRef.current.classList.add('cursor-grabbing')
      viewportRef.current.classList.remove('cursor-grab')
    }
  }, [])

  useMountEffect(() => {
    applyCanvasTransformRef.current(panRef.current, zoomRef.current)

    const viewport = viewportRef.current
    if (!viewport) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()

      const rect = viewport.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      const currentZoom = zoomRef.current
      const currentPan = panRef.current

      if (e.ctrlKey || e.metaKey) {
        const zoomFactor = Math.exp(-e.deltaY * 0.0025)
        const newZoom = Math.min(Math.max(currentZoom * zoomFactor, 0.1), 12)

        const worldX = (mouseX - currentPan.x) / currentZoom
        const worldY = (mouseY - currentPan.y) / currentZoom

        const newPanX = mouseX - worldX * newZoom
        const newPanY = mouseY - worldY * newZoom

        zoomRef.current = newZoom
        panRef.current = { x: newPanX, y: newPanY }
      } else {
        const newPanX = currentPan.x - e.deltaX
        const newPanY = currentPan.y - e.deltaY
        panRef.current = { x: newPanX, y: newPanY }
      }

      if (wheelRafRef.current === null) {
        wheelRafRef.current = requestAnimationFrame(() => {
          applyCanvasTransformRef.current(panRef.current, zoomRef.current)
          wheelRafRef.current = null
        })
      }

      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
      }
      idleTimerRef.current = setTimeout(() => {
        saveLayoutRef.current()
        idleTimerRef.current = null
      }, 150)
    }

    const handleWindowMouseMove = (e: MouseEvent) => {
      if (!isPanningRef.current || !dragStartRef.current) return
      const dx = e.clientX - dragStartRef.current.x
      const dy = e.clientY - dragStartRef.current.y
      panRef.current = {
        x: dragStartRef.current.origPanX + dx,
        y: dragStartRef.current.origPanY + dy,
      }

      if (mouseMoveRafRef.current === null) {
        mouseMoveRafRef.current = requestAnimationFrame(() => {
          applyCanvasTransformRef.current(panRef.current, zoomRef.current)
          mouseMoveRafRef.current = null
        })
      }
    }

    const handleWindowMouseUp = () => {
      if (!isPanningRef.current) return
      isPanningRef.current = false
      if (viewportRef.current) {
        delete viewportRef.current.dataset.panning
        viewportRef.current.classList.remove('cursor-grabbing')
        viewportRef.current.classList.add('cursor-grab')
      }
      dragStartRef.current = null
      if (mouseMoveRafRef.current !== null) {
        cancelAnimationFrame(mouseMoveRafRef.current)
        mouseMoveRafRef.current = null
      }
      saveLayoutRef.current()
    }

    const unregisterFlush = registerLocalUserFlush(() =>
      saveLayoutRef.current()
    )
    viewport.addEventListener('wheel', handleWheel, { passive: false })
    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('mouseup', handleWindowMouseUp)

    return () => {
      unregisterFlush()
      saveLayoutRef.current()
      viewport.removeEventListener('wheel', handleWheel)
      window.removeEventListener('mousemove', handleWindowMouseMove)
      window.removeEventListener('mouseup', handleWindowMouseUp)
      if (wheelRafRef.current !== null) {
        cancelAnimationFrame(wheelRafRef.current)
        wheelRafRef.current = null
      }
      if (mouseMoveRafRef.current !== null) {
        cancelAnimationFrame(mouseMoveRafRef.current)
        mouseMoveRafRef.current = null
      }
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
        idleTimerRef.current = null
      }
    }
  })

  return {
    viewportRef,
    canvasLayerRef,
    zoomBadgeRef,
    isPanning: false,
    initialPan: initialPanValue,
    initialZoom: initialZoomValue,
    panRef,
    zoomRef,
    handleZoomIn,
    handleZoomOut,
    handleResetView,
    handleMouseDownBackground,
    setPanAndZoom,
    applyCanvasTransform,
  }
}
