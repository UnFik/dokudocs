import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import type { DocType } from '@/types/dokudocs'
import { FileText } from 'lucide-react'
import {
  getDocument,
  lookupChatDocuments,
  type ChatDocumentHit,
} from '@/lib/domain-api'
import { Badge } from '@/components/ui/badge'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { DocThumbnailPreview } from '@/features/docs/components/doc-thumbnail-preview'
import { DocTypeBadge } from '@/features/docs/components/doc-type-badge'

type CardHit = Pick<ChatDocumentHit, 'id' | 'title' | 'projectName'> & {
  /** Left out where the caller does not know it; the card then learns it when it opens. */
  type?: string
}

/** Most documents named in one lookup; the server refuses more. */
const MAX_REFERENCES = 20

type References = {
  workspaceID: string
  /** Undefined while the lookup runs; a missing id is a document the User cannot read. */
  hits?: Map<string, ChatDocumentHit>
}

const ReferencesContext = createContext<References | undefined>(undefined)
const CurrentDocumentContext = createContext<string | undefined>(undefined)

/** Tells the references inside which document the chat panel sits on, so they do not navigate to it. */
export function CurrentDocument({
  documentID,
  children,
}: {
  documentID: string
  children: ReactNode
}) {
  return (
    <CurrentDocumentContext.Provider value={documentID}>
      {children}
    </CurrentDocumentContext.Provider>
  )
}

/**
 * Names the documents one answer refers to with a single request. Documents the
 * User cannot read come back missing and show as plain text.
 */
export function DocumentReferences({
  workspaceID,
  ids,
  children,
}: {
  workspaceID?: string
  ids: string[]
  children: ReactNode
}) {
  const wanted = [...new Set(ids.map((id) => id.toLowerCase()))]
    .sort()
    .slice(0, MAX_REFERENCES)
  const lookup = useQuery({
    queryKey: ['rag-document-lookup', workspaceID, wanted.join(',')],
    queryFn: ({ signal }) =>
      lookupChatDocuments(workspaceID ?? '', wanted, signal),
    enabled: Boolean(workspaceID) && wanted.length > 0,
    staleTime: 60_000,
  })
  if (!workspaceID) return <>{children}</>
  const hits = lookup.data
    ? new Map(lookup.data.map((hit) => [hit.id.toLowerCase(), hit]))
    : lookup.isError
      ? new Map<string, ChatDocumentHit>()
      : undefined
  return (
    <ReferencesContext.Provider value={{ workspaceID, hits }}>
      {children}
    </ReferencesContext.Provider>
  )
}

/** True where a pointer can hover; on touch screens a reference is a plain link. */
function useCanHover() {
  const [canHover, setCanHover] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(hover: hover)').matches
  )
  useEffect(() => {
    const query = window.matchMedia('(hover: hover)')
    const update = () => setCanHover(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return canHover
}

const documentHref = (workspaceID: string, documentID: string) =>
  `/docs/${encodeURIComponent(documentID)}?workspaceId=${encodeURIComponent(workspaceID)}`

const linkClass =
  'text-signal underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded-sm'

/**
 * A document named in an answer: a link with a card on hover and focus showing
 * its preview, title, type and project. Where the document is missing or not
 * readable it shows the fallback as plain text.
 */
export function DocumentReference({
  documentID,
  label,
  fallback,
}: {
  documentID: string
  /** What the link says; the document's title when left out. */
  label?: ReactNode
  /** Plain text for a document that cannot be shown. */
  fallback?: ReactNode
}) {
  const references = useContext(ReferencesContext)
  const current = useContext(CurrentDocumentContext)
  const hit = references?.hits?.get(documentID.toLowerCase())
  if (!references || !hit)
    return (
      <span
        className={
          references?.hits && !hit ? 'text-muted-foreground' : undefined
        }
      >
        {references?.hits && !hit
          ? (fallback ?? label)
          : (label ?? fallback ?? null)}
      </span>
    )
  const text = label ?? hit.title
  const sameDocument = current?.toLowerCase() === documentID.toLowerCase()
  const trigger = sameDocument ? (
    <span
      tabIndex={0}
      aria-label={`${hit.title} (this document)`}
      className={`${linkClass} cursor-default decoration-dotted`}
    >
      {text}
    </span>
  ) : (
    <a
      href={documentHref(references.workspaceID, hit.id)}
      className={linkClass}
    >
      {text}
    </a>
  )
  return (
    <DocumentCard hit={hit} workspaceID={references.workspaceID}>
      {trigger}
    </DocumentCard>
  )
}

/** The hover card around one document link; its content loads when it opens. */
export function DocumentCard({
  hit,
  workspaceID,
  children,
}: {
  hit: CardHit
  workspaceID: string
  children: ReactNode
}) {
  const canHover = useCanHover()
  const [open, setOpen] = useState(false)
  if (!canHover) return <>{children}</>
  return (
    <HoverCard
      open={open}
      onOpenChange={setOpen}
      openDelay={250}
      closeDelay={80}
    >
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        side='top'
        align='start'
        className='w-64 p-0'
        onEscapeKeyDown={() => setOpen(false)}
      >
        <CardBody hit={hit} workspaceID={workspaceID} open={open} />
      </HoverCardContent>
    </HoverCard>
  )
}

function CardBody({
  hit,
  workspaceID,
  open,
}: {
  hit: CardHit
  workspaceID: string
  open: boolean
}) {
  const document = useQuery({
    queryKey: ['rag-document-card', workspaceID, hit.id],
    queryFn: ({ signal }) => getDocument(workspaceID, hit.id, signal),
    enabled: open,
    staleTime: 60_000,
    retry: false,
  })
  const type = (document.data?.type ?? hit.type) as DocType | undefined
  return (
    <div className='space-y-2 p-3'>
      <div
        role='img'
        aria-label={`Preview of ${hit.title}`}
        data-card-thumbnail
        className='relative h-28 w-full overflow-hidden rounded-sm border bg-muted/20'
      >
        {document.data ? (
          <DocThumbnailPreview
            docId={hit.id}
            workspaceID={workspaceID}
            type={document.data.type}
            content={document.data.content}
            thumbnail={
              document.data.thumbnail || document.data.thumbnailPreview
            }
            thumbnailDark={
              document.data.thumbnailDark || document.data.thumbnailPreviewDark
            }
            className='h-full w-full'
          />
        ) : (
          <div className='flex h-full items-center justify-center text-muted-foreground'>
            <FileText className='size-5' aria-hidden='true' />
          </div>
        )}
      </div>
      <p className='truncate text-[13px] font-medium'>{hit.title}</p>
      <p className='flex items-center gap-2 text-xs text-muted-foreground'>
        {type ? <DocTypeBadge type={type} /> : null}
        <span className='truncate font-mono'>
          {hit.projectName || 'No project'}
        </span>
      </p>
    </div>
  )
}

/** A tool call in a chat: its name, and the document it worked on as a reference. */
export function ToolChip({
  name,
  documentID,
  suffix,
}: {
  name: string
  documentID?: string
  suffix?: ReactNode
}) {
  return (
    <>
      <Badge variant='tag'>{name}</Badge>
      {documentID ? (
        <DocumentReference
          documentID={documentID}
          fallback='Document not available'
        />
      ) : null}
      {suffix}
    </>
  )
}
