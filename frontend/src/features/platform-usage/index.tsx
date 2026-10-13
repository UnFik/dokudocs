import { useState } from 'react'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { ApiError, apiFetch } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { PlanLimits } from './plan-limits'
import { UserQuotas } from './user-quotas'

const total = {
  calls: z.number(),
  failed: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
}
const summarySchema = z.object({
  since: z.string(),
  overall: z.object(total),
  days: z.array(z.object({ day: z.string(), ...total })),
  models: z.array(
    z.object({ provider: z.string(), model: z.string(), ...total })
  ),
  purposes: z.array(
    z.object({ purpose: z.string(), feature: z.string(), ...total })
  ),
  topUsers: z.array(
    z.object({
      userId: z.string(),
      name: z.string(),
      email: z.string(),
      ...total,
    })
  ),
})
type Total = z.infer<typeof summarySchema>['overall']

const FEATURE: Record<string, string> = {
  chat_workspace: 'Chat in a workspace',
  chat_document: 'Chat in a document',
  indexing: 'Indexing documents',
  connection_test: 'Connection tests',
}
const PURPOSE: Record<string, string> = {
  answer: 'Answer',
  embedding: 'Embedding',
  agent: 'Agent',
}
const number = (n: number) => n.toLocaleString('en-US')

function Totals({ value }: { value: Total }) {
  return (
    <>
      <td className='py-2 pr-3 text-right font-mono text-xs tabular-nums'>
        {number(value.calls)}
      </td>
      <td className='py-2 pr-3 text-right font-mono text-xs tabular-nums'>
        {number(value.failed)}
      </td>
      <td className='py-2 pr-3 text-right font-mono text-xs tabular-nums'>
        {number(value.inputTokens)}
      </td>
      <td className='py-2 text-right font-mono text-xs tabular-nums'>
        {number(value.outputTokens)}
      </td>
    </>
  )
}

function Table({
  label,
  head,
  rows,
}: {
  label: string
  head: string
  rows: { key: string; name: React.ReactNode; value: Total }[]
}) {
  return (
    <section aria-label={label} className='space-y-2'>
      <h2 className='text-lg font-medium'>{label}</h2>
      <div className='overflow-x-auto'>
        <table className='w-full text-left text-sm'>
          <thead className='text-xs text-muted-foreground'>
            <tr className='border-b'>
              <th className='py-2 pr-3 font-normal'>{head}</th>
              <th className='py-2 pr-3 text-right font-normal'>Calls</th>
              <th className='py-2 pr-3 text-right font-normal'>Failed</th>
              <th className='py-2 pr-3 text-right font-normal'>Tokens in</th>
              <th className='py-2 text-right font-normal'>Tokens out</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className='border-b'>
                <td className='py-2 pr-3'>{row.name}</td>
                <Totals value={row.value} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** Tokens used by Dokudocs models, for a Superadmin. Counts only: no content, no prices, no quotas. */
export function PlatformUsagePage() {
  const [days, setDays] = useState(30)
  const usage = useQuery({
    queryKey: ['platform-usage', days],
    queryFn: async ({ signal }) =>
      summarySchema.parse(
        await apiFetch(`/api/v1/platform/usage?days=${days}`, { signal })
      ),
    retry: false,
  })
  const forbidden =
    usage.error instanceof ApiError && usage.error.status === 403
  const data = usage.data
  return (
    <main className='flex flex-1 flex-col overflow-y-auto p-6'>
      <div className='mx-auto w-full max-w-5xl space-y-8'>
        <div className='flex flex-wrap items-end justify-between gap-4'>
          <div className='space-y-1'>
            <h1 className='text-xl font-bold'>Model usage</h1>
            <p className='text-sm text-muted-foreground'>
              Tokens used by the answer, agent and embedding models set under AI
              provider. MCP apps use their own models and are not counted here.
            </p>
          </div>
          <label className='flex items-center gap-2 text-sm'>
            Period
            <select
              aria-label='Period'
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              className='h-9 rounded-md border border-input bg-background px-2'
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </label>
        </div>
        <PlanLimits />
        <UserQuotas />
        {usage.isPending ? <p role='status'>Loading usage…</p> : null}
        {forbidden ? (
          <p role='alert'>Only a superadmin can open this page.</p>
        ) : null}
        {usage.isError && !forbidden ? (
          <div role='alert' className='space-y-2'>
            <p>The usage could not be loaded.</p>
            <Button variant='outline' onClick={() => void usage.refetch()}>
              Retry
            </Button>
          </div>
        ) : null}
        {data && data.overall.calls === 0 ? (
          <p className='text-sm text-muted-foreground'>
            No model calls in this period. Calls appear once someone chats or
            documents are indexed.
          </p>
        ) : null}
        {data && data.overall.calls > 0 ? (
          <>
            <dl className='grid grid-cols-2 gap-4 border-y py-4 sm:grid-cols-4'>
              {[
                ['Calls', data.overall.calls],
                ['Failed', data.overall.failed],
                ['Tokens in', data.overall.inputTokens],
                ['Tokens out', data.overall.outputTokens],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className='text-xs text-muted-foreground'>{label}</dt>
                  <dd className='font-mono text-lg tabular-nums'>
                    {number(value as number)}
                  </dd>
                </div>
              ))}
            </dl>
            <Table
              label='By model'
              head='Model'
              rows={data.models.map((m) => ({
                key: `${m.provider}/${m.model}`,
                name: (
                  <>
                    <span className='font-mono text-xs'>{m.model}</span>
                    <span className='ml-2 text-xs text-muted-foreground'>
                      {m.provider}
                    </span>
                  </>
                ),
                value: m,
              }))}
            />
            <Table
              label='By use'
              head='Use'
              rows={data.purposes.map((p) => ({
                key: `${p.purpose}/${p.feature}`,
                name: (
                  <>
                    {FEATURE[p.feature] ?? p.feature}
                    <span className='ml-2 text-xs text-muted-foreground'>
                      {PURPOSE[p.purpose] ?? p.purpose}
                    </span>
                  </>
                ),
                value: p,
              }))}
            />
            <Table
              label='Top users'
              head='User'
              rows={data.topUsers.map((u) => ({
                key: u.userId,
                name: (
                  <>
                    {u.name || u.email}
                    <span className='ml-2 text-xs text-muted-foreground'>
                      {u.email}
                    </span>
                  </>
                ),
                value: u,
              }))}
            />
            <Table
              label='By day'
              head='Day (UTC)'
              rows={data.days.map((d) => ({
                key: d.day,
                name: <span className='font-mono text-xs'>{d.day}</span>,
                value: d,
              }))}
            />
          </>
        ) : null}
      </div>
    </main>
  )
}
