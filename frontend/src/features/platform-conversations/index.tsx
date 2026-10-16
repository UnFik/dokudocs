import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  NODES,
  NO_FILTERS,
  OUTCOMES,
  PAGE,
  getControls,
  getRun,
  listRuns,
  saveControls,
  type Controls,
  type Filters,
  type Run,
  type RunSummary,
} from './api'
import { TraceGraph } from './trace-graph'

const duration = (ms: number) =>
  ms >= 10000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`

const SELECT =
  'h-9 rounded-md border border-input bg-background px-2 text-sm shadow-xs'

/** The Superadmin's view of Agent requests: how each went through the decision graph, never what was said. */
export function PlatformConversationsPage() {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [open, setOpen] = useState<string | null>(null)
  const runs = useQuery({
    queryKey: ['platform-runs', filters],
    queryFn: ({ signal }) => listRuns(filters, signal),
    retry: false,
  })
  const forbidden = runs.error instanceof ApiError && runs.error.status === 403
  const narrow = (patch: Partial<Filters>) =>
    setFilters((f) => ({ ...f, offset: 0, ...patch }))
  return (
    <main className='flex flex-1 flex-col overflow-y-auto p-6'>
      <div className='mx-auto w-full max-w-6xl space-y-8'>
        <div className='space-y-1'>
          <h1 className='text-xl font-bold'>Conversations</h1>
          <p className='text-sm text-muted-foreground'>
            Follow each request through the Agent: where it went, how often it
            went around and where it stopped. What people wrote is never shown
            here.
          </p>
        </div>
        {forbidden ? (
          <p role='alert'>Only a superadmin can open this page.</p>
        ) : (
          <>
            <Controls />
            <section aria-labelledby='runs-heading' className='space-y-4'>
              <h2 id='runs-heading' className='text-lg font-medium'>
                Requests
              </h2>
              <div className='flex flex-wrap items-end gap-4'>
                <div className='space-y-1'>
                  <Label htmlFor='filter-outcome'>Ended at</Label>
                  <select
                    id='filter-outcome'
                    className={SELECT}
                    value={filters.outcome}
                    onChange={(e) => narrow({ outcome: e.target.value })}
                  >
                    <option value=''>Anywhere</option>
                    {OUTCOMES.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </div>
                <div className='space-y-1'>
                  <Label htmlFor='filter-node'>Passed through</Label>
                  <select
                    id='filter-node'
                    className={SELECT}
                    value={filters.node}
                    onChange={(e) => narrow({ node: e.target.value })}
                  >
                    <option value=''>Anything</option>
                    {NODES.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                <div className='space-y-1'>
                  <Label htmlFor='filter-slow'>Slower than, in ms</Label>
                  <Input
                    id='filter-slow'
                    type='number'
                    min={0}
                    className='w-32 font-mono tabular-nums'
                    value={filters.minDurationMs}
                    onChange={(e) => narrow({ minDurationMs: e.target.value })}
                  />
                </div>
                <label className='flex items-center gap-2 pb-2 text-sm'>
                  <input
                    type='checkbox'
                    checked={filters.failedOnly}
                    onChange={(e) => narrow({ failedOnly: e.target.checked })}
                  />
                  Failed only
                </label>
              </div>
              {runs.isPending ? <p role='status'>Loading requests…</p> : null}
              {runs.isError ? (
                <div role='alert' className='space-y-2'>
                  <p>The requests could not be loaded.</p>
                  <Button variant='outline' onClick={() => void runs.refetch()}>
                    Retry
                  </Button>
                </div>
              ) : null}
              {runs.data ? (
                <RunTable
                  runs={runs.data.runs}
                  total={runs.data.total}
                  offset={filters.offset}
                  onPage={(offset) => setFilters((f) => ({ ...f, offset }))}
                  onOpen={setOpen}
                />
              ) : null}
            </section>
            {open ? <Detail id={open} /> : null}
          </>
        )}
      </div>
    </main>
  )
}

function Controls() {
  const queryClient = useQueryClient()
  const controls = useQuery({
    queryKey: ['platform-harness'],
    queryFn: ({ signal }) => getControls(signal),
    retry: false,
  })
  const [draft, setDraft] = useState<Controls | null>(null)
  const values = draft ?? controls.data
  const save = useMutation({
    mutationFn: () => saveControls(values!),
    onSuccess: (data) => {
      queryClient.setQueryData(['platform-harness'], data)
      setDraft(null)
    },
    retry: false,
  })
  if (!values) return null
  const change = (patch: Partial<Controls>) => {
    save.reset()
    setDraft({ ...values, ...patch })
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (draft) save.mutate()
  }
  return (
    <form
      onSubmit={submit}
      className='space-y-4'
      noValidate
      aria-labelledby='controls-heading'
    >
      <h2 id='controls-heading' className='text-lg font-medium'>
        Entry gate and model router
      </h2>
      <div className='flex items-center gap-3'>
        <Switch
          id='gate-enabled'
          checked={values.gateEnabled}
          onCheckedChange={(gateEnabled) => change({ gateEnabled })}
          aria-label='Entry gate is on'
        />
        <Label htmlFor='gate-enabled' className='font-normal'>
          {values.gateEnabled
            ? 'The entry gate is on: unclear or off-topic requests are caught before the Agent works.'
            : 'The entry gate is off: every request goes straight to the Agent.'}
        </Label>
      </div>
      <div className='flex items-center gap-3'>
        <Switch
          id='router-enabled'
          checked={values.routerEnabled}
          onCheckedChange={(routerEnabled) => change({ routerEnabled })}
          aria-label='Model router is on'
        />
        <Label htmlFor='router-enabled' className='font-normal'>
          {values.routerEnabled
            ? 'The router is on: short read-only questions use the small model.'
            : 'The router is off: every request uses the main model.'}
        </Label>
      </div>
      <div className='max-w-xs space-y-1'>
        <Label htmlFor='trace-retention'>Keep traces, in days</Label>
        <Input
          id='trace-retention'
          type='number'
          min={1}
          max={365}
          className='font-mono tabular-nums'
          value={values.traceRetentionDays}
          onChange={(e) =>
            change({ traceRetentionDays: Number(e.target.value) })
          }
        />
      </div>
      {save.isError ? (
        <p role='alert' className='text-sm text-destructive'>
          {save.error instanceof ApiError
            ? save.error.title
            : 'Could not save. Try again.'}
        </p>
      ) : null}
      {save.isSuccess && draft === null ? (
        <p role='status' className='text-sm'>
          Controls saved.
        </p>
      ) : null}
      <Button type='submit' disabled={draft === null || save.isPending}>
        Save controls
      </Button>
    </form>
  )
}

function RunTable({
  runs,
  total,
  offset,
  onPage,
  onOpen,
}: {
  runs: RunSummary[]
  total: number
  offset: number
  onPage: (offset: number) => void
  onOpen: (id: string) => void
}) {
  if (runs.length === 0)
    return <p className='text-sm text-muted-foreground'>No requests match.</p>
  return (
    <div className='space-y-2'>
      <p className='text-sm text-muted-foreground'>
        {total} request{total === 1 ? '' : 's'}
        {total > PAGE
          ? `, showing ${offset + 1} to ${Math.min(offset + PAGE, total)}`
          : ''}
      </p>
      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full text-sm' aria-label='Requests'>
          <thead className='bg-muted/50 text-left'>
            <tr>
              {[
                'When',
                'Person',
                'Ended at',
                'Steps',
                'Model calls',
                'Tool calls',
                'Tokens in / out',
                'Took',
                '',
              ].map((h) => (
                <th key={h} className='px-3 py-2 font-medium'>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.runId} className='border-t'>
                <td className='px-3 py-2 whitespace-nowrap'>
                  {new Date(run.startedAt).toLocaleString()}
                </td>
                <td className='px-3 py-2'>
                  <div>{run.ownerName || 'Unknown'}</div>
                  <div className='text-xs text-muted-foreground'>
                    {run.ownerEmail}
                  </div>
                </td>
                <td
                  className={`px-3 py-2 ${run.failed ? 'font-medium text-destructive' : ''}`}
                >
                  {run.outcome}
                  {run.failed ? ' (failed)' : ''}
                </td>
                <td className='px-3 py-2 tabular-nums'>{run.steps}</td>
                <td className='px-3 py-2 tabular-nums'>{run.modelCalls}</td>
                <td className='px-3 py-2 tabular-nums'>{run.toolCalls}</td>
                <td className='px-3 py-2 tabular-nums'>
                  {run.inputTokens} / {run.outputTokens}
                </td>
                <td className='px-3 py-2 whitespace-nowrap tabular-nums'>
                  {duration(run.durationMs)}
                </td>
                <td className='px-3 py-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => onOpen(run.runId)}
                  >
                    Open trace
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > PAGE ? (
        <div className='flex gap-2'>
          <Button
            variant='outline'
            size='sm'
            disabled={offset === 0}
            onClick={() => onPage(Math.max(0, offset - PAGE))}
          >
            Previous
          </Button>
          <Button
            variant='outline'
            size='sm'
            disabled={offset + PAGE >= total}
            onClick={() => onPage(offset + PAGE)}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function Detail({ id }: { id: string }) {
  const run = useQuery({
    queryKey: ['platform-run', id],
    queryFn: ({ signal }) => getRun(id, signal),
    retry: false,
  })
  return (
    <section aria-labelledby='trace-heading' className='space-y-4'>
      <h2 id='trace-heading' className='text-lg font-medium'>
        Trace
      </h2>
      {run.isPending ? <p role='status'>Loading the trace…</p> : null}
      {run.isError ? (
        <p role='alert'>
          The trace could not be loaded. It may be older than the retention.
        </p>
      ) : null}
      {run.data ? <TraceBody run={run.data} /> : null}
    </section>
  )
}

function TraceBody({ run }: { run: Run }) {
  const label = (node: string) =>
    run.graph.nodes.find((n) => n.id === node)?.label ?? node
  const via = (edge: string) => (edge ? edge.replaceAll('_', ' ') : '')
  return (
    <div className='space-y-6'>
      <TraceGraph graph={run.graph} steps={run.stepList} />
      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full text-sm' aria-label='Steps'>
          <thead className='bg-muted/50 text-left'>
            <tr>
              {[
                '#',
                'Step',
                'Via',
                'Status',
                'Took',
                'Model',
                'Tokens in / out',
                'Tool',
                'Try',
                'Why',
              ].map((h) => (
                <th key={h} className='px-3 py-2 font-medium'>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {run.stepList.map((s) => (
              <tr key={s.seq} className='border-t'>
                <td className='px-3 py-2 tabular-nums'>{s.seq}</td>
                <td className='px-3 py-2'>{label(s.node)}</td>
                <td className='px-3 py-2'>{via(s.edge)}</td>
                <td
                  className={`px-3 py-2 ${s.status === 'failed' ? 'text-destructive' : ''}`}
                >
                  {s.status}
                </td>
                <td className='px-3 py-2 tabular-nums'>
                  {s.durationMs ? duration(s.durationMs) : ''}
                </td>
                <td className='px-3 py-2'>
                  {s.model}
                  {s.tier ? ` ${s.tier}`.trimEnd() : ''}
                </td>
                <td className='px-3 py-2 tabular-nums'>
                  {s.inputTokens || s.outputTokens
                    ? `${s.inputTokens} / ${s.outputTokens}`
                    : ''}
                </td>
                <td className='px-3 py-2'>{s.tool}</td>
                <td className='px-3 py-2 tabular-nums'>{s.attempt || ''}</td>
                <td className='px-3 py-2 font-mono text-xs'>
                  {s.reason}
                  {s.finishReason ? ` ${s.finishReason}`.trimEnd() : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
