import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { listArchitectureUses } from '../api/architecture-api'

/**
 * "Used in" on a Markdown, DBML, Mermaid or Architecture page: the canvases whose
 * elements link here, each opening the canvas on that element. Nothing shows when
 * there are none.
 */
// Up to this many links show inline; more collapse behind a toggle, closed at first.
const COLLAPSE_AFTER = 3

const isUUID = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

export function ArchitectureUses({
  workspaceID,
  documentID,
  className,
}: {
  workspaceID: string
  documentID: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const uses = useQuery({
    queryKey: ['architecture-uses', workspaceID, documentID],
    queryFn: ({ signal }) =>
      listArchitectureUses(workspaceID, documentID, signal),
    enabled: Boolean(workspaceID && documentID),
    retry: false,
    staleTime: 60_000,
  })
  if (!uses.data?.length) return null
  const collapsible = uses.data.length > COLLAPSE_AFTER
  return (
    <nav
      aria-label='Used in architecture'
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground ${className ?? ''}`}
    >
      {collapsible ? (
        <button
          type='button'
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className='inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-signal'
        >
          <ChevronRight
            aria-hidden
            className={`size-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
          />
          Used in ({uses.data.length})
        </button>
      ) : (
        <span>Used in</span>
      )}
      {(!collapsible || open) &&
        uses.data.map((use) => (
          <Link
            key={`${use.architectureId}:${use.elementId}`}
            to='/docs/$docId'
            params={{ docId: use.architectureId }}
            // The route takes only a UUID; an element named otherwise opens the canvas without a focus.
            search={
              isUUID(use.elementId)
                ? { nodeId: use.elementId, workspaceId: workspaceID }
                : { workspaceId: workspaceID }
            }
            className='text-signal hover:underline focus-visible:outline-2 focus-visible:outline-signal'
          >
            {use.title} › {use.elementName}
          </Link>
        ))}
    </nav>
  )
}
