import { useAuthStore } from '@/stores/auth-store'
import { SessionPending } from './session-feedback'

export function SessionBoundary({
  children,
  allowOffline = false,
}: {
  children: React.ReactNode
  allowOffline?: boolean
}) {
  const { status, revision } = useAuthStore((state) => state.auth)
  if (status !== 'authenticated' && !(allowOffline && status === 'offline'))
    return <SessionPending />
  return (
    <div key={revision} className='contents'>
      {children}
    </div>
  )
}
