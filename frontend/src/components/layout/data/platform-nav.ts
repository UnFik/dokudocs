import {
  BarChart3,
  BookOpenCheck,
  GitBranch,
  Server,
  Unplug,
} from 'lucide-react'
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
    items: [
      { title: 'AI provider', url: '/platform/ai', icon: Server },
      { title: 'MCP', url: '/platform/mcp', icon: Unplug },
      { title: 'Skills', url: '/platform/skills', icon: BookOpenCheck },
      { title: 'Model usage', url: '/platform/usage', icon: BarChart3 },
      {
        title: 'Conversations',
        url: '/platform/conversations',
        icon: GitBranch,
      },
    ],
  }
}
