import { Server } from 'lucide-react'
import { type NavGroup } from '../types'

/**
 * The Platform group, for a Superadmin only. The sign-in token's roles only decide whether the
 * link is shown; the server checks the role again on every request.
 */
export function platformNavGroup(
  roles: readonly string[] | undefined
): NavGroup | null {
  if (!roles?.includes('superadmin')) return null
  return {
    title: 'Platform',
    items: [{ title: 'AI provider', url: '/platform/ai', icon: Server }],
  }
}
