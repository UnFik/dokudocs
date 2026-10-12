const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const MONTH = 30 * DAY

/** How long ago, in the shortest form: now, 5s, 3m, 2h, 4d, 2mo. */
export function shortAge(date: string, now: Date = new Date()): string {
  const then = new Date(date).getTime()
  if (Number.isNaN(then)) return ''
  const elapsed = Math.max(0, now.getTime() - then)
  if (elapsed < SECOND) return 'now'
  if (elapsed < MINUTE) return `${Math.floor(elapsed / SECOND)}s`
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`
  if (elapsed < MONTH) return `${Math.floor(elapsed / DAY)}d`
  return `${Math.floor(elapsed / MONTH)}mo`
}

type ExportedMessage = {
  role: 'user' | 'assistant'
  content: string
  citations?: { documentTitle: string }[]
}

/** A chat as a Markdown file: each question and answer in order, sources as titles. */
export function conversationMarkdown(
  title: string,
  messages: ExportedMessage[]
): string {
  const lines = [`# ${title.trim() || 'Chat'}`]
  for (const message of messages) {
    lines.push('', message.role === 'user' ? '## You' : '## DokuDocs AI', '')
    lines.push(message.content.trim())
    const sources = [
      ...new Set((message.citations ?? []).map((c) => c.documentTitle)),
    ]
    if (sources.length > 0) lines.push('', `Sources: ${sources.join(', ')}`)
  }
  return lines.join('\n') + '\n'
}

/** Token counts the way a usage meter reads them: 999, 1.5k, 300k, 1.2M. */
export function formatTokens(count: number): string {
  const short = (value: number) =>
    String(value >= 10 ? Math.round(value) : Math.round(value * 10) / 10)
  if (count >= 1_000_000) return `${short(count / 1_000_000)}M`
  if (count >= 1000) return `${short(count / 1000)}k`
  return String(count)
}

/** The day a monthly allowance starts over, such as "Nov 1" (the server counts months in UTC). */
export function resetLabel(resetsAt: string): string {
  const date = new Date(resetsAt)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

/** Whole percent of the allowance used, never above 100. */
export function usagePercent(usage: { used: number; limit: number }): number {
  return Math.min(100, Math.floor((usage.used / usage.limit) * 100))
}
