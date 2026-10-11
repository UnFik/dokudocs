import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import {
  getChangesApi,
  getOverviewApi,
  type Change,
  type Overview,
} from './api/platform-ai-api'
import { ProviderSection } from './provider-section'

const FIELD: Record<string, string> = {
  baseURL: 'Base URL',
  protocol: 'Protocol',
  model: 'Model',
}

function describe(change: Change) {
  return Object.entries(change.changes).map(([field, { from, to }]) => {
    if (field === 'apiKey') return 'API key replaced'
    const name = FIELD[field] ?? field
    return from
      ? `${name} changed from ${from} to ${to}`
      : `${name} set to ${to}`
  })
}

function PendingSwitch({ overview }: { overview: Overview }) {
  const { embedding, embeddingPending: next, progress } = overview
  if (!next) return null
  return (
    <div className='space-y-1 border-y py-3 text-sm' role='status'>
      <p>
        Switching embeddings to <span className='font-mono'>{next.model}</span>
        {progress && (
          <>
            :{' '}
            <span className='tabular-nums'>
              {progress.done} of {progress.total} chunks
            </span>{' '}
            have a vector so far.
          </>
        )}
      </p>
      {embedding && (
        <p className='text-muted-foreground'>
          <span className='font-mono'>{embedding.model}</span> keeps answering
          until every document has a vector from the new model, then the old
          vectors are deleted.
        </p>
      )}
    </div>
  )
}

/** Where a Superadmin chooses the provider, model and key the chatbot answers and searches with. */
export function PlatformAiPage() {
  const overview = useQuery({
    queryKey: ['platform-ai', 'overview'],
    queryFn: ({ signal }) => getOverviewApi(signal),
    refetchInterval: (query) =>
      query.state.data?.embeddingPending ? 10_000 : false,
    retry: false,
  })
  const changes = useQuery({
    queryKey: ['platform-ai', 'changes', overview.dataUpdatedAt],
    queryFn: ({ signal }) => getChangesApi(signal),
    enabled: overview.isSuccess,
    retry: false,
  })

  const forbidden =
    overview.error instanceof ApiError && overview.error.status === 403

  return (
    <main className='flex flex-1 flex-col overflow-y-auto p-6'>
      <div className='mx-auto w-full max-w-4xl space-y-8'>
        <div className='space-y-1'>
          <h1 className='text-xl font-bold'>AI provider</h1>
          <p className='text-sm text-muted-foreground'>
            Which models the chatbot answers and searches with. A change applies
            within about 30 seconds and is kept only after a connection test
            passes.
          </p>
        </div>
        {overview.isPending && <p role='status'>Loading settings...</p>}
        {forbidden && <p role='alert'>Only a superadmin can open this page.</p>}
        {overview.isError && !forbidden && (
          <div role='alert' className='space-y-2'>
            <p>The settings could not be loaded.</p>
            <Button variant='outline' onClick={() => void overview.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {overview.data && (
          <>
            <ProviderSection
              purpose='answer'
              title='Answer provider'
              modelLabel='Answer model'
              setting={overview.data.answer}
              note='Writes the reply from the document passages it is given.'
            />
            <ProviderSection
              purpose='embedding'
              title='Embedding provider'
              modelLabel='Embedding model'
              setting={overview.data.embedding}
              note='Turns documents and questions into vectors. Only models that return 1536 numbers work. Choosing a different model re-embeds every document in the background.'
            />
            <PendingSwitch overview={overview.data} />
            <section aria-labelledby='recent-changes' className='space-y-3'>
              <h2 id='recent-changes' className='text-lg font-medium'>
                Recent changes
              </h2>
              {changes.isError && (
                <p role='alert' className='text-sm'>
                  The change history could not be loaded.
                </p>
              )}
              {changes.data?.length === 0 && (
                <p className='text-sm text-muted-foreground'>
                  Nothing has changed yet.
                </p>
              )}
              <ul className='divide-y border-y'>
                {changes.data?.map((change, index) => (
                  <li key={index} className='space-y-1 py-2 text-sm'>
                    <p className='font-mono text-xs text-muted-foreground'>
                      {new Date(change.changedAt).toLocaleString()} ·{' '}
                      {change.purpose}
                    </p>
                    {describe(change).map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </main>
  )
}
