import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Bell } from 'lucide-react'
import { formatRelativeTime } from '@/lib/time-utils'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import {
  listNotifications,
  markNotificationsRead,
  type AppNotification,
} from '@/features/architecture/api/architecture-api'

const KIND = 'comment_mention'
const SHOWN = 20

/** Opens the document a mention was made in, on the thread. */
function destination(path: string | undefined) {
  if (!path) return null
  const url = new URL(path, window.location.origin)
  const docId = url.pathname.split('/')[2]
  const workspaceId = url.searchParams.get('workspaceId')
  const thread = url.searchParams.get('thread')
  if (!docId || !workspaceId) return null
  return {
    to: '/docs/$docId' as const,
    params: { docId },
    search: { workspaceId, ...(thread ? { thread } : {}) },
  }
}

/** The sidebar's list of the comments that mention this person. */
export function NotificationsInbox() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { state } = useSidebar()
  const [open, setOpen] = useState(false)
  // What was new when the list opened stays marked while it is open.
  const [fresh, setFresh] = useState<Set<string>>(new Set())

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: ({ signal }) => listNotifications(signal),
    refetchInterval: 120_000,
    retry: false,
  })
  // The service worker says so when a push arrives and this page is open.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'dokudocs-push') {
        void queryClient.invalidateQueries({ queryKey: ['notifications'] })
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () =>
      navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [queryClient])
  const mentions = (notifications.data ?? []).filter((n) => n.kind === KIND)
  const unread = mentions.filter((n) => !n.read).length
  const markRead = useMutation({
    mutationFn: () => markNotificationsRead(KIND),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) return
    setFresh(new Set(mentions.filter((n) => !n.read).map((n) => n.id)))
    if (unread > 0) markRead.mutate()
  }

  function go(item: AppNotification) {
    const target = destination(item.path)
    if (!target) return
    setOpen(false)
    void navigate(target)
  }

  return (
    <SidebarMenu className='px-0'>
      <SidebarMenuItem>
        <Popover open={open} onOpenChange={onOpenChange}>
          <PopoverTrigger asChild>
            <SidebarMenuButton
              tooltip='Notifications'
              className='h-8 w-full justify-start text-xs'
            >
              <Bell className='size-4 shrink-0' />
              {state !== 'collapsed' && (
                <>
                  <span>Notifications</span>
                  {unread > 0 && (
                    <span className='ml-auto inline-flex items-center gap-1 text-signal'>
                      <span
                        aria-hidden
                        className='size-1.5 rounded-[1px] bg-signal'
                      />
                      {unread} new
                    </span>
                  )}
                </>
              )}
            </SidebarMenuButton>
          </PopoverTrigger>
          <PopoverContent
            side='right'
            align='end'
            className='flex w-80 flex-col gap-1 p-2 text-xs'
          >
            <p className='px-1 font-mono text-[11px] text-muted-foreground'>
              comments that mention you
            </p>
            {notifications.isPending ? (
              <p className='px-1 py-2 text-muted-foreground'>Loading…</p>
            ) : notifications.isError ? (
              <div className='flex flex-col items-start gap-2 px-1 py-2'>
                <p className='text-destructive'>
                  Could not load notifications. Check your connection and try
                  again.
                </p>
                <Button
                  size='sm'
                  variant='outline'
                  className='h-7'
                  onClick={() => void notifications.refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : mentions.length === 0 ? (
              <p className='px-1 py-2 text-muted-foreground'>
                No mentions yet. When someone mentions you in a comment, it is
                listed here.
              </p>
            ) : (
              <ul className='flex max-h-96 flex-col overflow-auto'>
                {mentions.slice(0, SHOWN).map((item) => (
                  <li
                    key={item.id}
                    className='border-t border-border first:border-t-0'
                  >
                    <button
                      type='button'
                      className='flex w-full flex-col gap-0.5 rounded-[4px] px-1 py-1.5 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
                      onClick={() => go(item)}
                    >
                      <span className='flex items-start gap-1.5'>
                        {fresh.has(item.id) && (
                          <span
                            role='img'
                            aria-label='unread'
                            className='mt-1 size-1.5 shrink-0 rounded-[1px] bg-signal'
                          />
                        )}
                        <span className='font-medium'>{item.title}</span>
                      </span>
                      {item.body && (
                        <span className='line-clamp-2 text-muted-foreground'>
                          {item.body}
                        </span>
                      )}
                      <span className='font-mono text-[10.5px] text-muted-foreground'>
                        {formatRelativeTime(item.createdAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </PopoverContent>
        </Popover>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
