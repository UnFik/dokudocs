import { Link } from '@tanstack/react-router'
import { Logo } from '@/assets/logo'

const contact = 'fikriilhamarifin27@gmail.com'

const privacySections = [
  {
    title: 'Who handles your data',
    text: 'The operator of this DokuDocs service manages accounts and workspace data. The contact address below is available for privacy questions and requests. If your organization runs its own DokuDocs instance, contact that instance’s operator about its storage and hosting practices.',
  },
  {
    title: 'What the service stores',
    text: 'DokuDocs stores account details such as your email address and profile name, along with a password hash when you register with a password. It also stores the workspaces, documents, uploaded files, comments, suggestions, revisions, and sharing settings you create or use. These records support sign-in, editing, collaboration, and document access.',
  },
  {
    title: 'Cookies and local copies',
    text: 'The browser stores session and preference information, including your theme choice. Document features may also keep local copies in browser storage to support editing and offline access. Clearing browser data removes local copies and settings; it does not delete documents stored on the server. Use a device you trust when working with private content.',
  },
  {
    title: 'Sharing and access',
    text: 'Workspace membership and document permissions determine who can access your content. Anyone with an enabled public sharing link can read that document. Review access settings before sharing confidential material. People with access may retain copies of content they have already viewed or exported.',
  },
  {
    title: 'Optional services',
    text: 'When Google sign-in is enabled and you choose it, DokuDocs uses your Google identity, email address, and profile name for authentication. When AI features are enabled, document text may be sent to OpenAI for indexing, and questions and relevant document excerpts may be sent to generate answers. Hosting and network providers may also process connection data according to the deployment setup. Ask the operator which services are enabled before submitting sensitive information.',
  },
  {
    title: 'Storage and deletion',
    text: 'Retention depends on the instance’s storage, revision, and backup configuration. Moving a document to Trash is not the same as removing all stored copies. Clearing a browser cache does not remove server-side data or backups. Contact the operator for retention details or to request access, correction, export, or deletion of your personal data.',
  },
]

const termsSections = [
  {
    title: 'Using DokuDocs',
    text: 'These terms cover use of this DokuDocs service. By using it, you agree to these terms. If you use DokuDocs on behalf of an organization, you must have permission to do so. An independently hosted instance may have additional terms set by its operator.',
  },
  {
    title: 'Your account and access',
    text: 'Keep your sign-in credentials private and use only accounts and workspaces you are authorized to access. Tell the operator if you believe someone has accessed your account without permission. Workspace owners and document owners manage access to their content.',
  },
  {
    title: 'Your content',
    text: 'You retain your rights in the content you upload or create. You must have the right to store and share it. You authorize the service operator to store, process, and display that content as needed to provide the editing, collaboration, and sharing features you use. Sharing permissions determine who can view or edit a document.',
  },
  {
    title: 'Acceptable use',
    text: 'Do not use the service to distribute unlawful content, malware, or spam; attempt unauthorized access; disrupt other users; or infringe someone else’s rights. Do not share passwords, access tokens, or confidential information with people who are not authorized to receive them.',
  },
  {
    title: 'Availability and generated content',
    text: 'Features and availability may change, and interruptions can occur. Keep an independent copy of documents you rely on. If you use an enabled AI feature, review its answers against the original documents before relying on them. Generated answers are not a substitute for professional advice.',
  },
  {
    title: 'Ending use and updates',
    text: 'You can stop using DokuDocs at any time. Contact the operator for account closure and data requests. The operator may restrict access in response to misuse or a security issue. Updates to these terms will appear on this page; if you do not agree with updated terms, stop using the service. These terms do not exclude rights that applicable law protects.',
  },
]

export function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const isPrivacy = kind === 'privacy'
  const title = isPrivacy ? 'Privacy policy' : 'Terms of use'
  const sections = isPrivacy ? privacySections : termsSections

  return (
    <main lang='en' className='min-h-svh bg-background text-foreground'>
      <header className='border-b border-border'>
        <div className='mx-auto flex min-h-20 max-w-4xl items-center justify-between gap-4 px-5 sm:px-8'>
          <Link
            to='/'
            className='inline-flex min-h-11 items-center gap-2 rounded-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring'
          >
            <Logo aria-hidden='true' />
            <span>Dokudocs</span>
          </Link>
          <Link
            to='/'
            className='inline-flex min-h-11 items-center rounded-sm text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring'
          >
            Back to home
          </Link>
        </div>
      </header>
      <article className='mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-20'>
        <h1 className='text-3xl font-semibold tracking-tight sm:text-4xl'>
          {title}
        </h1>
        <p className='mt-4 text-sm text-muted-foreground'>
          Last updated: October 8, 2026
        </p>
        <p className='mt-6 text-base leading-7 text-muted-foreground'>
          {isPrivacy
            ? 'This page explains how DokuDocs handles account information and workspace content, and how to contact the service operator.'
            : 'Please read these terms before creating an account or sharing documents through this service.'}
        </p>
        {sections.map((section) => (
          <section className='mt-9' key={section.title}>
            <h2 className='text-lg font-semibold'>{section.title}</h2>
            <p className='mt-3 text-base leading-7 text-muted-foreground'>
              {section.text}
            </p>
          </section>
        ))}
        <section className='mt-9 border-t border-border pt-8'>
          <h2 className='text-lg font-semibold'>Contact</h2>
          <p className='mt-3 text-base leading-7 text-muted-foreground'>
            Send questions or requests to{' '}
            <a
              href={`mailto:${contact}`}
              className='rounded-sm break-all text-signal underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring'
            >
              {contact}
            </a>
            . Include the email address associated with your account, but never
            send your password.
          </p>
        </section>
        <nav
          aria-label='Legal pages'
          className='mt-9 flex flex-wrap gap-6 border-t border-border pt-6 text-sm'
        >
          <Link
            to='/privacy'
            className='inline-flex min-h-11 items-center rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring'
          >
            Privacy policy
          </Link>
          <Link
            to='/terms'
            className='inline-flex min-h-11 items-center rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring'
          >
            Terms of use
          </Link>
        </nav>
      </article>
    </main>
  )
}
