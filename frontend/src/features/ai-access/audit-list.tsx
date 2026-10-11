import type { AuditEntry } from './api/ai-access-api'

const OUTCOME: Record<AuditEntry['outcome'], { word: string; tone: string }> = {
  ok: { word: 'done', tone: 'bg-ok' },
  refused: { word: 'refused', tone: 'bg-warn' },
  limited: { word: 'rate limited', tone: 'bg-warn' },
  error: { word: 'failed', tone: 'bg-destructive' },
}

/** MCP calls, newest first. Only who, which tool, on what and how it ended: never content. */
export function AuditList({
  entries,
  showUser = false,
}: {
  entries: AuditEntry[]
  showUser?: boolean
}) {
  if (entries.length === 0)
    return <p className='text-sm text-muted-foreground'>No MCP calls yet.</p>
  return (
    <div className='overflow-x-auto'>
      <table className='w-full text-left text-sm'>
        <thead className='text-xs text-muted-foreground'>
          <tr className='border-b'>
            <th className='py-2 pr-3 font-normal'>When</th>
            {showUser ? <th className='py-2 pr-3 font-normal'>User</th> : null}
            <th className='py-2 pr-3 font-normal'>Key</th>
            <th className='py-2 pr-3 font-normal'>Tool</th>
            <th className='py-2 pr-3 font-normal'>On</th>
            <th className='py-2 font-normal'>Result</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => (
            <tr key={index} className='border-b align-top'>
              <td className='py-2 pr-3 font-mono text-xs whitespace-nowrap text-muted-foreground'>
                {new Date(entry.at).toLocaleString()}
              </td>
              {showUser ? (
                <td className='py-2 pr-3'>{entry.userName || 'Former user'}</td>
              ) : null}
              <td className='py-2 pr-3'>{entry.keyName || 'Revoked key'}</td>
              <td className='py-2 pr-3 font-mono text-xs'>{entry.tool}</td>
              <td className='py-2 pr-3 font-mono text-xs break-all text-muted-foreground'>
                {entry.resource}
              </td>
              <td className='py-2'>
                <span className='flex items-center gap-2'>
                  <span
                    aria-hidden
                    className={`size-1.5 shrink-0 rounded-[1px] ${OUTCOME[entry.outcome].tone}`}
                  />
                  {OUTCOME[entry.outcome].word}
                </span>
                {entry.detail ? (
                  <span className='block text-xs text-muted-foreground'>
                    {entry.detail}
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
