import { useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import LoadingBar, { type LoadingBarRef } from 'react-top-loading-bar'
import { useMountEffect } from '@/hooks/use-mount-effect'

export function NavigationProgress() {
  const ref = useRef<LoadingBarRef>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isStartedRef = useRef(false)
  const router = useRouter()

  useMountEffect(() => {
    const unsubBeforeLoad = router.subscribe('onBeforeLoad', () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
      timerRef.current = setTimeout(() => {
        isStartedRef.current = true
        ref.current?.continuousStart()
      }, 150)
    })

    const unsubResolved = router.subscribe('onResolved', () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      if (isStartedRef.current) {
        ref.current?.complete()
        isStartedRef.current = false
      }
    })

    return () => {
      unsubBeforeLoad()
      unsubResolved()
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  })

  return (
    <LoadingBar
      color='var(--muted-foreground)'
      ref={ref}
      shadow={true}
      height={2}
    />
  )
}
