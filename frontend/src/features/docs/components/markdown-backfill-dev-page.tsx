import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  backfillMarkdownBodies,
  type MarkdownBackfillProgress,
} from '@/features/docs/lib/backfill-markdown-bodies'
import { useWorkspaces } from '@/features/workspaces/hooks/use-workspaces'

export default function MarkdownBackfillDevPage() {
  const { workspaces, isLoading, error } = useWorkspaces()
  const ownerWorkspaces = workspaces.filter(
    (workspace) => workspace.role === 'owner' || workspace.role === 'admin'
  )
  const [selectedID, setSelectedID] = useState('')
  const [progress, setProgress] = useState<MarkdownBackfillProgress>()
  const workspace =
    ownerWorkspaces.find((item) => item.id === selectedID) ?? ownerWorkspaces[0]
  const mutation = useMutation({
    mutationFn: () => {
      if (!workspace) throw new Error('Workspace unavailable')
      return backfillMarkdownBodies(workspace.id, (nextProgress) =>
        setProgress(nextProgress)
      )
    },
  })

  return (
    <main className='mx-auto flex w-full max-w-3xl flex-col gap-5 p-6'>
      <header className='space-y-1'>
        <h1 className='text-xl font-semibold'>Markdown AST backfill</h1>
        <p className='text-sm text-muted-foreground'>
          Dev tool: import active Markdown documents into the canonical AST and
          initial Yjs state. Each run skips documents that are already
          initialized, so a failed run can be resumed safely.
        </p>
      </header>

      {isLoading ? <p>Loading workspaces…</p> : null}
      {error ? (
        <p role='alert'>Could not load workspaces: {String(error)}</p>
      ) : null}
      {!isLoading && ownerWorkspaces.length === 0 ? (
        <p>No workspace where you are an owner or admin.</p>
      ) : null}

      {workspace ? (
        <label className='flex flex-col gap-2 text-sm'>
          Workspace
          <select
            className='h-9 rounded-md border bg-background px-3'
            disabled={mutation.isPending}
            value={workspace.id}
            onChange={(event) => {
              setSelectedID(event.target.value)
              setProgress(undefined)
              mutation.reset()
            }}
          >
            {ownerWorkspaces.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.role})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div>
        <Button
          disabled={!workspace || mutation.isPending}
          onClick={() => {
            setProgress(undefined)
            mutation.reset()
            mutation.mutate()
          }}
        >
          {mutation.isPending ? 'Backfilling…' : 'Backfill active Markdown'}
        </Button>
      </div>

      {progress ? (
        <p aria-live='polite' className='text-sm'>
          {progress.completed}/{progress.total}: {progress.title}
        </p>
      ) : null}
      {mutation.error ? (
        <p role='alert'>Backfill stopped: {String(mutation.error)}</p>
      ) : null}
      {mutation.data ? (
        <section aria-live='polite' className='space-y-2 rounded-md border p-4'>
          <h2 className='font-medium'>Backfill finished</h2>
          <p className='text-sm'>
            {mutation.data.total} Markdown documents:{' '}
            {mutation.data.initialized} initialized,{' '}
            {mutation.data.alreadyInitialized} already initialized,{' '}
            {mutation.data.failed.length} failed.
          </p>
          {mutation.data.failed.length ? (
            <ul className='list-disc space-y-1 pl-5 text-sm'>
              {mutation.data.failed.map((item) => (
                <li key={item.id}>
                  {item.title}: {item.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </main>
  )
}
