import {
  Children,
  isValidElement,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { classifyHref } from './answer-links'
import { closeOpenMarkdown } from './close-open-markdown'
import { CodeBlock } from './code-block'

export type AnswerMarkdownProps = {
  content: string
  /** True while the text is still being written; half-open marks are closed. */
  streaming?: boolean
  /** Draws a link to a document; without it a document link shows as its label. */
  renderDocument?: (documentID: string, label: ReactNode) => ReactNode
}

const heading = 'mt-4 mb-2 font-semibold first:mt-0'

/** Answer text as Markdown, built as React elements: nothing is injected as HTML. */
export default function AnswerMarkdown({
  content,
  streaming,
  renderDocument,
}: AnswerMarkdownProps) {
  const components: Components = {
    h1: (props) => <h3 className={`${heading} text-base`} {...rest(props)} />,
    h2: (props) => <h3 className={`${heading} text-base`} {...rest(props)} />,
    h3: (props) => <h4 className={`${heading} text-sm`} {...rest(props)} />,
    h4: (props) => <h5 className={`${heading} text-sm`} {...rest(props)} />,
    p: (props) => <p className='my-2 first:mt-0 last:mb-0' {...rest(props)} />,
    ul: (props) => (
      <ul
        className='my-2 list-disc space-y-1 pl-5 has-[input]:list-none has-[input]:pl-0'
        {...rest(props)}
      />
    ),
    ol: (props) => (
      <ol className='my-2 list-decimal space-y-1 pl-5' {...rest(props)} />
    ),
    li: (props) => <li className='pl-0.5' {...rest(props)} />,
    input: ({ checked }) => (
      <input
        type='checkbox'
        checked={Boolean(checked)}
        disabled
        readOnly
        className='mr-2 align-middle'
      />
    ),
    blockquote: (props) => (
      <blockquote
        className='my-2 border-l-2 pl-3 text-muted-foreground'
        {...rest(props)}
      />
    ),
    hr: () => <hr className='my-4 border-border' />,
    strong: (props) => <strong className='font-semibold' {...rest(props)} />,
    code: (props) => (
      <code
        className='rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em]'
        {...rest(props)}
      />
    ),
    pre: ({ children }) => <FencedCode>{children}</FencedCode>,
    table: (props) => (
      <div className='my-3 overflow-x-auto'>
        <table className='w-full border-collapse text-sm' {...rest(props)} />
      </div>
    ),
    th: (props) => (
      <th
        className='border-b bg-card px-3 py-1.5 text-left text-xs font-medium whitespace-nowrap text-muted-foreground'
        {...rest(props)}
      />
    ),
    td: (props) => (
      <td className='border-b px-3 py-1.5 align-top' {...rest(props)} />
    ),
    img: ({ alt }) => (alt ? <span>{alt}</span> : null),
    a: ({ href, children }) => {
      const link = classifyHref(href ?? '')
      if (link.kind === 'external')
        return (
          <a
            href={link.href}
            target='_blank'
            rel='noopener noreferrer'
            className='text-signal underline underline-offset-4'
          >
            {children}
          </a>
        )
      if (link.kind === 'document' && renderDocument)
        return <>{renderDocument(link.id, children)}</>
      return <>{children}</>
    },
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={components}
      urlTransform={(url) => url}
    >
      {streaming ? closeOpenMarkdown(content) : content}
    </ReactMarkdown>
  )
}

/** Props the renderer adds for its own bookkeeping, not for the element. */
function rest<T extends { node?: unknown }>(props: T): Omit<T, 'node'> {
  const { node: _node, ...others } = props
  void _node
  return others
}

function FencedCode({ children }: { children?: ReactNode }) {
  const child = Children.toArray(children).find(isValidElement) as
    | ReactElement<ComponentProps<'code'>>
    | undefined
  const fence = /language-(\S+)/.exec(child?.props.className ?? '')?.[1]
  const text = String(child?.props.children ?? '').replace(/\n$/, '')
  return <CodeBlock code={text} fence={fence} />
}
