import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  browserDeps,
  currentPermission,
  describePush,
  disablePush,
  enablePush,
  fetchPushConfig,
  pushSupported,
  type PushStatus,
} from '@/lib/push'
import { Switch } from '@/components/ui/switch'
import {
  readNotificationPrefs,
  writeNotificationPref,
} from '@/features/architecture/api/editor-prefs-api'

const PREFS_KEY = ['notification-prefs']
const PUSH_KEY = ['push-config']

const pushNote: Record<PushStatus, string> = {
  unsupported: 'This browser cannot show notifications.',
  unavailable: 'Browser notifications are not set up on this server.',
  blocked:
    'Notifications are blocked for this site. Allow them in the browser settings, then reload this page.',
  off: 'A notification on this computer when someone mentions you.',
  on: 'On for this browser. Turn it off here, or in the browser settings.',
}

function Row(props: {
  id: string
  label: string
  note: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className='flex items-start justify-between gap-4 py-3'>
      <div className='flex flex-col gap-0.5'>
        <label htmlFor={props.id} className='text-sm font-medium'>
          {props.label}
        </label>
        <p id={`${props.id}-note`} className='text-sm text-muted-foreground'>
          {props.note}
        </p>
      </div>
      <Switch
        id={props.id}
        aria-describedby={`${props.id}-note`}
        checked={props.checked}
        disabled={props.disabled}
        onCheckedChange={props.onChange}
      />
    </div>
  )
}

/** Where a mention reaches this person: in the app, by email, and in this browser. */
export function MentionChannels() {
  const queryClient = useQueryClient()
  const prefs = useQuery({
    queryKey: PREFS_KEY,
    queryFn: ({ signal }) => readNotificationPrefs(signal),
    retry: false,
  })
  const server = useQuery({
    queryKey: PUSH_KEY,
    queryFn: ({ signal }) => fetchPushConfig(signal),
    enabled: pushSupported(),
    retry: false,
  })
  const [registered, setRegistered] = useState(
    () => browserDeps.storedToken() !== null
  )
  const [pushError, setPushError] = useState<string | null>(null)

  // The switch moves at once and goes back if the change was not saved.
  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: boolean }) =>
      writeNotificationPref(key, value),
    onMutate: async ({ key, value }) => {
      await queryClient.cancelQueries({ queryKey: PREFS_KEY })
      const before =
        queryClient.getQueryData<Record<string, unknown>>(PREFS_KEY)
      queryClient.setQueryData(PREFS_KEY, { ...before, [key]: value })
      return { before }
    },
    onError: (_error, _change, context) =>
      queryClient.setQueryData(PREFS_KEY, context?.before),
    onSettled: () => queryClient.invalidateQueries({ queryKey: PREFS_KEY }),
  })
  const push = useMutation({
    mutationFn: async (on: boolean) => {
      setPushError(null)
      if (on) await enablePush(await fetchPushConfig(), browserDeps)
      else await disablePush(browserDeps)
      return on
    },
    onSuccess: (on) => setRegistered(on),
    onError: (error: Error) => setPushError(error.message),
  })

  if (prefs.isPending) {
    return <p className='text-sm text-muted-foreground'>Loading…</p>
  }
  if (prefs.isError) {
    return (
      <p role='alert' className='text-sm text-destructive'>
        Could not load your notification settings. Reload the page to try again.
      </p>
    )
  }

  const chosen = (key: string) => prefs.data[key] !== false
  const status = describePush({
    supported: pushSupported(),
    serverEnabled: server.data?.enabled ?? false,
    permission: currentPermission(),
    hasToken: registered,
  })
  const pushPending = pushSupported() && server.isPending

  return (
    <div className='flex flex-col divide-y divide-border'>
      <Row
        id='mention-in-app'
        label='In Dokudocs'
        note='Listed under Notifications in the sidebar.'
        checked={chosen('in_app')}
        onChange={(value) => save.mutate({ key: 'in_app', value })}
      />
      <Row
        id='mention-email'
        label='By email'
        note='One email for each comment that mentions you.'
        checked={chosen('email')}
        onChange={(value) => save.mutate({ key: 'email', value })}
      />
      <Row
        id='mention-push'
        label='In this browser'
        note={pushError ?? (pushPending ? 'Checking…' : pushNote[status])}
        checked={status === 'on'}
        disabled={
          push.isPending ||
          pushPending ||
          status === 'unsupported' ||
          status === 'unavailable' ||
          status === 'blocked'
        }
        onChange={(on) => push.mutate(on)}
      />
      {save.isError && (
        <p role='alert' className='pt-3 text-sm text-destructive'>
          The change was not saved. Try again.
        </p>
      )}
    </div>
  )
}
