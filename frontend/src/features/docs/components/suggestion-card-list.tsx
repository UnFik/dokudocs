import type { DocumentSuggestion } from '@/lib/domain-api'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { authorColor } from '../lib/author-color'
import {
  cardTitle,
  type SuggestionCard,
} from '../lib/prosemirror/suggestionCards'
import { SuggestionThread } from './suggestion-thread'

// The suggestions made in the document itself (ADR 0027), as cards: Add, Delete,
// Replace. Editors accept or reject any of them; the author may withdraw their own.
export function SuggestionCardList({
  cards,
  userID,
  canDecide,
  disabled,
  onDecide,
  onSelect,
  focusedSuggestionID,
  discussions,
  canInteract,
  workspaceID,
  documentID,
}: {
  cards: SuggestionCard[]
  userID: string
  canDecide: boolean
  /** In View mode nothing can be decided. */
  disabled: boolean
  onDecide: (id: string, decision: 'accept' | 'reject') => void
  onSelect: (id: string) => void
  focusedSuggestionID: string | null
  discussions: DocumentSuggestion[]
  canInteract: boolean
  workspaceID: string
  documentID: string
}) {
  if (!cards.length)
    return (
      <p className='px-4 pb-2 text-xs text-muted-foreground'>
        No suggestions in this document. In Suggest mode, what you type becomes
        one.
      </p>
    )
  return (
    <>
      {disabled ? (
        <p className='px-4 pb-1 text-xs text-muted-foreground'>
          Switch to Edit or Suggest mode to accept, reject, or withdraw.
        </p>
      ) : null}
      <ul aria-label='Suggestions in this document' className='px-4 pb-2'>
        {cards.map((card) => {
          const own = card.author === userID
          const discussion = discussions.find(
            (item) => item.suggestionId === card.id
          )
          const authorName =
            discussion?.proposerName || (own ? 'You' : 'Collaborator')
          const authorInitials = authorName
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]!.toUpperCase())
            .join('')
          return (
            <li
              key={card.id}
              data-suggestion-id={card.id}
              data-focused={
                focusedSuggestionID === card.id ? 'true' : undefined
              }
              className={`border-t py-2 text-xs first:border-t-0 ${focusedSuggestionID === card.id ? 'bg-secondary outline outline-1 -outline-offset-1 outline-border' : ''}`}
            >
              <div className='flex min-w-0 flex-wrap items-center gap-2 text-muted-foreground'>
                <Avatar
                  aria-hidden
                  className='size-6 shrink-0 border'
                  style={{ borderColor: authorColor(card.author) }}
                >
                  <AvatarFallback className='bg-muted text-[9px] text-muted-foreground'>
                    {authorInitials || '?'}
                  </AvatarFallback>
                </Avatar>
                <span className='min-w-0 break-words'>{authorName}</span>
                {discussion ? (
                  <time
                    className='text-[10px] tabular-nums'
                    dateTime={discussion.createdAt}
                  >
                    {new Date(discussion.createdAt).toLocaleString()}
                  </time>
                ) : null}
              </div>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='mt-1 h-auto min-h-11 w-full justify-start px-0 py-2 text-left text-xs font-medium whitespace-normal text-foreground'
                aria-label={`Show in document: ${cardTitle(card)}`}
                onClick={() => onSelect(card.id)}
              >
                {cardTitle(card)}
              </Button>
              {discussion ? (
                <SuggestionThread
                  suggestion={discussion}
                  workspaceID={workspaceID}
                  documentID={documentID}
                  userID={userID}
                  canInteract={canInteract}
                />
              ) : null}
              {canDecide || own ? (
                <div className='mt-2 flex gap-1'>
                  {canDecide ? (
                    <>
                      <Button
                        size='sm'
                        variant='outline'
                        disabled={disabled}
                        onClick={() => onDecide(card.id, 'accept')}
                      >
                        Accept
                      </Button>
                      <Button
                        size='sm'
                        variant='outline'
                        disabled={disabled}
                        onClick={() => onDecide(card.id, 'reject')}
                      >
                        Reject
                      </Button>
                    </>
                  ) : (
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={disabled}
                      onClick={() => onDecide(card.id, 'reject')}
                    >
                      Withdraw
                    </Button>
                  )}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </>
  )
}
