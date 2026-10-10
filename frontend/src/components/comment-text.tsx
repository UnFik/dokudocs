import { commentParts } from '@/lib/comment-mentions'

/**
 * A comment's text, with each mention as a quiet chip. Line breaks stay. It
 * renders inline so the caller sets wrapping and size.
 */
export function CommentText({ content }: { content: string }) {
  return (
    <>
      {commentParts(content).map((part, index) =>
        part.kind === 'text' ? (
          <span key={index}>{part.text}</span>
        ) : (
          <span
            key={index}
            data-mention={part.userID}
            className='rounded-[2px] bg-muted px-1 font-medium text-foreground'
          >
            @{part.label}
          </span>
        )
      )}
    </>
  )
}
