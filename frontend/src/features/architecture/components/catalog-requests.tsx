import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { formatRelativeTime } from '@/lib/time-utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  answerCatalogRequest,
  listMyCatalogRequests,
  listNotifications,
  listOpenCatalogRequests,
  markNotificationsRead,
  type OpenCatalogRequest,
} from '../api/architecture-api'
import type { CatalogEntry } from '../lib/catalog'

/**
 * The palette's footer: the catalog requests this person made, with the answers
 * that came back, and for platform admins the list of requests to answer.
 */
export function CatalogRequests({ catalog }: { catalog: CatalogEntry[] }) {
  const queryClient = useQueryClient()
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: ({ signal }) => listNotifications(signal),
    refetchInterval: 120_000,
    retry: false,
  })
  const mine = useQuery({
    queryKey: ['catalog-requests', 'mine'],
    queryFn: ({ signal }) => listMyCatalogRequests(signal),
    retry: false,
  })
  // Admins get the list; everyone else is refused, and the review button stays hidden.
  const open = useQuery({
    queryKey: ['catalog-requests', 'open'],
    queryFn: ({ signal }) => listOpenCatalogRequests(signal),
    retry: false,
  })
  const unread = (notifications.data ?? []).filter(
    (n) => !n.read && n.kind === 'catalog_request'
  ).length
  const read = useMutation({
    mutationFn: markNotificationsRead,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const [reviewing, setReviewing] = useState(false)

  if (!mine.data?.length && !open.data && !unread) return null
  return (
    <div className='flex flex-wrap items-center gap-2 border-t border-border pt-2'>
      {(mine.data?.length || unread > 0) && (
        <Popover
          onOpenChange={(isOpen) => isOpen && unread > 0 && read.mutate()}
        >
          <PopoverTrigger asChild>
            <Button
              size='sm'
              variant='ghost'
              className='h-8 gap-1.5 px-2 text-xs'
            >
              Your requests
              {unread > 0 && (
                <span className='inline-flex items-center gap-1 text-signal'>
                  <span
                    aria-hidden
                    className='size-1.5 rounded-[1px] bg-signal'
                  />
                  {unread} new
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align='start'
            className='flex w-80 flex-col gap-2 text-xs'
          >
            {(notifications.data ?? [])
              .filter((n) => n.kind === 'catalog_request')
              .slice(0, 5)
              .map((n) => (
                <div key={n.id} className='border-b border-border pb-1.5'>
                  <p className='font-medium'>{n.title}</p>
                  {n.body && <p className='text-muted-foreground'>{n.body}</p>}
                  <p className='font-mono text-[10.5px] text-muted-foreground'>
                    {formatRelativeTime(n.createdAt)}
                  </p>
                </div>
              ))}
            <p className='font-mono text-[11px] text-muted-foreground'>
              requests you made or voted for
            </p>
            {!mine.data?.length && (
              <p className='text-muted-foreground'>None yet.</p>
            )}
            <ul className='flex flex-col gap-1'>
              {(mine.data ?? []).map((r) => (
                <li
                  key={r.id}
                  className='flex items-start justify-between gap-2'
                >
                  <span>{r.name}</span>
                  <span className='text-right text-muted-foreground'>
                    {r.status === 'open' &&
                      `waiting · ${r.votes} vote${r.votes === 1 ? '' : 's'}`}
                    {r.status === 'added' && (
                      <>
                        added as{' '}
                        <code className='font-mono'>{r.resolvedSlug}</code>
                      </>
                    )}
                    {r.status === 'declined' && `declined: ${r.declineReason}`}
                  </span>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}
      {open.data && (
        <Button
          size='sm'
          variant='ghost'
          className='h-8 px-2 text-xs'
          onClick={() => setReviewing(true)}
        >
          Review requests ({open.data.length})
        </Button>
      )}
      {open.data && (
        <ReviewDialog
          open={reviewing}
          onOpenChange={setReviewing}
          requests={open.data}
          catalog={catalog}
        />
      )}
    </div>
  )
}

function ReviewDialog({
  open,
  onOpenChange,
  requests,
  catalog,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  requests: OpenCatalogRequest[]
  catalog: CatalogEntry[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Catalog requests</DialogTitle>
          <DialogDescription>
            Most wanted first. Mark a request added once its entry ships in a
            catalog migration, or decline it with a reason; everyone who asked
            is notified.
          </DialogDescription>
        </DialogHeader>
        {!requests.length && (
          <p className='text-sm text-muted-foreground'>No open requests.</p>
        )}
        <ul className='flex flex-col'>
          {requests.map((request) => (
            <ReviewRow key={request.id} request={request} catalog={catalog} />
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

function ReviewRow({
  request,
  catalog,
}: {
  request: OpenCatalogRequest
  catalog: CatalogEntry[]
}) {
  const queryClient = useQueryClient()
  const [slug, setSlug] = useState('')
  const [reason, setReason] = useState('')
  const answer = useMutation({
    mutationFn: (
      value:
        | { status: 'added'; slug: string }
        | { status: 'declined'; reason: string }
    ) => answerCatalogRequest(request.id, value),
    onSuccess: async () => {
      toast.success(
        `“${request.name}” answered; its ${request.votes} requester${request.votes === 1 ? '' : 's'} will be notified.`
      )
      await queryClient.invalidateQueries({ queryKey: ['catalog-requests'] })
    },
    onError: (error) => toast.error(error.message),
  })
  const slugID = `catalog-answer-slug-${request.id}`
  const reasonID = `catalog-answer-reason-${request.id}`
  return (
    <li className='flex flex-col gap-2 border-t border-border py-3 text-sm'>
      <div className='flex flex-wrap items-baseline justify-between gap-2'>
        <span className='font-medium'>{request.name}</span>
        <span className='font-mono text-[11px] text-muted-foreground'>
          {request.category} · {request.votes} vote
          {request.votes === 1 ? '' : 's'} ·{' '}
          {formatRelativeTime(request.createdAt)}
        </span>
      </div>
      {request.website && (
        <a
          href={request.website}
          target='_blank'
          rel='noreferrer noopener'
          className='text-xs text-signal hover:underline'
        >
          {request.website}
        </a>
      )}
      {request.note && (
        <p className='text-xs text-muted-foreground'>{request.note}</p>
      )}
      <div className='flex flex-wrap items-end gap-2'>
        <div className='flex flex-col gap-1'>
          <label
            htmlFor={slugID}
            className='font-mono text-[11px] text-muted-foreground'
          >
            added as
          </label>
          <select
            id={slugID}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className='h-8 max-w-56 rounded-[4px] border border-input bg-card px-2 text-[12.5px]'
          >
            <option value=''>Choose the entry…</option>
            {catalog
              .filter((e) => !e.deprecated)
              .map((e) => (
                <option key={e.slug} value={e.slug}>
                  {e.name} ({e.slug})
                </option>
              ))}
          </select>
        </div>
        <Button
          size='sm'
          variant='outline'
          disabled={!slug || answer.isPending}
          onClick={() => answer.mutate({ status: 'added', slug })}
        >
          Mark added
        </Button>
        <div className='flex min-w-40 flex-1 flex-col gap-1'>
          <label
            htmlFor={reasonID}
            className='font-mono text-[11px] text-muted-foreground'
          >
            or decline because
          </label>
          <Input
            id={reasonID}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            className='h-8 text-[12.5px]'
          />
        </div>
        <Button
          size='sm'
          variant='ghost'
          disabled={!reason.trim() || answer.isPending}
          onClick={() =>
            answer.mutate({ status: 'declined', reason: reason.trim() })
          }
        >
          Decline
        </Button>
      </div>
    </li>
  )
}
