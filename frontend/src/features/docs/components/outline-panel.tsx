import type { OutlineItem } from '../lib/outline'

/** The contents of the page: its headings, the one being read marked, each a way to jump there. */
export function OutlinePanel({
  items,
  activeID,
  onSelect,
  backlinks = [],
}: {
  items: OutlineItem[]
  activeID: string | null
  onSelect: (nodeID: string) => void
  backlinks?: { id: string; title: string }[]
}) {
  return (
    <nav
      aria-label='Contents'
      className='max-h-[40vh] w-full shrink-0 overflow-auto border-b bg-card p-4 text-sm md:max-h-none md:w-60 md:border-r md:border-b-0'
    >
      {items.length === 0 ? (
        <p className='text-xs text-muted-foreground'>
          Headings you add will show up here.
        </p>
      ) : (
        <ul className='space-y-1'>
          {items.map((item) => (
            <li
              key={item.nodeID}
              style={{ paddingLeft: `${(item.level - 1) * 12}px` }}
            >
              <a
                href={`#node-${item.nodeID}`}
                aria-current={item.nodeID === activeID ? 'location' : undefined}
                className={`block truncate rounded px-2 py-1 hover:bg-secondary ${item.nodeID === activeID ? 'bg-secondary font-medium text-foreground' : 'text-muted-foreground'}`}
                onClick={(event) => {
                  event.preventDefault()
                  onSelect(item.nodeID)
                }}
              >
                {item.text}
              </a>
            </li>
          ))}
        </ul>
      )}
      {backlinks.length > 0 ? (
        <section className='mt-4 border-t pt-3'>
          <h2 className='mb-1 px-2 text-xs font-medium text-muted-foreground'>
            Referenced by
          </h2>
          <ul className='space-y-1'>
            {backlinks.map((link) => (
              <li key={link.id}>
                <a
                  href={`/docs/${link.id}`}
                  className='block truncate rounded px-2 py-1 text-muted-foreground hover:bg-secondary'
                >
                  {link.title || 'Untitled'}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </nav>
  )
}
