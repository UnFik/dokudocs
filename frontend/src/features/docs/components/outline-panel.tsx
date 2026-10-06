import type { OutlineItem } from '../lib/outline'

/** The contents of the page: its headings, the one being read marked, each a way to jump there. */
export function OutlinePanel({
  items,
  activeID,
  onSelect,
}: {
  items: OutlineItem[]
  activeID: string | null
  onSelect: (nodeID: string) => void
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
    </nav>
  )
}
