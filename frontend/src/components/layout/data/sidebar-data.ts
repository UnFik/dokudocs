import {
  BookOpen,
  Clock,
  Code2,
  FileText,
  Folder,
  Layers,
  Settings,
  Trash2,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'Fikri',
    email: 'fikri@dokudocs.app',
    avatar: '/avatars/01.png',
  },
  teams: [
    {
      name: 'Dokudocs Workspace',
      logo: BookOpen,
      plan: 'Pro Workspace',
    },
    {
      name: 'Personal Workspace',
      logo: Layers,
      plan: 'Free',
    },
    {
      name: 'Engineering Team',
      logo: Code2,
      plan: 'Enterprise',
    },
  ],
  navGroups: [
    {
      title: '',
      items: [
        {
          title: 'Recent',
          url: '/',
          icon: Clock,
        },
        {
          title: 'Drafts',
          url: '/drafts',
          icon: FileText,
        },
        {
          title: 'Trash',
          url: '/trash',
          icon: Trash2,
        },
      ],
    },
    {
      title: '',
      items: [
        {
          title: 'All Projects',
          url: '/projects',
          icon: Folder,
        },
        {
          title: 'Workspace Settings',
          url: '/settings',
          icon: Settings,
        },
      ],
    },
  ],
}
