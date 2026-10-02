import { useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'

export function SessionPending() {
  return (
    <div className='grid min-h-64 place-items-center' role='status'>
      Restoring your session...
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
