import { useMemo, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  requestCatalogEntry,
  type CatalogRequestOutcome,
} from '../api/catalog-api'
import type { PaletteItem } from '../lib/canvas-actions'
import { groupCatalog, type CatalogEntry } from '../lib/catalog'
import { CatalogIcon } from './catalog-icon'
import { paletteDrag } from './palette-drag'

const OPEN_AT_START = new Set([
  'host:compute',
  'host:paas',
  'system:frontend',
  'system:backend',
  'system:database',
  'system:broker',
])

export type PaletteProps = {
  workspaceID: string
  catalog: CatalogEntry[] | undefined
  loading: boolean
  error: boolean
  onRetry: () => void
  /** Adds an item without dragging: into the selected container, or in view. */
  onAdd: (item: PaletteItem) => void
  /** Why nothing can be added right now, or null. */
  blocked: string | null
  /** A warning shown above the list, such as nearing the element limit. */
  warning: string | null
}

function PaletteRow({
  item,
  label,
  slug,
  subkind,
  disabled,
  onAdd,
}: {
  item: PaletteItem
  label: string
  slug: string | null
  subkind?: string
  disabled: boolean
  onAdd: (item: PaletteItem) => void
}) {
  return (
    <button
      type='button'
      draggable={!disabled}
      disabled={disabled}
      onDragStart={(event) => {
        paletteDrag.current = item
        event.dataTransfer.effectAllowed = 'copy'
        event.dataTransfer.setData('text/plain', item.name)
      }}
      onDragEnd={() => (paletteDrag.current = null)}
      onClick={() => onAdd(item)}
      title={
        disabled
          ? undefined
          : `Drag onto the canvas, or press Enter to add ${label}`
      }
      className='flex min-h-8 w-full cursor-grab items-center gap-2 rounded-[4px] px-1.5 text-left text-[12.5px] hover:bg-accent focus-visible:outline-2 focus-visible:outline-signal disabled:cursor-not-allowed disabled:opacity-50'
    >
      <CatalogIcon slug={slug} subkind={subkind} size={20} />
      <span className='truncate'>{label}</span>
    </button>
  )
}

export function CatalogPalette(props: PaletteProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(OPEN_AT_START)
  const sections = useMemo(
    () => groupCatalog(props.catalog ?? [], query),
    [props.catalog, query]
  )
  const trimmed = query.trim()
  const groupMatches = !trimmed || 'group'.includes(trimmed.toLowerCase())
  const disabled = Boolean(props.blocked)

  return (
    <div className='flex flex-col gap-3 md:min-h-0 md:flex-1'>
      <div className='flex flex-col gap-1'>
        <label
          htmlFor='architecture-palette-search'
          className='font-mono text-[11px] text-muted-foreground'
        >
          search the catalog
        </label>
        <Input
          id='architecture-palette-search'
          type='search'
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder='Go, Kafka, Cloud Run…'
          className='h-8 text-[12.5px]'
          autoComplete='off'
        />
      </div>
      {props.warning && <p className='text-xs text-warn'>{props.warning}</p>}
      {props.blocked && (
        <p className='text-xs text-muted-foreground'>{props.blocked}</p>
      )}

      <div
        className='-mx-1 max-h-60 overflow-y-auto px-1 md:max-h-none md:min-h-0 md:flex-1'
        role='list'
        aria-label='Catalog'
      >
        {props.loading && (
          <p className='px-1.5 py-2 text-xs text-muted-foreground'>
            Loading the catalog…
          </p>
        )}
        {props.error && (
          <div className='flex flex-col items-start gap-2 px-1.5 py-2 text-xs'>
            <p>The catalog could not be loaded.</p>
            <Button size='sm' variant='outline' onClick={props.onRetry}>
              Try again
            </Button>
          </div>
        )}
        {!props.loading &&
          !props.error &&
          sections.map((section) => {
            const key = `${section.category}:${section.subkind}`
            const expanded = Boolean(trimmed) || open.has(key)
            return (
              <div key={key} role='listitem'>
                <button
                  type='button'
                  aria-expanded={expanded}
                  onClick={() =>
                    setOpen((current) => {
                      const next = new Set(current)
                      if (next.has(key)) next.delete(key)
                      else next.add(key)
                      return next
                    })
                  }
                  className='flex w-full items-center gap-1 rounded-[4px] px-1 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-signal'
                >
                  {expanded ? (
                    <ChevronDown className='size-3' aria-hidden />
                  ) : (
                    <ChevronRight className='size-3' aria-hidden />
                  )}
                  <span className='flex-1 text-left'>
                    {section.category} · {section.subkind}
                  </span>
                  <span className='tabular-nums'>{section.entries.length}</span>
                </button>
                {expanded &&
                  section.entries.map((entry) => (
                    <PaletteRow
                      key={entry.slug}
                      item={{
                        kind: entry.category === 'host' ? 'host' : 'system',
                        catalog: entry.slug,
                        name: entry.name,
                      }}
                      label={entry.name}
                      slug={entry.slug}
                      subkind={entry.subkind}
                      disabled={disabled}
                      onAdd={props.onAdd}
                    />
                  ))}
              </div>
            )
          })}
        {!props.loading && !props.error && groupMatches && (
          <div role='listitem'>
            <p className='px-1 py-1 font-mono text-[11px] text-muted-foreground'>
              group
            </p>
            <PaletteRow
              item={{ kind: 'group', catalog: null, name: 'Group' }}
              label='Group'
              slug='lucide-square-dashed'
              disabled={disabled}
              onAdd={props.onAdd}
            />
          </div>
        )}
        {!props.loading &&
          !props.error &&
          trimmed &&
          !sections.length &&
          !groupMatches && (
            <MissingEntry
              key={trimmed}
              query={trimmed}
              workspaceID={props.workspaceID}
              disabled={disabled}
              onAdd={props.onAdd}
            />
          )}
      </div>
    </div>
  )
}

/** The palette's empty search: use a generic Service now, and ask for the entry. */
function MissingEntry({
  query,
  workspaceID,
  disabled,
  onAdd,
}: {
  query: string
  workspaceID: string
  disabled: boolean
  onAdd: (item: PaletteItem) => void
}) {
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState(query)
  const [category, setCategory] = useState<'system' | 'host' | 'protocol'>(
    'system'
  )
  const [website, setWebsite] = useState('')
  const [note, setNote] = useState('')
  const request = useMutation<CatalogRequestOutcome, Error>({
    mutationFn: () =>
      requestCatalogEntry({
        workspaceID,
        name,
        category,
        website: website.trim(),
        note: note.trim(),
      }),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    request.mutate()
  }
  const outcome = request.data
  return (
    <div className='flex flex-col gap-2 px-1.5 py-2 text-[12.5px]'>
      <p className='font-medium'>No “{query}” in the catalog.</p>
      <p className='text-xs text-muted-foreground'>
        The catalog is the same for every workspace and the Dokudocs team adds
        to it. Use a generic Service now and change its type later from the
        properties panel.
      </p>
      <div className='rounded-[4px] border border-dashed border-input'>
        <PaletteRow
          item={{ kind: 'system', catalog: 'service', name: query }}
          label={`Add “${query}” as a Service`}
          slug='service'
          disabled={disabled}
          onAdd={onAdd}
        />
      </div>
      {outcome?.kind === 'sent' && (
        <p role='status' className='flex items-start gap-1.5 text-xs'>
          <span
            aria-hidden
            className='mt-1 size-1.5 shrink-0 rounded-[1px] bg-ok'
          />
          {outcome.alreadyRequested
            ? `“${outcome.name}” was already requested; your vote is counted (${outcome.votes}). You will get a notification when it is added.`
            : `Request for “${outcome.name}” sent. You will get a notification when it is added.`}
        </p>
      )}
      {outcome?.kind === 'in-catalog' && (
        <p role='status' className='text-xs'>
          This is already in the catalog as{' '}
          <code className='font-mono'>{outcome.slug}</code>. Search for it by
          that name.
        </p>
      )}
      {!outcome && !formOpen && (
        <Button
          size='sm'
          variant='outline'
          className='self-start'
          onClick={() => setFormOpen(true)}
        >
          Request “{query}”
        </Button>
      )}
      {!outcome && formOpen && (
        <form
          className='flex flex-col gap-1.5'
          onSubmit={submit}
          aria-label='Request a catalog entry'
        >
          <label
            htmlFor='catalog-request-name'
            className='font-mono text-[11px] text-muted-foreground'
          >
            name
          </label>
          <Input
            id='catalog-request-name'
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            className='h-8 text-[12.5px]'
          />
          <label
            htmlFor='catalog-request-kind'
            className='font-mono text-[11px] text-muted-foreground'
          >
            kind
          </label>
          <select
            id='catalog-request-kind'
            value={category}
            onChange={(e) => setCategory(e.target.value as typeof category)}
            className='h-8 rounded-[4px] border border-input bg-card px-2 text-[12.5px] focus-visible:outline-2 focus-visible:outline-signal'
          >
            <option value='system'>
              System (language, framework, database, service)
            </option>
            <option value='host'>Host (server, cloud service, platform)</option>
            <option value='protocol'>Connection protocol</option>
          </select>
          <label
            htmlFor='catalog-request-site'
            className='font-mono text-[11px] text-muted-foreground'
          >
            official website (optional)
          </label>
          <Input
            id='catalog-request-site'
            type='url'
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder='https://'
            className='h-8 text-[12.5px]'
          />
          <label
            htmlFor='catalog-request-note'
            className='font-mono text-[11px] text-muted-foreground'
          >
            what you use it for (optional)
          </label>
          <Textarea
            id='catalog-request-note'
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            className='min-h-14 text-[12.5px]'
          />
          {request.error && (
            <p className='text-xs text-destructive'>
              {request.error.message}. Check the fields and send it again.
            </p>
          )}
          <div className='flex gap-2'>
            <Button
              type='button'
              size='sm'
              variant='ghost'
              onClick={() => setFormOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type='submit'
              size='sm'
              variant='outline'
              disabled={request.isPending}
            >
              {request.isPending ? 'Sending…' : 'Send request'}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
