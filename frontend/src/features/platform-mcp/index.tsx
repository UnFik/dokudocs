import { useState, type FormEvent } from 'react'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiFetch } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { listAllAudit } from '@/features/ai-access/api/ai-access-api'
import { AuditList } from '@/features/ai-access/audit-list'

const settingsSchema = z.object({
  enabled: z.boolean(),
  readPerMinute: z.number(),
  writePerMinute: z.number(),
  maxResultBytes: z.number(),
  auditRetentionDays: z.number(),
})
type Settings = z.infer<typeof settingsSchema>

const getSettings = async (signal?: AbortSignal) =>
  settingsSchema.parse(await apiFetch('/api/v1/platform/mcp', { signal }))
const saveSettings = async (settings: Settings) =>
  settingsSchema.parse(
    await apiFetch('/api/v1/platform/mcp', {
      method: 'PUT',
      body: JSON.stringify(settings),
    })
  )

const NUMBERS: {
  key: keyof Omit<Settings, 'enabled'>
  label: string
  hint: string
}[] = [
  {
    key: 'readPerMinute',
    label: 'Reads per minute, per key',
    hint: 'Calls that only read.',
  },
  {
    key: 'writePerMinute',
    label: 'Writes per minute, per key',
    hint: 'Calls that create or change something.',
  },
  {
    key: 'maxResultBytes',
    label: 'Largest result, in bytes',
    hint: 'Longer results are cut and marked as cut.',
  },
  {
    key: 'auditRetentionDays',
    label: 'Keep call history, in days',
    hint: 'Older entries are deleted every hour.',
  },
]

/** The Superadmin's brake and limits for MCP, and every MCP call. */
export function PlatformMCPPage() {
  const queryClient = useQueryClient()
  const settings = useQuery({
    queryKey: ['platform-mcp'],
    queryFn: ({ signal }) => getSettings(signal),
    retry: false,
  })
  const audit = useQuery({
    queryKey: ['mcp-audit', 'all'],
    queryFn: ({ signal }) => listAllAudit(signal),
    enabled: settings.isSuccess,
    retry: false,
  })
  const [draft, setDraft] = useState<Settings | null>(null)
  const values = draft ?? settings.data
  const save = useMutation({
    mutationFn: () => saveSettings(values!),
    onSuccess: (data) => {
      queryClient.setQueryData(['platform-mcp'], data)
      setDraft(null)
    },
    retry: false,
  })
  const change = (patch: Partial<Settings>) => {
    save.reset()
    setDraft({ ...values!, ...patch })
  }
  const forbidden =
    settings.error instanceof ApiError && settings.error.status === 403
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (draft) save.mutate()
  }
  return (
    <main className='flex flex-1 flex-col overflow-y-auto p-6'>
      <div className='mx-auto w-full max-w-4xl space-y-8'>
        <div className='space-y-1'>
          <h1 className='text-xl font-bold'>MCP</h1>
          <p className='text-sm text-muted-foreground'>
            Outside AI apps reach Dokudocs at /api/v1/mcp with a User's MCP key.
            These settings apply to every key.
          </p>
        </div>
        {settings.isPending ? <p role='status'>Loading settings…</p> : null}
        {forbidden ? (
          <p role='alert'>Only a superadmin can open this page.</p>
        ) : null}
        {settings.isError && !forbidden ? (
          <div role='alert' className='space-y-2'>
            <p>The MCP settings could not be loaded.</p>
            <Button variant='outline' onClick={() => void settings.refetch()}>
              Retry
            </Button>
          </div>
        ) : null}
        {values ? (
          <form onSubmit={submit} className='space-y-5' noValidate>
            <div className='flex items-center gap-3'>
              <Switch
                id='mcp-enabled'
                checked={values.enabled}
                onCheckedChange={(enabled) => change({ enabled })}
                aria-label='MCP is on'
              />
              <Label htmlFor='mcp-enabled' className='font-normal'>
                {values.enabled
                  ? 'MCP is on. Users can connect AI apps with their keys.'
                  : 'MCP is off. Every key is refused.'}
              </Label>
            </div>
            <div className='grid gap-4 sm:grid-cols-2'>
              {NUMBERS.map((field) => (
                <div key={field.key} className='space-y-1'>
                  <Label htmlFor={`mcp-${field.key}`}>{field.label}</Label>
                  <Input
                    id={`mcp-${field.key}`}
                    type='number'
                    min={1}
                    inputMode='numeric'
                    className='font-mono tabular-nums'
                    value={values[field.key]}
                    onChange={(event) =>
                      change({
                        [field.key]: Number(event.target.value),
                      } as Partial<Settings>)
                    }
                  />
                  <p className='text-xs text-muted-foreground'>{field.hint}</p>
                </div>
              ))}
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
                MCP settings saved.
              </p>
            ) : null}
            <Button type='submit' disabled={draft === null || save.isPending}>
              Save MCP settings
            </Button>
          </form>
        ) : null}
        {settings.isSuccess ? (
          <section aria-labelledby='all-calls' className='space-y-3'>
            <h2 id='all-calls' className='text-lg font-medium'>
              MCP calls
            </h2>
            {audit.isError ? (
              <p role='alert' className='text-sm text-destructive'>
                The call history could not be loaded.
              </p>
            ) : null}
            {audit.data ? <AuditList entries={audit.data} showUser /> : null}
          </section>
        ) : null}
      </div>
    </main>
  )
}
