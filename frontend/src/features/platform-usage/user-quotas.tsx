import { useState } from 'react'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiFetch } from '@/lib/api-client'
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
import { Button } from '@/components/ui/button'

const quotaSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  workspaceId: z.string(),
  workspace: z.string(),
  plan: z.string(),
  used: z.number(),
  limit: z.number(),
})
type Quota = z.infer<typeof quotaSchema>
const quotasSchema = z.object({ quotas: z.array(quotaSchema) })

const number = (n: number) => n.toLocaleString('en-US')

/** What each User has spent in each workspace this month, with a reset for a spent or mistaken allowance. */
export function UserQuotas() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [target, setTarget] = useState<Quota | null>(null)
  const quotas = useQuery({
    queryKey: ['platform-ai-quotas'],
    queryFn: async ({ signal }) =>
      quotasSchema.parse(
        await apiFetch('/api/v1/platform/ai/quotas', { signal })
      ).quotas,
    retry: false,
  })
  const reset = useMutation({
    mutationFn: (q: Quota) =>
      apiFetch(
        `/api/v1/platform/ai/quotas/${q.workspaceId}/${q.userId}/reset`,
        { method: 'POST' }
      ),
    onSuccess: async () => {
      setTarget(null)
      await queryClient.invalidateQueries({ queryKey: ['platform-ai-quotas'] })
    },
  })
  const needle = search.trim().toLowerCase()
  const rows = (quotas.data ?? []).filter(
    (q) =>
      !needle ||
      [q.name, q.email, q.workspace].some((v) =>
        v.toLowerCase().includes(needle)
      )
  )
  return (
    <section aria-labelledby='user-quotas' className='space-y-3'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div className='space-y-1'>
          <h2 id='user-quotas' className='text-lg font-medium'>
            Usage per user
          </h2>
          <p className='text-sm text-muted-foreground'>
            Tokens each User has used in each workspace this month, against the
            workspace&apos;s Plan limit. A reset gives the allowance back until
            the month ends; the usage stays in the tables below.
          </p>
        </div>
        <input
          type='search'
          aria-label='Search users'
          placeholder='Search user or workspace'
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className='h-9 w-56 rounded-sm border border-input bg-card px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
        />
      </div>
      {quotas.isPending ? (
        <p role='status' className='text-sm text-muted-foreground'>
          Reading the usage per user…
        </p>
      ) : quotas.isError ? (
        <div role='alert' className='space-y-2 text-sm'>
          <p>Could not read the usage per user.</p>
          <Button variant='outline' onClick={() => void quotas.refetch()}>
            Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className='text-sm text-muted-foreground'>
          {needle
            ? 'No user matches this search.'
            : 'Nobody has used the models this month.'}
        </p>
      ) : (
        <div className='overflow-x-auto'>
          <table className='w-full text-left text-sm'>
            <thead className='text-xs text-muted-foreground'>
              <tr className='border-b'>
                <th className='py-2 pr-3 font-normal'>User</th>
                <th className='py-2 pr-3 font-normal'>Workspace</th>
                <th className='py-2 pr-3 text-right font-normal'>Used</th>
                <th className='py-2 pr-3 text-right font-normal'>Limit</th>
                <th className='py-2 pr-3 text-right font-normal'>Share</th>
                <th className='py-2 text-right font-normal'>
                  <span className='sr-only'>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((q) => (
                <tr key={`${q.workspaceId}/${q.userId}`} className='border-b'>
                  <td className='py-2 pr-3'>
                    {q.name || q.email}
                    <span className='ml-2 text-xs text-muted-foreground'>
                      {q.email}
                    </span>
                  </td>
                  <td className='py-2 pr-3'>
                    {q.workspace}
                    <span className='ml-2 font-mono text-xs text-muted-foreground'>
                      {q.plan.toLowerCase()}
                    </span>
                  </td>
                  <td className='py-2 pr-3 text-right font-mono text-xs tabular-nums'>
                    {number(q.used)}
                  </td>
                  <td className='py-2 pr-3 text-right font-mono text-xs tabular-nums'>
                    {number(q.limit)}
                  </td>
                  <td className='py-2 pr-3 text-right font-mono text-xs tabular-nums'>
                    {Math.round((q.used / q.limit) * 100)}%
                  </td>
                  <td className='py-2 text-right'>
                    <Button
                      size='sm'
                      variant='outline'
                      aria-label={`Reset ${q.name || q.email} in ${q.workspace}`}
                      onClick={() => setTarget(q)}
                    >
                      Reset
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AlertDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTarget(null)
            reset.reset()
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset this allowance?</AlertDialogTitle>
            <AlertDialogDescription>
              {target
                ? `${target.name || target.email} gets the full ${number(target.limit)} tokens back in ${target.workspace} until the month ends.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {reset.isError ? (
            <p role='alert' className='text-sm text-destructive'>
              {reset.error instanceof ApiError
                ? reset.error.title
                : 'Could not reset the allowance. Try again.'}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={reset.isPending}
              onClick={(event) => {
                event.preventDefault()
                if (target) reset.mutate(target)
              }}
            >
              Reset allowance
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
