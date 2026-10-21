import { connectionsOf } from '../lib/canvas-links'
import type { ArchitectureJSON } from '../lib/canvas-model'
import type { Selection } from './architecture-canvas'

/**
 * The Connections of one System, as a list: who talks to it, whom it talks to,
 * and over what. A row selects the System at the other end, so the list can be
 * walked along the canvas.
 */
export function SystemConnections({
  canvas,
  systemID,
  onSelect,
}: {
  canvas: ArchitectureJSON
  systemID: string
  onSelect: (selection: Selection) => void
}) {
  const connections = connectionsOf(canvas, systemID)
  return (
    <section
      className='flex flex-col gap-1.5'
      aria-labelledby='architecture-connections-heading'
    >
      <h3
        id='architecture-connections-heading'
        className='font-mono text-[11px] text-muted-foreground'
      >
        connections · <span className='tabular-nums'>{connections.length}</span>
      </h3>
      {!connections.length ? (
        <p className='text-xs text-muted-foreground'>
          No connections yet. Drag from the handle on the right edge of this
          System to another System.
        </p>
      ) : (
        <ul className='flex flex-col'>
          {connections.map(({ connection, direction, other }) => {
            const via = `${connection.protocol}${connection.label ? ` · ${connection.label}` : ''}`
            const name = other?.name || 'Untitled'
            return (
              <li
                key={connection.id}
                className='border-t border-border last:border-b'
              >
                <button
                  type='button'
                  disabled={!other}
                  onClick={() =>
                    other && onSelect([{ kind: 'node', id: other.id }])
                  }
                  aria-label={`${direction === 'in' ? 'From' : 'To'} ${name}, over ${via}`}
                  className='flex min-h-8 w-full items-baseline gap-2 py-1.5 text-left text-[12.5px] hover:bg-accent focus-visible:outline-2 focus-visible:outline-signal disabled:cursor-default disabled:hover:bg-transparent'
                >
                  <span
                    aria-hidden
                    className='w-4 shrink-0 text-center font-mono text-[11px] text-signal'
                  >
                    {direction === 'in' ? '←' : '→'}
                  </span>
                  <span className='min-w-0'>
                    <span className='font-medium'>{name}</span>{' '}
                    <span className='font-mono text-[11px] break-words text-muted-foreground'>
                      {via}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
