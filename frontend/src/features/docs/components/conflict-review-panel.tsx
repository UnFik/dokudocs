import { useState } from 'react'
import { useMountEffect } from '@/hooks/use-mount-effect'
import { Button } from '@/components/ui/button'
import type { ReviewModel } from '../lib/collaboration-review'

export type ConflictReviewActions = {
  copyText: (text: string) => Promise<void>
  discardLocal: () => Promise<void>
  dismissHeld: () => Promise<void>
  resolveCommand: (
    kind: 'delete' | 'move',
    commandID: string,
    choice: 'force' | 'cancel'
  ) => Promise<void>
  exportLocal: () => Promise<void>
}

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; model: ReviewModel }

const reasonLabel = {
  'node-deleted': 'deleted on the server',
  'parent-deleted': 'its parent was deleted',
  'concurrent-edit': 'edited on the server too',
} as const

export function ConflictReviewPanel({
  load,
  actions,
}: {
  load: () => Promise<ReviewModel>
  actions: ConflictReviewActions
}) {
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  async function refresh() {
    setState({ phase: 'loading' })
    try {
      setState({ phase: 'ready', model: await load() })
    } catch (cause) {
      setState({
        phase: 'error',
        message:
          cause instanceof Error ? cause.message : 'Could not load the review',
      })
    }
  }

  useMountEffect(() => {
    void refresh()
  })

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setActionError('')
    try {
      await action()
      setConfirmingDiscard(false)
      await refresh()
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : 'That action failed'
      )
    } finally {
      setBusy(false)
    }
  }

  if (state.phase === 'loading')
    return (
      <p role='status' className='px-4 py-2 text-xs text-muted-foreground'>
        Loading the review…
      </p>
    )
  if (state.phase === 'error')
    return (
      <div className='flex items-center gap-3 border-b px-4 py-2'>
        <p role='alert' className='text-sm text-destructive'>
          {state.message}. Check your connection, then try again.
        </p>
        <Button
          size='sm'
          variant='outline'
          className='ml-auto shrink-0'
          onClick={() => void refresh()}
        >
          Try again
        </Button>
      </div>
    )

  const { model } = state
  const isEmpty =
    !model.held.length && !model.commands.length && !model.pendingDiff.length

  return (
    <section
      aria-label='Review local changes'
      className='flex max-h-[50vh] flex-col gap-4 overflow-auto border-b px-4 py-3'
    >
      {isEmpty ? (
        <p className='text-sm text-muted-foreground'>Nothing left to review.</p>
      ) : null}
      {!model.canEdit && !isEmpty ? (
        <p className='text-xs text-muted-foreground'>
          You no longer have edit access to this document. You can read the
          comparison and export your changes, but not copy them back.
        </p>
      ) : null}
      {actionError ? (
        <p role='alert' className='text-sm text-destructive'>
          {actionError}
        </p>
      ) : null}

      {model.commands.map((command) => (
        <div key={command.commandID} className='flex flex-col gap-2'>
          <p className='font-mono text-[11px] text-muted-foreground'>
            {command.kind === 'delete' ? 'delete block' : 'move block'}{' '}
            {command.nodeID.slice(0, 8)}
          </p>
          <p className='text-sm'>{command.explanation.message}</p>
          <div className='flex flex-wrap gap-2'>
            {command.explanation.canForce ? (
              <Button
                size='sm'
                variant='outline'
                disabled={busy || !model.canEdit}
                onClick={() =>
                  void run(() =>
                    actions.resolveCommand(
                      command.kind,
                      command.commandID,
                      'force'
                    )
                  )
                }
              >
                Delete anyway
              </Button>
            ) : null}
            <Button
              size='sm'
              variant='outline'
              disabled={busy}
              onClick={() =>
                void run(() =>
                  actions.resolveCommand(
                    command.kind,
                    command.commandID,
                    'cancel'
                  )
                )
              }
            >
              {command.kind === 'delete' ? 'Keep the block' : 'Cancel the move'}
            </Button>
          </div>
        </div>
      ))}

      {model.held.map((edit) => (
        <div key={edit.nodeID} className='flex flex-col gap-2'>
          <p className='font-mono text-[11px] text-muted-foreground'>
            {edit.local.type} {edit.nodeID.slice(0, 8)}:{' '}
            {reasonLabel[edit.reason]}
          </p>
          <div className='grid gap-2 sm:grid-cols-2'>
            <VersionBlock label='Your version' text={edit.local.content} />
            <VersionBlock
              label='Server version'
              text={edit.canonical ? edit.canonical.content : null}
            />
          </div>
          <div>
            <Button
              size='sm'
              variant='outline'
              disabled={busy || !model.canEdit}
              onClick={() =>
                void run(() => actions.copyText(edit.local.content))
              }
            >
              Copy your version
            </Button>
          </div>
        </div>
      ))}

      {model.pendingDiff.map((item) => (
        <div key={item.nodeID} className='flex flex-col gap-2'>
          <p className='font-mono text-[11px] text-muted-foreground'>
            {item.type} {item.nodeID.slice(0, 8)}: {item.kind}
          </p>
          <div className='grid gap-2 sm:grid-cols-2'>
            <VersionBlock label='Your version' text={item.local} />
            <VersionBlock label='Server version' text={item.canonical} />
          </div>
          {item.local !== null ? (
            <div>
              <Button
                size='sm'
                variant='outline'
                disabled={busy || !model.canEdit}
                onClick={() => void run(() => actions.copyText(item.local!))}
              >
                Copy your version
              </Button>
            </div>
          ) : null}
        </div>
      ))}

      <div className='flex flex-wrap items-center gap-2 border-t pt-3'>
        {model.held.length ? (
          <Button
            size='sm'
            variant='outline'
            disabled={busy}
            onClick={() => void run(actions.dismissHeld)}
          >
            Keep server version
          </Button>
        ) : null}
        <Button
          size='sm'
          variant='outline'
          disabled={busy}
          onClick={() => void run(actions.exportLocal)}
        >
          Export local changes
        </Button>
        {confirmingDiscard ? (
          <>
            <p className='text-xs text-muted-foreground'>
              This removes every unsynced change stored on this device.
            </p>
            <Button
              size='sm'
              variant='outline'
              className='text-destructive'
              disabled={busy}
              onClick={() => void run(actions.discardLocal)}
            >
              Discard on this device
            </Button>
            <Button
              size='sm'
              variant='ghost'
              disabled={busy}
              onClick={() => setConfirmingDiscard(false)}
            >
              Keep them
            </Button>
          </>
        ) : (
          <Button
            size='sm'
            variant='outline'
            className='text-destructive'
            disabled={busy}
            onClick={() => setConfirmingDiscard(true)}
          >
            Discard local changes
          </Button>
        )}
      </div>
    </section>
  )
}

function VersionBlock({ label, text }: { label: string; text: string | null }) {
  return (
    <div className='min-w-0 border p-2'>
      <p className='mb-1 text-xs text-muted-foreground'>{label}</p>
      {text === null ? (
        <p className='text-sm text-muted-foreground'>Not in this version.</p>
      ) : (
        <pre className='font-sans text-sm break-words whitespace-pre-wrap'>
          {text}
        </pre>
      )}
    </div>
  )
}
