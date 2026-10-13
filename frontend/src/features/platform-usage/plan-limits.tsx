import { useState } from 'react'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiFetch } from '@/lib/api-client'
import { Button } from '@/components/ui/button'

const limitsSchema = z.object({
  limits: z.array(z.object({ plan: z.string(), monthlyTokens: z.number() })),
})

const inputClass =
  'h-9 rounded-sm border border-input bg-card px-2 font-mono text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** What each Plan lets a User spend in one workspace per month. A Plan without a row gets the Free limit. */
export function PlanLimits() {
  const queryClient = useQueryClient()
  const limits = useQuery({
    queryKey: ['platform-ai-limits'],
    queryFn: async ({ signal }) =>
      limitsSchema.parse(
        await apiFetch('/api/v1/platform/ai/limits', { signal })
      ).limits,
    retry: false,
  })
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [newPlan, setNewPlan] = useState('')
  const [newTokens, setNewTokens] = useState('')
  const save = useMutation({
    mutationFn: ({ plan, tokens }: { plan: string; tokens: string }) =>
      apiFetch(`/api/v1/platform/ai/limits/${encodeURIComponent(plan)}`, {
        method: 'PUT',
        body: JSON.stringify({ monthlyTokens: Number(tokens) }),
      }),
    onSuccess: async (_result, { plan }) => {
      setDraft(({ [plan]: _saved, ...rest }) => rest)
      await queryClient.invalidateQueries({ queryKey: ['platform-ai-limits'] })
    },
  })
  return (
    <section aria-labelledby='plan-limits' className='space-y-3'>
      <div className='space-y-1'>
        <h2 id='plan-limits' className='text-lg font-medium'>
          Usage limits
        </h2>
        <p className='text-sm text-muted-foreground'>
          Tokens one User may use in one workspace per month, by the
          workspace&apos;s Plan. A Plan with no limit here gets the Free limit.
        </p>
      </div>
      {limits.isPending ? (
        <p role='status' className='text-sm text-muted-foreground'>
          Reading the limits…
        </p>
      ) : limits.isError ? (
        <div role='alert' className='space-y-2 text-sm'>
          <p>Could not read the usage limits.</p>
          <Button variant='outline' onClick={() => void limits.refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <ul className='divide-y border-y'>
          {limits.data.map((limit) => (
            <li
              key={limit.plan}
              className='flex flex-wrap items-center gap-3 py-2'
            >
              <span className='w-28 text-sm font-medium'>{limit.plan}</span>
              <input
                type='number'
                min={1}
                aria-label={`${limit.plan} tokens per month`}
                value={draft[limit.plan] ?? String(limit.monthlyTokens)}
                onChange={(event) =>
                  setDraft({ ...draft, [limit.plan]: event.target.value })
                }
                className={`${inputClass} w-40`}
              />
              <Button
                size='sm'
                variant='outline'
                aria-label={`Save ${limit.plan}`}
                disabled={save.isPending}
                onClick={() =>
                  save.mutate({
                    plan: limit.plan,
                    tokens: draft[limit.plan] ?? String(limit.monthlyTokens),
                  })
                }
              >
                Save
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className='flex flex-wrap items-center gap-3'
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate(
            { plan: newPlan.trim(), tokens: newTokens },
            {
              onSuccess: () => {
                setNewPlan('')
                setNewTokens('')
              },
            }
          )
        }}
      >
        <input
          type='text'
          aria-label='Plan name'
          placeholder='Plan name'
          maxLength={50}
          value={newPlan}
          onChange={(event) => setNewPlan(event.target.value)}
          className={`${inputClass} w-28 font-sans`}
        />
        <input
          type='number'
          min={1}
          aria-label='Tokens per month for the new Plan'
          placeholder='Tokens'
          value={newTokens}
          onChange={(event) => setNewTokens(event.target.value)}
          className={`${inputClass} w-40`}
        />
        <Button
          type='submit'
          size='sm'
          variant='outline'
          aria-label='Add Plan'
          disabled={save.isPending || !newPlan.trim() || !newTokens}
        >
          Add
        </Button>
      </form>
      {save.isError ? (
        <p role='alert' className='text-sm text-destructive'>
          {save.error instanceof ApiError
            ? save.error.title
            : 'Could not save the limit. Try again.'}
        </p>
      ) : null}
    </section>
  )
}
