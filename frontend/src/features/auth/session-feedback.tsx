import { useRouter } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function SessionPending() {
  return (
    <div
      className='grid min-h-svh place-items-center'
      role='status'
      aria-label='Restoring your session'
    >
      <Loader2 className='size-6 animate-spin text-muted-foreground motion-reduce:animate-none' />
    </div>
  )
}
export function SessionError() {
  const router = useRouter()
  return (
    <div className='grid min-h-64 place-content-center gap-4 p-6' role='alert'>
      <p>Could not verify your session. Check your connection and try again.</p>
      <Button onClick={() => void router.invalidate()}>Retry</Button>
    </div>
  )
}
