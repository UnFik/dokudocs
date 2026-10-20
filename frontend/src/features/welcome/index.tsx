import { useEffect, useRef, useState, type TransitionEvent } from 'react'
import { Link, useSearch } from '@tanstack/react-router'
import aiDark from '@/assets/landing/ai-dark.webp'
import aiLight from '@/assets/landing/ai-light.webp'
import architectureDark from '@/assets/landing/architecture-dark.webp'
import architectureLight from '@/assets/landing/architecture-light.webp'
import collabDark from '@/assets/landing/collab-dark.webp'
import collabLight from '@/assets/landing/collab-light.webp'
import flowDark from '@/assets/landing/flow-dark.webp'
import flowLight from '@/assets/landing/flow-light.webp'
import schemaDark from '@/assets/landing/schema-dark.webp'
import schemaLight from '@/assets/landing/schema-light.webp'
import shareDark from '@/assets/landing/share-dark.webp'
import shareLight from '@/assets/landing/share-light.webp'
import { Logo } from '@/assets/logo'
import { useTheme } from '@/context/theme-provider'
import './welcome.css'

const previews = [
  {
    type: 'markdown',
    label: 'Notes',
    light: collabLight,
    dark: collabDark,
    alt: 'A Markdown document with a pending suggestion and a comment thread between two teammates',
  },
  {
    type: 'dbml',
    label: 'Data schema',
    light: schemaLight,
    dark: schemaDark,
    alt: 'A DBML schema drawn as tables and relations: orders, items, payments, refunds and an outbox',
  },
  {
    type: 'mermaid',
    label: 'Flow diagram',
    light: flowLight,
    dark: flowDark,
    alt: 'A Mermaid sequence diagram of a checkout and payment flow',
  },
  {
    type: 'architecture',
    label: 'System drawing',
    light: architectureLight,
    dark: architectureDark,
    alt: 'An Architecture document: hosts, systems and their connections drawn on a canvas',
  },
] as const

const AUTO_ADVANCE_MS = 5000

const heroScreens = [
  {
    id: 'flow',
    type: 'mermaid',
    text: 'A sequence diagram rendered from Mermaid text.',
    shot: previews[2],
  },
  {
    id: 'schema',
    type: 'dbml',
    text: 'Tables and relations drawn from DBML source.',
    shot: previews[1],
  },
  {
    id: 'architecture',
    type: 'architecture',
    text: 'Hosts, systems and the connections between them on one canvas.',
    shot: previews[3],
  },
  {
    id: 'collab',
    type: 'markdown',
    text: 'A document under review: a pending suggestion and a comment thread.',
    shot: previews[0],
  },
] as const

const collabShot = previews[0]

const aiShot = {
  light: aiLight,
  dark: aiDark,
  alt: 'The document chat: the assistant proposed a change that now waits for review',
} as const

const shareShot = {
  light: shareLight,
  dark: shareDark,
  alt: 'A document opened from a shared link, read-only',
} as const

const documentTypes = ['markdown', 'dbml', 'mermaid', 'architecture'] as const

const collaboration = [
  {
    term: 'view',
    text: 'Read the document as it stands.',
  },
  {
    term: 'edit',
    text: 'Type together in real time and see where everyone is.',
  },
  {
    term: 'suggest',
    text: 'Propose a change. It waits for an editor to accept or reject it, and the document stays as it was until then.',
  },
] as const

const mcpTools = [
  'search_documents',
  'read_document',
  'create_document',
  'edit_document_content',
  'edit_architecture',
  'add_comment',
] as const

const workspaceParts = [
  {
    name: 'Command search',
    text: 'Press Ctrl+K on any page to find a document.',
  },
  {
    name: 'Comments',
    text: 'Comment on a passage and mention a teammate in the thread.',
  },
  {
    name: 'Revisions',
    text: 'Save a version of a document and read earlier ones.',
  },
  {
    name: 'Trash',
    text: 'A deleted document waits in the trash until you restore it.',
  },
  {
    name: 'Invites',
    text: 'Invite someone to a workspace with an emailed link.',
  },
  {
    name: 'Themes',
    text: 'Light and dark, following your system unless you choose.',
  },
] as const

const sectionLabel = 'font-mono text-xs text-muted-foreground'
const sectionHeading =
  'text-2xl leading-tight font-semibold tracking-tight text-balance sm:text-3xl'

function HeroStack({ dark }: { dark: boolean }) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const shown =
    heroScreens.find((item) => item.id === activeId) ?? heroScreens[3]

  return (
    <div className='hero-visual'>
      <div className='hero-stack'>
        {heroScreens.map((item) => (
          <figure
            key={item.id}
            tabIndex={0}
            aria-label={`${item.type}: ${item.text}`}
            className={`hero-screen hero-screen-${item.id}`}
            onMouseEnter={() => setActiveId(item.id)}
            onMouseLeave={() => setActiveId(null)}
            onFocus={() => setActiveId(item.id)}
            onBlur={() => setActiveId(null)}
          >
            <img
              src={dark ? item.shot.dark : item.shot.light}
              alt=''
              width='1280'
              height='800'
              className='block h-auto w-full'
            />
          </figure>
        ))}
      </div>
      <p
        aria-live='polite'
        className='mt-8 flex min-h-11 items-baseline gap-3 text-sm text-muted-foreground'
        style={{ marginInline: '4%' }}
      >
        <span className='rounded-xs bg-border px-2 py-1 font-mono text-[10.5px] text-foreground'>
          {shown.type}
        </span>
        <span>{shown.text}</span>
      </p>
    </div>
  )
}

type ShotProps = {
  shot: { light: string; dark: string; alt: string }
  dark: boolean
}

function Shot({ shot, dark }: ShotProps) {
  return (
    <div className='min-w-0 overflow-hidden rounded-md border border-border bg-background'>
      <img
        src={dark ? shot.dark : shot.light}
        alt={shot.alt}
        width='1280'
        height='800'
        loading='lazy'
        className='block h-auto w-full'
      />
    </div>
  )
}

export function WelcomePage() {
  const { redirect } = useSearch({ from: '/' })
  const { resolvedTheme, setTheme } = useTheme()
  const [position, setPosition] = useState(0)
  const [instant, setInstant] = useState(false)
  const [inView, setInView] = useState(false)
  const [seen, setSeen] = useState(false)
  const documentsRef = useRef<HTMLElement>(null)
  const count = previews.length
  const active = position % count
  const advance = () => setPosition((value) => value + 1)
  const onTrackEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    if (position === count) {
      setInstant(true)
      setPosition(0)
    }
  }

  useEffect(() => {
    if (!instant) return
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => setInstant(false))
    )
    return () => cancelAnimationFrame(frame)
  }, [instant])

  useEffect(() => {
    const node = documentsRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = entry?.isIntersecting ?? false
        setInView(visible)
        if (visible) setSeen(true)
      },
      { threshold: 0.3 }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <main
      lang='en'
      className='welcome-page min-h-svh bg-background text-foreground'
    >
      <a href='#main-content' className='welcome-skip'>
        Skip navigation
      </a>
      <header className='border-b border-border'>
        <nav
          aria-label='Main navigation'
          className='mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-10'
        >
          <Link
            to='/'
            aria-label='DokuDocs home'
            className='welcome-link inline-flex min-h-11 items-center gap-2 font-semibold'
          >
            <Logo aria-hidden='true' />
            <span>Dokudocs</span>
          </Link>
          <div className='flex items-center gap-4 sm:gap-7'>
            <a
              href='#documents'
              className='welcome-link hidden min-h-11 items-center text-sm text-muted-foreground md:inline-flex'
            >
              Documents
            </a>
            <a
              href='#together'
              className='welcome-link hidden min-h-11 items-center text-sm text-muted-foreground md:inline-flex'
            >
              Collaboration
            </a>
            <a
              href='#ai'
              className='welcome-link hidden min-h-11 items-center text-sm text-muted-foreground md:inline-flex'
            >
              AI and MCP
            </a>
            <Link
              to='/sign-in'
              search={{ redirect }}
              className='welcome-link inline-flex min-h-11 items-center text-sm font-medium'
            >
              Sign in
            </Link>
          </div>
        </nav>
      </header>

      <section
        id='main-content'
        tabIndex={-1}
        className='mx-auto grid max-w-7xl gap-10 px-5 pt-12 pb-10 sm:px-10 sm:pt-20 sm:pb-16 lg:grid-cols-[1fr_1.15fr] lg:items-center lg:gap-14'
      >
        <div>
          <h1 className='welcome-heading max-w-xl font-semibold text-balance'>
            Docs, schemas and diagrams in one workspace
          </h1>
          <p className='mt-6 max-w-md text-base leading-7 text-muted-foreground'>
            Write Markdown with your team in real time. Keep DBML schemas,
            Mermaid flows and architecture drawings beside it, and ask an AI
            whose edits you review before they land.
          </p>
          <div className='mt-8 flex flex-wrap items-center gap-5'>
            <Link
              to='/sign-up'
              className='welcome-primary inline-flex min-h-12 items-center rounded-sm bg-signal px-6 text-sm font-medium text-signal-foreground'
            >
              Create an account
            </Link>
            <a
              href='#documents'
              className='welcome-link inline-flex min-h-12 items-center text-sm underline underline-offset-4'
            >
              See the document types
            </a>
          </div>
        </div>
        <HeroStack dark={resolvedTheme === 'dark'} />
      </section>

      <section
        aria-label='Document types'
        className='border-y border-border bg-card'
      >
        <div className='mx-auto flex max-w-7xl flex-col gap-4 px-5 py-6 sm:px-10 md:flex-row md:items-center md:justify-between'>
          <p className='text-sm text-muted-foreground'>
            Four document types, one place to search, share and review.
          </p>
          <ul className='flex flex-wrap gap-2'>
            {documentTypes.map((type) => (
              <li
                key={type}
                className='rounded-xs bg-border px-2 py-1 font-mono text-[10.5px] text-foreground'
              >
                {type}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        id='documents'
        ref={documentsRef}
        className='mx-auto max-w-7xl px-5 py-14 sm:px-10 sm:py-20'
      >
        <div className='flex flex-col justify-between gap-6 lg:flex-row lg:items-end'>
          <div className='max-w-xl'>
            <h2 className={sectionHeading}>
              Notes, schemas and flows stay together
            </h2>
            <p className='mt-3 text-sm leading-6 text-muted-foreground'>
              These are screens from DokuDocs. An Architecture document draws
              your hosts, systems and the connections between them on a canvas,
              and opens like any other document.
            </p>
          </div>
          <div
            role='group'
            aria-label='Choose an editor preview'
            className='flex flex-wrap gap-2'
          >
            {previews.map((item, index) => (
              <button
                key={item.type}
                type='button'
                aria-pressed={active === index}
                aria-controls='editor-preview'
                onClick={() => setPosition(index)}
                className='welcome-format min-h-12 rounded-sm border border-input px-4 text-left'
              >
                <span className='block text-sm font-medium'>{item.label}</span>
                <span className='block font-mono text-xs text-muted-foreground'>
                  {item.type}
                </span>
                {active === index && (
                  <span
                    aria-hidden='true'
                    className='welcome-progress'
                    data-paused={!inView}
                    style={{ animationDuration: `${AUTO_ADVANCE_MS}ms` }}
                    onAnimationEnd={advance}
                  />
                )}
              </button>
            ))}
          </div>
        </div>
        <figure id='editor-preview' className='mt-8'>
          <div className='overflow-hidden rounded-md border border-border bg-background'>
            <div
              className='welcome-track'
              data-instant={instant}
              style={{ transform: `translateX(-${position * 100}%)` }}
              onTransitionEnd={onTrackEnd}
            >
              {[...previews, previews[0]].map((item, index) => (
                <div
                  key={`${item.type}-${index}`}
                  aria-hidden={index % count !== active}
                  className='welcome-slide'
                >
                  <img
                    src={resolvedTheme === 'dark' ? item.dark : item.light}
                    alt={item.alt}
                    width='1280'
                    height='800'
                    loading={seen ? 'eager' : 'lazy'}
                    className='block h-auto w-full'
                  />
                </div>
              ))}
            </div>
          </div>
          <figcaption
            aria-live='off'
            className='mt-3 text-xs text-muted-foreground'
          >
            {previews[active]!.alt}
          </figcaption>
        </figure>
      </section>

      <section id='together' className='border-y border-border bg-card'>
        <div className='mx-auto grid max-w-7xl gap-10 px-5 py-14 sm:px-10 sm:py-20 lg:grid-cols-[1fr_1.25fr] lg:items-center lg:gap-14'>
          <div>
            <h2 className={sectionHeading}>
              Edit together, then review before a change lands
            </h2>
            <p className='mt-4 max-w-md text-base leading-7 text-muted-foreground'>
              Everyone types in the same document at once. When a change needs a
              second pair of eyes, suggest it instead of making it, and talk it
              through in a comment on the passage.
            </p>
            <dl className='mt-8 border-t border-border'>
              {collaboration.map((item) => (
                <div
                  key={item.term}
                  className='grid gap-1 border-b border-border py-4 sm:grid-cols-[5rem_1fr] sm:gap-6'
                >
                  <dt className={sectionLabel}>{item.term}</dt>
                  <dd className='text-sm leading-6'>{item.text}</dd>
                </div>
              ))}
            </dl>
          </div>
          <Shot shot={collabShot} dark={resolvedTheme === 'dark'} />
        </div>
      </section>

      <section
        id='ai'
        className='mx-auto grid max-w-7xl gap-10 px-5 py-14 sm:px-10 sm:py-20 lg:grid-cols-[1.25fr_1fr] lg:items-center lg:gap-14'
      >
        <div className='lg:order-2'>
          <h2 className={sectionHeading}>
            Ask your documents. Review what the agent proposes
          </h2>
          <p className='mt-4 max-w-md text-base leading-7 text-muted-foreground'>
            The chat answers from documents you can read and links the ones it
            used. Mention a document in a question to make sure it reads that
            one.
          </p>
          <p className='mt-4 max-w-md text-base leading-7 text-muted-foreground'>
            Ask the agent to change a document and the edit arrives as a
            suggestion marked AI assisted, for you to accept or reject like a
            teammate's. Changes to an Architecture canvas, and actions such as
            moving a document to the trash, wait for your approval in the chat.
            It can only touch what you could edit yourself.
          </p>
        </div>
        <div className='lg:order-1'>
          <Shot shot={aiShot} dark={resolvedTheme === 'dark'} />
        </div>
      </section>

      <section id='mcp' className='border-y border-border bg-card'>
        <div className='mx-auto grid max-w-7xl gap-10 px-5 py-14 sm:px-10 sm:py-20 md:grid-cols-[1fr_1.1fr] md:gap-14'>
          <div>
            <h2 className={sectionHeading}>Use your own AI app</h2>
            <p className='mt-4 max-w-md text-base leading-7 text-muted-foreground'>
              Connect an MCP client to Dokudocs with a key from your account.
              The client acts as you, with your access. When it edits a document
              it saves a named version first, so one restore undoes the change.
            </p>
          </div>
          <pre
            tabIndex={0}
            aria-label='MCP endpoint and tools'
            className='welcome-code min-w-0 overflow-x-auto rounded-md border border-border bg-background p-4 font-mono text-xs leading-6'
          >
            <code>
              {`POST /api/v1/mcp\nAuthorization: Bearer <your MCP key>\n\ntools\n${mcpTools.map((tool) => `  ${tool}`).join('\n')}\n  ...and more`}
            </code>
          </pre>
        </div>
      </section>

      <section
        id='sharing'
        className='mx-auto grid max-w-7xl gap-10 px-5 py-14 sm:px-10 sm:py-20 lg:grid-cols-[1fr_1.25fr] lg:items-center lg:gap-14'
      >
        <div>
          <h2 className={sectionHeading}>
            Share a read-only link when it is ready
          </h2>
          <p className='mt-4 max-w-md text-base leading-7 text-muted-foreground'>
            Send a link to someone outside the workspace. They read the document
            and cannot change it. You choose which documents have a link, and
            you control access to every other page.
          </p>
        </div>
        <Shot shot={shareShot} dark={resolvedTheme === 'dark'} />
      </section>

      <section className='mx-auto max-w-7xl px-5 py-14 sm:px-10 sm:py-20'>
        <h2 className={sectionHeading}>The rest of the workspace</h2>
        <ul className='mt-8 grid border-t border-border md:grid-cols-2 md:gap-x-12'>
          {workspaceParts.map((item) => (
            <li
              key={item.name}
              className='grid gap-1 border-b border-border py-5 sm:grid-cols-[9rem_1fr] sm:gap-6'
            >
              <span className='text-sm font-medium'>{item.name}</span>
              <span className='text-sm leading-6 text-muted-foreground'>
                {item.text}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className='border-t border-border bg-card'>
        <div className='mx-auto flex max-w-7xl flex-col gap-6 px-5 py-14 sm:px-10 sm:py-20 md:flex-row md:items-center md:justify-between'>
          <h2 className={sectionHeading}>Start a workspace for your team</h2>
          <div className='flex flex-wrap items-center gap-5'>
            <Link
              to='/sign-up'
              className='welcome-primary inline-flex min-h-12 items-center rounded-sm bg-signal px-6 text-sm font-medium text-signal-foreground'
            >
              Create an account
            </Link>
            <Link
              to='/sign-in'
              search={{ redirect }}
              className='welcome-link inline-flex min-h-12 items-center text-sm underline underline-offset-4'
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <footer className='border-t border-border'>
        <div className='mx-auto flex max-w-7xl flex-col justify-between gap-5 px-5 py-7 sm:px-10 md:flex-row md:items-center'>
          <Link
            to='/'
            className='welcome-link inline-flex min-h-11 items-center gap-2 text-sm font-medium'
          >
            <Logo aria-hidden='true' className='size-5' />
            Dokudocs
          </Link>
          <nav
            aria-label='Service information'
            className='flex flex-wrap items-center gap-x-6 gap-y-2 text-sm'
          >
            <a
              href='#documents'
              className='welcome-link inline-flex min-h-11 items-center text-muted-foreground'
            >
              Documents
            </a>
            <a
              href='#ai'
              className='welcome-link inline-flex min-h-11 items-center text-muted-foreground'
            >
              AI and MCP
            </a>
            <Link
              to='/privacy'
              className='welcome-link inline-flex min-h-11 items-center'
            >
              Privacy policy
            </Link>
            <Link
              to='/terms'
              className='welcome-link inline-flex min-h-11 items-center'
            >
              Terms of use
            </Link>
            <button
              type='button'
              className='welcome-link min-h-11 text-muted-foreground'
              onClick={() =>
                setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
              }
              aria-label={
                resolvedTheme === 'dark' ? 'Use light theme' : 'Use dark theme'
              }
            >
              {resolvedTheme === 'dark' ? 'Light theme' : 'Dark theme'}
            </button>
          </nav>
        </div>
      </footer>
    </main>
  )
}
