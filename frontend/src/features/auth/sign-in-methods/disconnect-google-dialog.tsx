import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ApiError } from '@/lib/api-client'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { unlinkIdentityApi } from '../api/auth-api'

/**
 * Asks before the Google account stops being a way to sign in. With no password
 * Google is the only way in, so the dialog offers the set-password link instead
 * of a button the server would refuse.
 */
export function DisconnectGoogleDialog({
  email,
  hasPassword,
  onDisconnected,
  onSetPassword,
}: {
  email: string
  hasPassword: boolean
  onDisconnected: () => unknown
  onSetPassword: () => void
}) {
  const [open, setOpen] = useState(false)
  const disconnect = useMutation({
    mutationFn: () => unlinkIdentityApi('google'),
    onSuccess: async () => {
      await onDisconnected()
      setOpen(false)
    },
    retry: false,
  })

  function change(next: boolean) {
    setOpen(next)
    if (!next) disconnect.reset()
  }

  return (
    <>
      <Button variant='outline' onClick={() => change(true)}>
        Disconnect Google
      </Button>
      <AlertDialog open={open} onOpenChange={change}>
        <AlertDialogContent>
          {hasPassword ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect Google?</AlertDialogTitle>
                <AlertDialogDescription>
                  You will no longer sign in with {email}. Your account and
                  documents stay as they are. Dokudocs stays in your Google
                  account&apos;s connected apps until you remove it there.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {disconnect.isError && (
                <p role='alert' className='text-sm text-destructive'>
                  {disconnect.error instanceof ApiError &&
                  disconnect.error.title
                    ? disconnect.error.title
                    : 'Could not disconnect Google.'}
                </p>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <Button
                  variant='destructive'
                  disabled={disconnect.isPending}
                  onClick={() => disconnect.mutate()}
                >
                  Disconnect
                </Button>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Set a password first</AlertDialogTitle>
                <AlertDialogDescription>
                  Google is the only way you sign in. Without a password,
                  disconnecting it would lock you out of this account.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <Button
                  onClick={() => {
                    change(false)
                    onSetPassword()
                  }}
                >
                  Send set-password link
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
