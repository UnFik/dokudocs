import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  maxSuggestionReplyLength,
  replyToDocumentSuggestion,
  setDocumentSuggestionResolved,
  type DocumentSuggestion,
} from '@/lib/domain-api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

// Replies are signed by role because the panel has no member directory:
// the proposer, or an editor.
function authorLabel(
  suggestion: DocumentSuggestion,
  authorId: string,
  userID: string
) {
  if (authorId === userID) return 'You'
  return authorId === suggestion.proposerId ? 'Proposer' : 'Editor'
}

export function SuggestionThread({
  suggestion,
  workspaceID,
  documentID,
  userID,
  canInteract = true,
}: {
  suggestion: DocumentSuggestion
  workspaceID: string
  documentID: string
  userID: string
  canInteract?: boolean
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const [showReplies, setShowReplies] = useState(false)
  const resolved = Boolean(suggestion.resolvedAt)
  const replies = suggestion.replies
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ['document-suggestions', workspaceID, documentID],
    })

  const replyMutation = useMutation({
    mutationFn: () =>
      replyToDocumentSuggestion(
        workspaceID,
        documentID,
        suggestion.suggestionId,
        { replyID: crypto.randomUUID(), body: draft.trim() }
      ),
    onSuccess: async () => {
      setDraft('')
      await refresh()
    },
    onError: (error) => toast.error(error.message),
  })
  const resolveMutation = useMutation({
    mutationFn: (next: boolean) =>
      setDocumentSuggestionResolved(
        workspaceID,
        documentID,
        suggestion.suggestionId,
        next
      ),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  })

  const trimmed = draft.trim()
  const tooLong = draft.length > maxSuggestionReplyLength
  const repliesShown = !resolved || showReplies

  return (
    <div className='mt-2 border-t pt-2' aria-label='Discussion'>
      <div className='flex flex-wrap items-center gap-2'>
        {resolved ? (
          <span className='text-muted-foreground'>Resolved</span>
        ) : null}
        {resolved && replies.length ? (
          <Button
            size='sm'
            variant='ghost'
            aria-expanded={showReplies}
            onClick={() => setShowReplies((open) => !open)}
          >
            {showReplies
              ? 'Hide replies'
              : `Show ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
          </Button>
        ) : null}
        {canInteract ? (
          <Button
            size='sm'
            variant='ghost'
            className='ml-auto'
            disabled={resolveMutation.isPending}
            onClick={() => resolveMutation.mutate(!resolved)}
          >
            {resolved ? 'Reopen discussion' : 'Resolve discussion'}
          </Button>
        ) : null}
      </div>
      {repliesShown && replies.length ? (
        <ul className='mt-2 space-y-2'>
          {replies.map((reply) => (
            <li key={reply.replyId}>
              <p className='flex items-baseline gap-2'>
                <span className='font-medium'>
                  {authorLabel(suggestion, reply.authorId, userID)}
                </span>
                <time
                  dateTime={reply.createdAt}
                  className='font-mono text-[11px] text-muted-foreground tabular-nums'
                >
                  {new Date(reply.createdAt).toLocaleString()}
                </time>
              </p>
              <p className='break-words whitespace-pre-wrap'>{reply.body}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {canInteract && !resolved ? (
        <form
          className='mt-2 space-y-1'
          onSubmit={(event) => {
            event.preventDefault()
            if (trimmed && !tooLong) replyMutation.mutate()
          }}
        >
          <label
            className='block text-muted-foreground'
            htmlFor={`reply-${suggestion.suggestionId}`}
          >
            Reply
          </label>
          <Textarea
            id={`reply-${suggestion.suggestionId}`}
            className='min-h-14 text-xs md:text-xs'
            value={draft}
            aria-invalid={tooLong}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                (event.ctrlKey || event.metaKey) &&
                trimmed &&
                !tooLong
              ) {
                event.preventDefault()
                replyMutation.mutate()
              }
            }}
          />
          {tooLong ? (
            <p role='alert' className='text-destructive'>
              Replies can be up to {maxSuggestionReplyLength} characters. Cut{' '}
              {draft.length - maxSuggestionReplyLength} to send it.
            </p>
          ) : null}
          <Button
            size='sm'
            type='submit'
            variant='outline'
            disabled={!trimmed || tooLong || replyMutation.isPending}
          >
            Send reply
          </Button>
        </form>
      ) : null}
    </div>
  )
}
