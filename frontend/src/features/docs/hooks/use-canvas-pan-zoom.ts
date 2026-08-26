import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasLayerRef = useRef<HTMLDivElement>(null)
  const zoomBadgeRef = useRef<HTMLSpanElement>(null)

  const [isPanning, setIsPanning] = useState(false)
  const isPanningRef = useRef(false)

  const initialPanValue = useMemo(() => {
    if (docId) {
      try {
        const saved = localStorage.getItem(`${storagePrefix}${docId}`)
        if (saved) {
          const parsed = JSON.parse(saved)
          if (parsed.pan && typeof parsed.pan.x === 'number') {
            return parsed.pan
          }
        }
      } catch (e) {}
    }
    return initialPan
  }, [docId, storagePrefix, initialPan])

  const initialZoomValue = useMemo(() => {
    if (docId) {
      try {
        const saved = localStorage.getItem(`${storagePrefix}${docId}`)
        if (saved) {
          const parsed = JSON.parse(saved)
          if (typeof parsed.zoom === 'number') {
            return parsed.zoom
          }
        }
      } catch (e) {}
    }
    return initialZoom
  }, [docId, storagePrefix, initialZoom])

  const panRef = useRef<{ x: number; y: number }>(initialPanValue)
  const zoomRef = useRef<number>(initialZoomValue)

  const wheelRafRef = useRef<number | null>(null)
  const mouseMoveRafRef = useRef<number | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragStartRef = useRef<{ x: number; y: number; origPanX: number; origPanY: number } | null>(null)

  const applyCanvasTransform = useCallback(
    (currentPan: { x: number; y: number }, currentZoom: number) => {
      if (canvasLayerRef.current) {
        canvasLayerRef.current.style.transform = `translate3d(${currentPan.x}px, ${currentPan.y}px, 0) scale(${currentZoom})`
      }
      if (zoomBadgeRef.current) {
        zoomBadgeRef.current.textContent = `${Math.round(currentZoom * 100)}%`
      }
    },
    []
  )

  const saveLayout = useCallback(() => {
    if (docId) {
      try {
        const key = `${storagePrefix}${docId}`
        const saved = localStorage.getItem(key)
        const parsed = saved ? JSON.parse(saved) : {}
        localStorage.setItem(
          key,
          JSON.stringify({
            ...parsed,
            zoom: zoomRef.current,
            pan: panRef.current,
          })
        )
      } catch (e) {}
    }
  }, [docId, storagePrefix])

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
    const newZoom = Math.min(currentZoom * 1.15, 3)

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
    const newZoom = Math.max(currentZoom * 0.85, 0.2)

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
    setIsPanning(true)
  }, [])

  useEffect(() => {
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
        const newZoom = Math.min(Math.max(currentZoom * zoomFactor, 0.2), 3)

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
          applyCanvasTransform(panRef.current, zoomRef.current)
          wheelRafRef.current = null
        })
      }

      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
      }
      idleTimerRef.current = setTimeout(() => {
        saveLayout()
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
          applyCanvasTransform(panRef.current, zoomRef.current)
          mouseMoveRafRef.current = null
        })
      }
    }

    const handleWindowMouseUp = () => {
      if (!isPanningRef.current) return
      isPanningRef.current = false
      setIsPanning(false)
      dragStartRef.current = null
      if (mouseMoveRafRef.current !== null) {
        cancelAnimationFrame(mouseMoveRafRef.current)
        mouseMoveRafRef.current = null
      }
      saveLayout()
    }

    viewport.addEventListener('wheel', handleWheel, { passive: false })
    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('mouseup', handleWindowMouseUp)

    return () => {
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
  }, [applyCanvasTransform, saveLayout])

  return {
    viewportRef,
    canvasLayerRef,
    zoomBadgeRef,
    isPanning,
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
