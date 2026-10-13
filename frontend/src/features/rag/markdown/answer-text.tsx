import { lazy, Suspense } from 'react'
import type { AnswerMarkdownProps } from './answer-markdown'

const AnswerMarkdown = lazy(() => import('./answer-markdown'))

/**
 * An answer from the assistant, drawn as Markdown. The renderer loads on first
 * use; until then the text shows plain, so the answer is never blank.
 */
export function AnswerText(props: AnswerMarkdownProps) {
  return (
    <div className='text-sm leading-6 break-words'>
      <Suspense
        fallback={<p className='whitespace-pre-wrap'>{props.content}</p>}
      >
        <AnswerMarkdown {...props} />
      </Suspense>
    </div>
  )
}
