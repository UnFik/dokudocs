import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy } from 'lucide-react'
import { ApiError } from '@/lib/api-client'
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
import { Button, buttonVariants } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useWorkspaces } from '@/features/workspaces/hooks/use-workspaces'
import {
  createMCPKey,
  getAIPermissions,
  listMCPKeys,
  listMyAudit,
  revokeMCPKey,
  saveAIPermissions,
  type MCPKey,
} from './api/ai-access-api'
import { AuditList } from './audit-list'
import { AINotifications, AIUsage } from './usage-and-notifications'

const message = (error: unknown, fallback: string) =>
  error instanceof ApiError && error.title ? error.title : fallback

/** What the assistant and outside AI clients may do as this User, and the keys those clients use. */
export function AIAccessPage() {
  const { activeWorkspaceId } = useWorkspaces()
  return (
    <main className='flex flex-1 flex-col overflow-y-auto p-6'>
      <div className='mx-auto w-full max-w-4xl space-y-10'>
        <div className='space-y-1'>
          <h1 className='text-xl font-bold'>AI and MCP</h1>
          <p className='text-sm text-muted-foreground'>
            What the assistant may do for you, here and in AI apps you connect
            with an MCP key. It never gets more access than you have.
          </p>
        </div>
        <AIUsage workspaceID={activeWorkspaceId} />
        <AINotifications />
        <Permissions />
        <Keys />
        <RecentCalls />
      </div>
    </main>
  )
}

function Permissions() {
  const queryClient = useQueryClient()
  const permissions = useQuery({
    queryKey: ['ai-permissions'],
    queryFn: ({ signal }) => getAIPermissions(signal),
    retry: false,
  })
  const [draft, setDraft] = useState<string[] | null>(null)
  const allowed = draft ?? permissions.data?.allowed ?? []
  const save = useMutation({
    mutationFn: () => saveAIPermissions(allowed),
    onSuccess: (data) => {
      queryClient.setQueryData(['ai-permissions'], data)
      setDraft(null)
    },
    retry: false,
  })
  const toggle = (key: string, on: boolean) => {
    save.reset()
    setDraft(on ? [...allowed, key] : allowed.filter((item) => item !== key))
  }
  return (
    <section aria-labelledby='ai-permissions' className='space-y-4'>
      <div className='space-y-1'>
        <h2 id='ai-permissions' className='text-lg font-medium'>
          AI permissions
        </h2>
        <p className='text-sm text-muted-foreground'>
          These apply to every MCP key and to the assistant in Dokudocs. In
          Dokudocs chat, content edits become suggestions and other changes wait
          for your approval. Deleting projects, deleting for good, public links,
          sharing and workspace settings are never available to AI.
        </p>
      </div>
      {permissions.isPending ? <p role='status'>Loading permissions…</p> : null}
      {permissions.isError ? (
        <div role='alert' className='space-y-2'>
          <p>Your AI permissions could not be loaded.</p>
          <Button variant='outline' onClick={() => void permissions.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}
      {permissions.data ? (
        <>
          <ul className='divide-y border-y'>
            {permissions.data.catalog.map((capability) => (
              <li key={capability.key} className='flex items-start gap-3 py-3'>
                <Checkbox
                  id={`cap-${capability.key}`}
                  checked={allowed.includes(capability.key)}
                  onCheckedChange={(checked) =>
                    toggle(capability.key, checked === true)
                  }
                  className='mt-0.5'
                />
                <Label
                  htmlFor={`cap-${capability.key}`}
                  className='block cursor-pointer space-y-0.5 font-normal'
                >
                  <span className='block text-sm font-medium'>
                    {capability.label}
                  </span>
                  <span className='block text-xs text-muted-foreground'>
                    {capability.description}
                  </span>
                </Label>
              </li>
            ))}
          </ul>
          {save.isError ? (
            <p role='alert' className='text-sm text-destructive'>
              {message(save.error, 'Could not save. Try again.')}
            </p>
          ) : null}
          {save.isSuccess && draft === null ? (
            <p role='status' className='text-sm'>
              AI permissions saved.
            </p>
          ) : null}
          <Button
            onClick={() => save.mutate()}
            disabled={draft === null || save.isPending}
          >
            Save AI permissions
          </Button>
        </>
      ) : null}
    </section>
  )
}

const LIFETIMES = [
  { days: 30, label: '30 days' },
  { days: 7, label: '7 days' },
  { days: 90, label: '90 days' },
  { days: 0, label: 'Never' },
]

function keyState(key: MCPKey) {
  if (key.revokedAt) return 'Revoked'
  if (key.expiresAt && new Date(key.expiresAt) <= new Date()) return 'Expired'
  return key.expiresAt
    ? `Expires ${new Date(key.expiresAt).toLocaleDateString()}`
    : 'Never expires'
}

function Keys() {
  const queryClient = useQueryClient()
  const keys = useQuery({
    queryKey: ['mcp-keys'],
    queryFn: ({ signal }) => listMCPKeys(signal),
    retry: false,
  })
  const [name, setName] = useState('')
  const [lifetime, setLifetime] = useState(30)
  const [secret, setSecret] = useState('')
  const [revoking, setRevoking] = useState<MCPKey | null>(null)
  const create = useMutation({
    mutationFn: () => createMCPKey(name.trim(), lifetime),
    onSuccess: async (created) => {
      setSecret(created.secret)
      setName('')
      await queryClient.invalidateQueries({ queryKey: ['mcp-keys'] })
    },
    retry: false,
  })
  const revoke = useMutation({
    mutationFn: (id: string) => revokeMCPKey(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mcp-keys'] }),
    retry: false,
  })
  const endpoint = `${window.location.origin}/api/v1/mcp`
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (name.trim()) create.mutate()
  }
  return (
    <section aria-labelledby='mcp-keys' className='space-y-4'>
      <div className='space-y-1'>
        <h2 id='mcp-keys' className='text-lg font-medium'>
          MCP keys
        </h2>
        <p className='text-sm text-muted-foreground'>
          An AI app connects to <span className='font-mono'>{endpoint}</span>{' '}
          with a key in the Authorization header as{' '}
          <span className='font-mono'>Bearer &lt;key&gt;</span>. A key reaches
          every workspace you are in, with your access.
        </p>
      </div>
      {secret ? (
        <div role='status' className='space-y-2 border-y py-3'>
          <p className='text-sm font-medium'>
            Copy your new key now. It will not be shown again.
          </p>
          <div className='flex flex-wrap items-center gap-2'>
            <code className='rounded-sm bg-muted px-2 py-1 font-mono text-xs break-all'>
              {secret}
            </code>
            <Button
              size='sm'
              variant='outline'
              onClick={() => void navigator.clipboard?.writeText(secret)}
            >
              <Copy />
              Copy
            </Button>
          </div>
          <Button size='sm' onClick={() => setSecret('')}>
            I saved it
          </Button>
        </div>
      ) : null}
      <form onSubmit={submit} className='flex flex-wrap items-end gap-3'>
        <div className='min-w-48 flex-1 space-y-2'>
          <Label htmlFor='key-name'>Key name</Label>
          <Input
            id='key-name'
            value={name}
            maxLength={80}
            placeholder='Where it is used'
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='key-lifetime'>Expires</Label>
          <select
            id='key-lifetime'
            value={lifetime}
            onChange={(event) => setLifetime(Number(event.target.value))}
            className='h-9 rounded-md border border-input bg-background px-2 text-sm'
          >
            {LIFETIMES.map((item) => (
              <option key={item.days} value={item.days}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <Button type='submit' disabled={!name.trim() || create.isPending}>
          Create key
        </Button>
      </form>
      {create.isError ? (
        <p role='alert' className='text-sm text-destructive'>
          {message(create.error, 'Could not create the key. Try again.')}
        </p>
      ) : null}
      {keys.isPending ? <p role='status'>Loading keys…</p> : null}
      {keys.isError ? (
        <p role='alert' className='text-sm text-destructive'>
          Your keys could not be loaded.
        </p>
      ) : null}
      {keys.data?.length === 0 ? (
        <p className='text-sm text-muted-foreground'>No keys yet.</p>
      ) : null}
      {keys.data && keys.data.length > 0 ? (
        <ul className='divide-y border-y'>
          {keys.data.map((key) => (
            <li
              key={key.id}
              className='flex flex-wrap items-center gap-3 py-3 text-sm'
            >
              <div className='min-w-0 flex-1'>
                <p className='font-medium'>{key.name}</p>
                <p className='font-mono text-xs text-muted-foreground'>
                  {key.prefix}…{' · '}
                  {key.lastUsedAt
                    ? `last used ${new Date(key.lastUsedAt).toLocaleString()}`
                    : 'never used'}
                </p>
              </div>
              <span className='text-xs text-muted-foreground'>
                {keyState(key)}
              </span>
              {key.revokedAt ? null : (
                <Button
                  size='sm'
                  variant='danger'
                  aria-label={`Revoke ${key.name}`}
                  onClick={() => setRevoking(key)}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <AlertDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {revoking?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Apps using this key lose access at once. You can create a new key
              at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() => {
                if (revoking) revoke.mutate(revoking.id)
                setRevoking(null)
              }}
            >
              Revoke key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function RecentCalls() {
  const audit = useQuery({
    queryKey: ['mcp-audit', 'mine'],
    queryFn: ({ signal }) => listMyAudit(signal),
    retry: false,
  })
  return (
    <section aria-labelledby='mcp-calls' className='space-y-3'>
      <h2 id='mcp-calls' className='text-lg font-medium'>
        Recent MCP calls
      </h2>
      {audit.isPending ? <p role='status'>Loading calls…</p> : null}
      {audit.isError ? (
        <p role='alert' className='text-sm text-destructive'>
          The call history could not be loaded.
        </p>
      ) : null}
      {audit.data ? <AuditList entries={audit.data} /> : null}
    </section>
  )
}
