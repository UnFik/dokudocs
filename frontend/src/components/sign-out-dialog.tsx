import { useState } from 'react'
import { useNavigate, useLocation } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { getLocalUserScope } from '@/lib/local-user-data'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  discardLocalEdits,
  exportUnsyncedDocuments,
  flushLocalEditsForLogout,
  type UnsyncedDocument,
} from '@/features/docs/lib/collaboration-logout'

interface SignOutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Unsynced = { documents: UnsyncedDocument[]; checkFailed: boolean }

export function SignOutDialog({ open, onOpenChange }: SignOutDialogProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { auth } = useAuthStore()
  const [busy, setBusy] = useState(false)
  const [unsynced, setUnsynced] = useState<Unsynced | null>(null)
  const [exportMessage, setExportMessage] = useState('')

  const finishSignOut = () => {
    auth.reset()
    setUnsynced(null)
    // Preserve current location for redirect after sign-in
    const currentPath = location.href
    navigate({
      to: '/sign-in',
      search: { redirect: currentPath },
      replace: true,
    })
  }

  // ADR 0007: flush pending edits and clear this account's local document
  // data; edits that cannot be flushed are never dropped without asking.
  const handleSignOut = async () => {
    const userID = getLocalUserScope().userId
    if (!userID) {
      finishSignOut()
      return
    }
    setBusy(true)
    try {
      const { unsynced: left } = await flushLocalEditsForLogout({
        userID,
        token: () => auth.accessToken,
      })
      if (left.length > 0) {
        setUnsynced({ documents: left, checkFailed: false })
        return
      }
      finishSignOut()
    } catch {
      setUnsynced({ documents: [], checkFailed: true })
    } finally {
      setBusy(false)
    }
  }

  const discardAndSignOut = async () => {
    const userID = getLocalUserScope().userId
    setBusy(true)
    try {
      if (userID) await discardLocalEdits(userID)
      finishSignOut()
    } catch {
      setExportMessage(
        'Local data could not be cleared. You are still signed in.'
      )
    } finally {
      setBusy(false)
    }
  }

  const exportEdits = async () => {
    const userID = getLocalUserScope().userId
    if (!userID || !unsynced) return
    setBusy(true)
    try {
      const count = await exportUnsyncedDocuments(userID, unsynced.documents)
      setExportMessage(
        count > 0
          ? `Exported ${count} document${count === 1 ? '' : 's'}.`
          : 'Nothing could be exported.'
      )
    } catch {
      setExportMessage(
        'Export needs a connection and read access. Nothing was exported.'
      )
    } finally {
      setBusy(false)
    }
  }

  const closeAll = (next: boolean) => {
    if (!next) {
      setUnsynced(null)
      setExportMessage('')
    }
    onOpenChange(next)
  }

  const edits =
    unsynced?.documents.reduce((sum, doc) => sum + doc.count, 0) ?? 0
  const canExport =
    unsynced !== null &&
    !unsynced.checkFailed &&
    (typeof navigator === 'undefined' || navigator.onLine) &&
    unsynced.documents.some((doc) => doc.workspaceID)

  return (
    <>
      <ConfirmDialog
        open={open && unsynced === null}
        onOpenChange={closeAll}
        title='Sign out'
        desc='Are you sure you want to sign out? You will need to sign in again to access your account.'
        confirmText='Sign out'
        destructive
        isLoading={busy}
        handleConfirm={() => void handleSignOut()}
        className='sm:max-w-sm'
      />
      <ConfirmDialog
        open={open && unsynced !== null}
        onOpenChange={closeAll}
        title='Edits are not synced'
        desc={
          unsynced?.checkFailed
            ? 'We could not check this device for unsynced edits. Signing out may discard them.'
            : `${edits} edit${edits === 1 ? ' is' : 's are'} on this device and not synced to the server. Signing out discards them.`
        }
        confirmText='Discard and sign out'
        destructive
        isLoading={busy}
        handleConfirm={() => void discardAndSignOut()}
        className='sm:max-w-md'
      >
        {canExport ? (
          <Button
            type='button'
            variant='outline'
            disabled={busy}
            onClick={() => void exportEdits()}
          >
            Export unsynced edits
          </Button>
        ) : null}
        {exportMessage ? (
          <p role='status' className='text-sm text-muted-foreground'>
            {exportMessage}
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  )
}
