import { ProjectItem } from '@/types/dokudocs'

export const mockProjects: ProjectItem[] = [
  {
    id: 'proj-1',
    name: 'E-Commerce Core',
    description: 'Core microservices, checkout, orders, and payment integrations',
    orgId: 'org-1',
    colorBadge: '#3b82f6',
    isStarred: true,
    categories: ['Checkout Flow', 'Order Engine', 'Database Schema', 'API Specs'],
    documentIds: ['doc-1', 'doc-2', 'doc-3', 'doc-4', 'doc-5'],
    createdAt: '2026-08-10T10:00:00.000Z',
    updatedAt: '2026-08-20T20:30:00.000Z',
  },
  {
    id: 'proj-2',
    name: 'Payment Gateway',
    description: 'Third-party payment providers, ledger, and reconciliation flow',
    orgId: 'org-1',
    colorBadge: '#10b981',
    categories: ['Integration', 'Ledger', 'Security'],
    documentIds: ['doc-6', 'doc-7', 'doc-8'],
    createdAt: '2026-08-12T14:30:00.000Z',
    updatedAt: '2026-08-19T14:30:00.000Z',
  },
  {
    id: 'proj-3',
    name: 'User Auth & SSO',
    description: 'Authentication architecture, RBAC permissions, and OAuth2 flow',
    orgId: 'org-1',
    colorBadge: '#8b5cf6',
    categories: ['OAuth2', 'RBAC', 'Session'],
    documentIds: ['doc-9', 'doc-10'],
    createdAt: '2026-08-15T09:15:00.000Z',
    updatedAt: '2026-08-17T09:15:00.000Z',
  },
]
