import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { sendPasswordLinkApi } from '../api/auth-api'

const RESEND_AFTER_MS = 60_000

function sendMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 429) return 'Wait a minute before asking again.'
    if (error.status === 403)
      return 'Verify your email before changing your password.'
    if (error.status === 502)
      return 'The email could not be sent. Try again in a moment.'
    if (error.status === 503) return 'Email is not set up on this server.'
  }
  return 'Could not send the link. Try again later.'
}

/**
 * Confirms that a link to set or change the password goes to the account email,
 * then sends it. The password itself is typed on the page the link opens.
 */
export function PasswordLinkDialog({
  open,
  onOpenChange,
  email,
  hasPassword,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  email: string
  hasPassword: boolean
}) {
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const send = useMutation({
    mutationFn: sendPasswordLinkApi,
    onSuccess: () => {
      setNow(Date.now())
      setResendAt(Date.now() + RESEND_AFTER_MS)
    },
    retry: false,
  })

  useEffect(() => {
    if (!send.isSuccess) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [send.isSuccess, send.submittedAt])

  function change(next: boolean) {
    onOpenChange(next)
    if (!next) send.reset()
  }

  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000))
  const lifetime = 'It works once and expires in 1 hour.'

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {send.isSuccess
              ? 'Check your inbox'
              : hasPassword
                ? 'Change your password'
                : 'Set a password'}
          </DialogTitle>
          <DialogDescription>
            {send.isSuccess
              ? `We sent a link to ${email}. ${lifetime}`
              : `We'll email a link to ${email}. ${lifetime}`}
          </DialogDescription>
        </DialogHeader>
        {send.isError && (
          <p role='alert' className='text-sm text-destructive'>
            {sendMessage(send.error)}
          </p>
        )}
        <DialogFooter>
          <Button variant='outline' onClick={() => change(false)}>
            {send.isSuccess ? 'Close' : 'Cancel'}
          </Button>
          <Button
            disabled={send.isPending || (send.isSuccess && wait > 0)}
            onClick={() => send.mutate()}
          >
            {send.isSuccess
              ? wait > 0
                ? `Send again in ${wait}s`
                : 'Send again'
              : 'Send link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
