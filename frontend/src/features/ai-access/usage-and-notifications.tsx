import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRAGUsage } from '@/lib/domain-api'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { allowBrowserNotifications } from '@/features/rag/chat-notify'
import { useChatPreferences } from '@/features/rag/chat-preferences'
import {
  formatTokens,
  resetLabel,
  usagePercent,
} from '@/features/rag/conversation-format'

/** This month's AI use in one workspace, against the limit its Plan sets. */
export function AIUsage({ workspaceID }: { workspaceID: string }) {
  const usage = useQuery({
    queryKey: ['rag-usage', workspaceID],
    queryFn: ({ signal }) => getRAGUsage(workspaceID, signal),
    enabled: Boolean(workspaceID),
    retry: false,
  })
  return (
    <section aria-labelledby='ai-usage' className='space-y-3'>
      <div className='space-y-1'>
        <h2 id='ai-usage' className='text-lg font-medium'>
          AI use this month
        </h2>
        <p className='text-sm text-muted-foreground'>
          What you have used in the current workspace. The limit depends on its
          Plan and counts your questions, answers and chat titles.
        </p>
      </div>
      {usage.isPending ? (
        <p role='status' className='text-sm text-muted-foreground'>
          Reading your use…
        </p>
      ) : usage.isError ? (
        <p role='alert' className='text-sm text-destructive'>
          Could not read this month&apos;s use. Reload the page to try again.
        </p>
      ) : (
        <div className='space-y-2'>
          <p className='text-sm'>
            <span className='font-medium tabular-nums'>
              {formatTokens(usage.data.used)} of{' '}
              {formatTokens(usage.data.limit)} tokens
            </span>
            <span className='text-muted-foreground'>
              , resets on {resetLabel(usage.data.resetsAt)}
            </span>
          </p>
          <div
            role='progressbar'
            aria-label='AI use this month'
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={usagePercent(usage.data)}
            className='h-1.5 w-full max-w-sm rounded-[1px] bg-border'
          >
            <div
              className='h-full rounded-[1px] bg-foreground'
              style={{ width: `${usagePercent(usage.data)}%` }}
            />
          </div>
        </div>
      )}
    </section>
  )
}

/** The two notification switches. They are kept in this browser, not on the account. */
export function AINotifications() {
  const [preferences, change] = useChatPreferences()
  const [blocked, setBlocked] = useState(
    () =>
      typeof Notification !== 'undefined' &&
      Notification.permission === 'denied'
  )
  return (
    <section aria-labelledby='ai-notifications' className='space-y-3'>
      <div className='space-y-1'>
        <h2 id='ai-notifications' className='text-lg font-medium'>
          Chat notifications
        </h2>
        <p className='text-sm text-muted-foreground'>
          Told when an answer finishes while you are on another tab. Both start
          off. Applies to this browser only.
        </p>
      </div>
      <div className='flex items-center gap-2'>
        <Checkbox
          id='chat-sound'
          checked={preferences.sound}
          onCheckedChange={(on) => change({ sound: on === true })}
        />
        <Label htmlFor='chat-sound'>
          Play notification sound when completed
        </Label>
      </div>
      <div className='flex items-center gap-2'>
        <Checkbox
          id='chat-browser'
          checked={preferences.browser}
          disabled={blocked && !preferences.browser}
          onCheckedChange={(on) => {
            if (on !== true) return change({ browser: false })
            void allowBrowserNotifications().then((allowed) => {
              setBlocked(!allowed)
              change({ browser: allowed })
            })
          }}
        />
        <Label htmlFor='chat-browser'>Browser notification</Label>
      </div>
      {blocked ? (
        <p role='status' className='text-sm text-muted-foreground'>
          This browser blocked notifications for DokuDocs. Allow them in the
          site settings to turn this on.
        </p>
      ) : null}
    </section>
  )
}
