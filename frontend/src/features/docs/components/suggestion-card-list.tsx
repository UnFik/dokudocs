import { Button } from '@/components/ui/button'
import { authorColor } from '../lib/author-color'
import {
  cardTitle,
  type SuggestionCard,
} from '../lib/prosemirror/suggestionCards'

// The suggestions made in the document itself (ADR 0027), as cards: Add, Delete,
// Replace. Editors accept or reject any of them; the author may withdraw their own.
export function SuggestionCardList({
  cards,
  userID,
  canDecide,
  disabled,
  onDecide,
}: {
  cards: SuggestionCard[]
  userID: string
  canDecide: boolean
  /** In View mode nothing can be decided. */
  disabled: boolean
  onDecide: (id: string, decision: 'accept' | 'reject') => void
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
          return (
            <li
              key={card.id}
              data-suggestion-id={card.id}
              className='border-t py-2 text-xs first:border-t-0'
            >
              <p className='flex items-center gap-2 text-muted-foreground'>
                <span
                  aria-hidden
                  className='size-1.5 shrink-0 rounded-[1px]'
                  style={{ backgroundColor: authorColor(card.author) }}
                />
                {own ? 'You' : 'Collaborator'}
              </p>
              <p className='mt-1 font-medium break-words'>{cardTitle(card)}</p>
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
