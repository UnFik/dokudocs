import { useState } from 'react'
import { Link, useSearch } from '@tanstack/react-router'
import dbmlDark from '@/assets/landing/dbml-dark.webp'
import dbmlLight from '@/assets/landing/dbml-light.webp'
import markdownDark from '@/assets/landing/markdown-dark.webp'
import markdownLight from '@/assets/landing/markdown-light.webp'
import mermaidDark from '@/assets/landing/mermaid-dark.webp'
import { Logo } from '@/assets/logo'
import { useTheme } from '@/context/theme-provider'
import './welcome.css'

const previews = [
  {
    type: 'dbml',
    label: 'Data schema',
    light: dbmlLight,
    dark: dbmlDark,
    alt: 'DokuDocs DBML editor with its table relationship canvas',
  },
  {
    type: 'mermaid',
    label: 'Flow diagram',
    light: mermaidDark,
    dark: mermaidDark,
    alt: 'A Mermaid diagram in a DokuDocs Markdown document',
  },
  {
    type: 'markdown',
    label: 'Notes',
    light: markdownLight,
    dark: markdownDark,
    alt: 'A Markdown document open in the DokuDocs editor',
  },
] as const

function SchemaIllustration() {
  return (
    <figure className='welcome-schema'>
      <svg
        viewBox='0 0 600 460'
        role='img'
        aria-labelledby='schema-title schema-description'
      >
        <title id='schema-title'>
          Workspaces, documents, revisions, and comments connected
        </title>
        <desc id='schema-description'>
          A simplified excerpt of the DokuDocs schema. A workspace contains
          documents. Each document has revisions and comment threads.
        </desc>
        <g
          className='schema-links'
          fill='none'
          stroke='currentColor'
          strokeWidth='1.5'
        >
          <path pathLength='1' d='M250 96 H290 V186 H326' />
          <path pathLength='1' d='M326 228 H286 V373 H260' />
          <path pathLength='1' d='M447 266 V324' />
        </g>
        <g className='schema-node schema-node-1' transform='translate(24 36)'>
          <rect width='226' height='118' rx='6' />
          <text x='18' y='32' className='schema-name'>
            workspaces
          </text>
          <path d='M0 48 H226' />
          <text x='18' y='77' className='schema-field'>
            id
          </text>
          <text x='18' y='100' className='schema-field'>
            name
          </text>
        </g>
        <g className='schema-node schema-node-2' transform='translate(326 148)'>
          <rect width='246' height='118' rx='6' />
          <text x='18' y='32' className='schema-name'>
            documents
          </text>
          <path d='M0 48 H246' />
          <text x='18' y='77' className='schema-field'>
            workspace_id
          </text>
          <text x='18' y='100' className='schema-field'>
            title
          </text>
        </g>
        <g className='schema-node schema-node-3' transform='translate(24 324)'>
          <rect width='236' height='118' rx='6' />
          <text x='18' y='32' className='schema-name'>
            document_revisions
          </text>
          <path d='M0 48 H236' />
          <text x='18' y='77' className='schema-field'>
            document_id
          </text>
          <text x='18' y='100' className='schema-field'>
            version_number
          </text>
        </g>
        <g className='schema-node schema-node-4' transform='translate(326 324)'>
          <rect width='246' height='118' rx='6' />
          <text x='18' y='32' className='schema-name'>
            comment_threads
          </text>
          <path d='M0 48 H246' />
          <text x='18' y='77' className='schema-field'>
            document_id
          </text>
          <text x='18' y='100' className='schema-field'>
            selected_text
          </text>
        </g>
      </svg>
      <figcaption className='mt-5 font-mono text-xs text-muted-foreground'>
        The DokuDocs schema, simplified.
      </figcaption>
    </figure>
  )
}

export function WelcomePage() {
  const { redirect } = useSearch({ from: '/' })
  const { resolvedTheme, setTheme } = useTheme()
  const [previewIndex, setPreviewIndex] = useState(1)
  const preview = previews[previewIndex]!

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
          className='mx-auto flex min-h-20 max-w-7xl items-center justify-between gap-4 px-5 sm:px-10'
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
              href='#editor'
              className='welcome-link hidden min-h-11 items-center text-sm text-muted-foreground sm:inline-flex'
            >
              Editor
            </a>
            <a
              href='#together'
              className='welcome-link hidden min-h-11 items-center text-sm text-muted-foreground sm:inline-flex'
            >
              Collaboration
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
        className='mx-auto grid max-w-7xl gap-10 px-5 pt-14 pb-12 sm:px-10 sm:pt-20 sm:pb-20 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-12'
      >
        <div>
          <h1 className='welcome-heading max-w-xl font-semibold tracking-tight text-balance'>
            Write it down.
            <br />
            <span className='text-muted-foreground'>Map it out.</span>
          </h1>
          <p className='mt-7 max-w-sm text-base leading-7 text-muted-foreground'>
            Keep Markdown notes, DBML schemas, and Mermaid diagrams in one
            shared workspace.
          </p>
          <div className='mt-8 flex flex-wrap items-center gap-5'>
            <Link
              to='/sign-up'
              className='welcome-primary inline-flex min-h-12 items-center rounded-sm bg-signal px-6 text-sm font-medium text-signal-foreground'
            >
              Create an account
            </Link>
            <a
              href='#editor'
              className='welcome-link inline-flex min-h-12 items-center text-sm underline underline-offset-4'
            >
              See the editor
            </a>
          </div>
        </div>
        <SchemaIllustration />
      </section>

      <section id='editor' className='border-y border-border bg-card'>
        <div className='mx-auto max-w-7xl px-5 py-10 sm:px-10 sm:py-16'>
          <div className='flex flex-col justify-between gap-6 lg:flex-row lg:items-end'>
            <div>
              <h2 className='text-2xl font-semibold tracking-tight sm:text-3xl'>
                Notes, schemas, flows.
              </h2>
              <p className='mt-2 text-sm text-muted-foreground'>
                Actual screens from DokuDocs.
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
                  aria-pressed={previewIndex === index}
                  aria-controls='editor-preview'
                  onClick={() => setPreviewIndex(index)}
                  className='welcome-format min-h-12 rounded-sm border border-input px-4 text-left'
                >
                  <span className='block text-sm font-medium'>
                    {item.label}
                  </span>
                  <span className='block font-mono text-xs text-muted-foreground'>
                    {item.type}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <figure id='editor-preview' className='mt-8'>
            <div
              key={preview.type}
              data-format={preview.type}
              className='welcome-preview overflow-hidden rounded-md border border-border bg-background'
            >
              <img
                src={resolvedTheme === 'dark' ? preview.dark : preview.light}
                alt={preview.alt}
                width='1280'
                height='800'
                loading='lazy'
                className='block h-auto w-full'
              />
            </div>
            <figcaption
              aria-live='polite'
              className='mt-3 text-xs text-muted-foreground'
            >
              {preview.alt}
            </figcaption>
          </figure>
        </div>
      </section>

      <section
        id='together'
        className='mx-auto grid max-w-7xl gap-8 px-5 py-16 sm:px-10 sm:py-24 md:grid-cols-[1fr_1.05fr] md:gap-12'
      >
        <h2 className='max-w-md text-3xl leading-tight font-semibold tracking-tight sm:text-4xl'>
          Work on the
          <br />
          same page.
        </h2>
        <div className='max-w-lg'>
          <p className='text-lg leading-8 text-muted-foreground'>
            Edit together in real time. Review suggestions and revisions, then
            share a read-only link when the document is ready.
          </p>
          <p className='mt-5 text-sm leading-6 text-muted-foreground'>
            You control access to each page.
          </p>
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
