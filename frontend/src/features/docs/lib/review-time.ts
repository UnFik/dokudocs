const clock = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
})

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate()

/** "2:23 PM Today", "9:05 AM Yesterday", or the time and date for anything older. */
export function reviewTime(iso: string, now = new Date()) {
  const date = new Date(iso)
  const time = clock.format(date)
  if (sameDay(date, now)) return `${time} Today`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(date, yesterday)) return `${time} Yesterday`
  const day = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(date)
  return `${time} ${day}`
}
