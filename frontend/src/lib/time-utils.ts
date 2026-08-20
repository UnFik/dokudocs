export function formatRelativeTime(dateStr?: string | null): string {
  if (!dateStr) return 'Just now'

  const date = new Date(dateStr)
  const timestamp = date.getTime()

  if (isNaN(timestamp)) {
    return dateStr
  }

  const now = Date.now()
  const diffMs = Math.max(0, now - timestamp)
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 45) {
    return 'Just now'
  }

  if (diffMin < 60) {
    return `${diffMin}m ago`
  }

  if (diffHour < 24) {
    return `${diffHour}h ago`
  }

  if (diffDay === 1) {
    return 'Yesterday'
  }

  if (diffDay < 7) {
    return `${diffDay}d ago`
  }

  if (diffDay < 30) {
    const weeks = Math.floor(diffDay / 7)
    return `${weeks}w ago`
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
