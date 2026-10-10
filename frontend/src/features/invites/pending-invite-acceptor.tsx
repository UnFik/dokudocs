import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { ApiError } from '@/lib/api-client'
import { acceptInvite } from '@/lib/domain-api'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { forgetInvite, recallInvite } from './pending-invite'

function codeOf(error: unknown) {
  if (!(error instanceof ApiError)) return undefined
  const data = error.data
  return data && typeof data === 'object' && 'code' in data
    ? String(data.code)
    : undefined
}

/**
 * Uses the invitation that waited while the person signed in, signed up or
 * verified their email. Mounted once, inside the signed-in app.
 */
export function PendingInviteAcceptor() {
  const queryClient = useQueryClient()
  const email = useAuthStore((state) => state.auth.user?.email)
  const started = useRef(false)
  const [wrongAccount, setWrongAccount] = useState(false)

  useEffect(() => {
    const token = recallInvite()
    if (!token || started.current) return
    started.current = true
    void (async () => {
      try {
        const workspaceId = await acceptInvite(token)
        forgetInvite()
        await queryClient.invalidateQueries({ queryKey: ['workspaces'] })
        useDokudocsStore.getState().setActiveOrgId(workspaceId)
        toast.success('You joined the workspace.')
      } catch (error) {
        const code = codeOf(error)
        if (code === 'email_not_verified') return // the app sends them to verify; the link waits
        if (code === 'invite_email_mismatch') return setWrongAccount(true)
        if (error instanceof ApiError && error.status === 404) {
          forgetInvite()
          toast.error('This invitation is no longer valid. Ask for a new one.')
          return
        }
        started.current = false
        toast.error('Could not join the workspace. Reload to try again.')
      }
    })()
  }, [queryClient])

  return (
    <AlertDialog open={wrongAccount} onOpenChange={setWrongAccount}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            This invitation is for another email
          </AlertDialogTitle>
          <AlertDialogDescription>
            You are signed in as {email}. Sign out and sign in with the address
            the invitation was sent to; it will be accepted then.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={forgetInvite}>
            Drop the invitation
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => useAuthStore.getState().auth.reset()}
          >
            Sign out
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
