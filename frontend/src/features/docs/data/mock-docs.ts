import { DocumentItem } from '@/types/dokudocs'

export const mockDocuments: DocumentItem[] = [
  {
    id: 'doc-1',
    title: 'Order Processing FSD',
    type: 'markdown',
    content: `# Functional Specification: Order Processing Service

## 1. Overview
The Order Processing Service manages cart validation, inventory reservation, payment authorization, and fulfillment dispatch.

## 2. Order States
- **PENDING**: Order placed, waiting for payment confirmation.
- **PAID**: Payment verified by gateway.
- **PROCESSING**: Warehouse allocation underway.
- **SHIPPED**: Courier tracking active.
- **COMPLETED**: Received by customer.

## 3. SLA & Requirements
- Max latency for checkout API: 250ms (p99).
- Webhook retry with exponential backoff up to 5 attempts.`,
    projectId: 'proj-1',
    projectName: 'E-Commerce Core',
    category: 'Checkout Flow',
    categories: ['Checkout Flow', 'Core Architecture'],
    orgId: 'org-1',
    author: {
      id: 'usr-1',
      name: 'Fikri',
      email: 'fikri@dokudocs.app',
      avatar: '/avatars/01.png',
    },
    isStarred: true,
    isShared: true,
    isDraft: false,
    createdAt: '2026-08-16T11:00:00.000Z',
    updatedAt: '2026-08-20T20:30:00.000Z',
    lastViewedAt: '2026-08-20T22:25:00.000Z',
    tags: ['Checkout', 'Core API', 'FSD'],
  },
  {
    id: 'doc-2',
    title: 'E-Commerce Database Schema',
    type: 'dbdiagram',
    content: `Table users {
  id int [pk, increment]
  email varchar(255) [unique, not null]
  full_name varchar(150)
  created_at timestamp
}

Table orders {
  id int [pk, increment]
  user_id int [ref: > users.id]
  total_amount decimal(12,2)
  status varchar(50)
  created_at timestamp
}

Table order_items {
  id int [pk, increment]
  order_id int [ref: > orders.id]
  product_id int
  quantity int
  unit_price decimal(10,2)
}

Table products {
  id int [pk, increment]
  sku varchar(100) [unique]
  title varchar(200)
  stock_count int
}`,
    projectId: 'proj-1',
    projectName: 'E-Commerce Core',
    category: 'Database Schema',
    categories: ['Database Schema', 'PostgreSQL'],
    orgId: 'org-1',
    author: {
      id: 'usr-1',
      name: 'Fikri',
      email: 'fikri@dokudocs.app',
      avatar: '/avatars/01.png',
    },
    isStarred: false,
    isShared: true,
    isDraft: false,
    createdAt: '2026-08-15T14:30:00.000Z',
    updatedAt: '2026-08-19T14:30:00.000Z',
    lastViewedAt: '2026-08-20T21:40:00.000Z',
    tags: ['Database', 'Postgres', 'DBML'],
  },
  {
    id: 'doc-3',
    title: 'Checkout & Payment Flow',
    type: 'mermaid',
    content: `graph TD
  Customer([Customer]) --> AddCart[Add Item to Cart]
  AddCart --> Review[Review Cart]
  Review --> Checkout[Click Checkout]
  CheckStock -- No --> OutOfStock[Show Stock Error]
  CheckStock -- Yes --> ReserveStock[Reserve Inventory 15m]
  ReserveStock --> SelectPayment[Select Payment Method]
  SelectPayment --> Stripe{Process Stripe?}
  Stripe -- Success --> MarkPaid[Mark Order as Paid]
  Stripe -- Failed --> ReleaseStock[Release Reserved Stock]
  MarkPaid --> NotifyFulfillment[Dispatch Fulfillment Webhook]
  NotifyFulfillment --> Finish([Order Complete])`,
    projectId: 'proj-1',
    projectName: 'E-Commerce Core',
    category: 'Checkout Flow',
    categories: ['Checkout Flow', 'Payment Flow'],
    orgId: 'org-1',
    author: {
      id: 'usr-2',
      name: 'Sarah Chen',
      email: 'sarah@dokudocs.app',
      avatar: '/avatars/02.png',
    },
    isStarred: true,
    isShared: true,
    isDraft: false,
    createdAt: '2026-08-14T09:15:00.000Z',
    updatedAt: '2026-08-17T09:15:00.000Z',
    lastViewedAt: '2026-08-20T19:15:00.000Z',
    tags: ['Flowchart', 'Mermaid', 'Checkout'],
  },
  {
    id: 'doc-4',
    title: 'Payment Gateway Integration FSD',
    type: 'markdown',
    content: `# Payment Gateway Integration Specification

## 1. Scope
Integration with Stripe, Xendit, and Midtrans unified router.

## 2. Security Requirements
- PCI-DSS Compliance Level 1.
- Zero raw card storage on internal servers.`,
    projectId: 'proj-2',
    projectName: 'Payment Gateway',
    category: 'Core Service',
    categories: ['Core Service', 'Integration'],
    orgId: 'org-1',
    author: {
      id: 'usr-1',
      name: 'Fikri',
      email: 'fikri@dokudocs.app',
      avatar: '/avatars/01.png',
    },
    isStarred: false,
    isShared: false,
    isDraft: false,
    createdAt: '2026-08-16T15:00:00.000Z',
    updatedAt: '2026-08-20T18:00:00.000Z',
    lastViewedAt: '2026-08-20T21:10:00.000Z',
  },
  {
    id: 'doc-5',
    title: 'Payment Transactions ERD',
    type: 'dbdiagram',
    content: `Table payment_transactions {
  id varchar(36) [pk]
  order_id varchar(36)
  gateway_name varchar(50)
  amount decimal(12,2)
  currency varchar(3)
  status varchar(30)
  idempotency_key varchar(64) [unique]
  created_at timestamp
}

Table payment_refunds {
  id varchar(36) [pk]
  transaction_id varchar(36) [ref: > payment_transactions.id]
  refund_amount decimal(12,2)
  reason text
  created_at timestamp
}`,
    projectId: 'proj-2',
    projectName: 'Payment Gateway',
    category: 'Database Schema',
    categories: ['Database Schema', 'Finance'],
    orgId: 'org-1',
    author: {
      id: 'usr-3',
      name: 'Alex Rivera',
      email: 'alex@dokudocs.app',
      avatar: '/avatars/03.png',
    },
    isStarred: true,
    isShared: true,
    isDraft: false,
    createdAt: '2026-08-13T10:00:00.000Z',
    updatedAt: '2026-08-18T10:00:00.000Z',
    lastViewedAt: '2026-08-20T16:00:00.000Z',
  },
  {
    id: 'doc-6',
    title: 'Refund Lifecycle Sequence',
    type: 'mermaid',
    content: `sequenceDiagram
  autonumber
  actor Admin as Operations Admin
  participant API as Payment API
  participant Gate as Stripe Gateway
  participant DB as Database

  Admin->>API: POST /refunds (orderId, amount)
  API->>DB: Verify original transaction status
  DB-->>API: Status = PAID
  API->>Gate: Create refund charge
  Gate-->>API: Refund processed (ref_id)
  API->>DB: Store refund transaction
  API-->>Admin: 200 OK (Refund Completed)`,
    projectId: 'proj-2',
    projectName: 'Payment Gateway',
    category: 'Refund Flow',
    categories: ['Refund Flow', 'Finance'],
    orgId: 'org-1',
    author: {
      id: 'usr-2',
      name: 'Sarah Chen',
      email: 'sarah@dokudocs.app',
      avatar: '/avatars/02.png',
    },
    isStarred: false,
    isShared: true,
    isDraft: false,
    createdAt: '2026-08-12T16:20:00.000Z',
    updatedAt: '2026-08-15T16:20:00.000Z',
    lastViewedAt: '2026-08-19T11:00:00.000Z',
  },
  {
    id: 'doc-7',
    title: 'OAuth2 & OIDC Authentication Spec',
    type: 'markdown',
    content: `# OAuth2 & OIDC Authentication Specification

## 1. Identity Providers
- Google Workspace OAuth2
- GitHub Enterprise SSO
- Microsoft Entra ID (SAML 2.0)`,
    projectId: 'proj-3',
    projectName: 'User Auth & SSO',
    category: 'SSO Spec',
    categories: ['SSO Spec', 'Security'],
    orgId: 'org-1',
    author: {
      id: 'usr-1',
      name: 'Fikri',
      email: 'fikri@dokudocs.app',
      avatar: '/avatars/01.png',
    },
    isStarred: true,
    isShared: true,
    isDraft: false,
    createdAt: '2026-08-16T08:00:00.000Z',
    updatedAt: '2026-08-20T16:00:00.000Z',
    lastViewedAt: '2026-08-20T22:15:00.000Z',
  },
  {
    id: 'doc-8',
    title: 'User Identity & Sessions Schema',
    type: 'dbdiagram',
    content: `Table accounts {
  id varchar(36) [pk]
  email varchar(255) [unique, not null]
  password_hash varchar(255)
  is_verified boolean
  created_at timestamp
}

Table sessions {
  id varchar(64) [pk]
  account_id varchar(36) [ref: > accounts.id]
  ip_address varchar(45)
  user_agent text
  expires_at timestamp
  created_at timestamp
}`,
    projectId: 'proj-3',
    projectName: 'User Auth & SSO',
    category: 'Database Schema',
    categories: ['Database Schema', 'Auth'],
    orgId: 'org-1',
    author: {
      id: 'usr-1',
      name: 'Fikri',
      email: 'fikri@dokudocs.app',
      avatar: '/avatars/01.png',
    },
    isStarred: false,
    isShared: false,
    isDraft: false,
    createdAt: '2026-08-14T11:30:00.000Z',
    updatedAt: '2026-08-19T11:30:00.000Z',
    lastViewedAt: '2026-08-20T20:00:00.000Z',
  },
  {
    id: 'doc-9',
    title: 'MFA SMS & Authenticator Flow',
    type: 'mermaid',
    content: `graph TD
  Start([User Enters Password]) --> CheckMfa{MFA Enabled?}
  CheckMfa -- No --> IssueToken[Issue Session JWT]
  CheckMfa -- Yes --> PromptOTP[Prompt TOTP Authenticator]
  PromptOTP --> ValidateOTP{Valid Code?}
  ValidateOTP -- Yes --> IssueToken
  ValidateOTP -- No --> LockoutCheck{Failed Attempts >= 5?}
  LockoutCheck -- Yes --> LockAccount[Temporary 15m Lockout]
  LockoutCheck -- No --> PromptOTP
  IssueToken --> Complete([Dashboard Access])`,
    projectId: 'proj-3',
    projectName: 'User Auth & SSO',
    category: 'MFA Flow',
    categories: ['MFA Flow', 'Security'],
    orgId: 'org-1',
    author: {
      id: 'usr-2',
      name: 'Sarah Chen',
      email: 'sarah@dokudocs.app',
      avatar: '/avatars/02.png',
    },
    isStarred: false,
    isShared: true,
    isDraft: false,
    createdAt: '2026-08-15T09:00:00.000Z',
    updatedAt: '2026-08-17T09:00:00.000Z',
    lastViewedAt: '2026-08-20T18:30:00.000Z',
  },
  {
    id: 'doc-10',
    title: 'RBAC Permission Matrix FSD',
    type: 'markdown',
    content: `# Role-Based Access Control Specification

## Roles
- **SuperAdmin**: Global access across all organizations.
- **OrgAdmin**: Workspace management and billing control.
- **Editor**: Create and edit documents in assigned projects.
- **Viewer**: Read-only access to published documents.`,
    projectId: 'proj-3',
    projectName: 'User Auth & SSO',
    category: 'RBAC',
    categories: ['RBAC', 'Governance'],
    orgId: 'org-1',
    author: {
      id: 'usr-3',
      name: 'Alex Rivera',
      email: 'alex@dokudocs.app',
      avatar: '/avatars/03.png',
    },
    isStarred: false,
    isShared: true,
    isDraft: false,
    createdAt: '2026-08-14T16:00:00.000Z',
    updatedAt: '2026-08-15T16:00:00.000Z',
    lastViewedAt: '2026-08-18T14:00:00.000Z',
  },
  {
    id: 'doc-draft-1',
    title: 'Q3 Microservice Migration Notes',
    type: 'markdown',
    content: `# Q3 Architecture Scratchpad\n\n- Monolith decoupling plan\n- Event-driven Kafka topics\n- Redis distributed lock evaluation`,
    projectId: null,
    projectName: null,
    category: null,
    categories: [],
    orgId: 'org-1',
    author: {
      id: 'usr-1',
      name: 'Fikri',
      email: 'fikri@dokudocs.app',
      avatar: '/avatars/01.png',
    },
    isStarred: false,
    isShared: false,
    isDraft: true,
    createdAt: '2026-08-17T10:00:00.000Z',
    updatedAt: '2026-08-20T21:00:00.000Z',
    lastViewedAt: '2026-08-20T22:28:00.000Z',
  },
  {
    id: 'doc-draft-2',
    title: 'Exploratory GraphQL Gateway Schema',
    type: 'dbdiagram',
    content: `Table graphql_resolvers {\n  id int [pk]\n  name varchar(100)\n  target_service varchar(100)\n}`,
    projectId: null,
    projectName: null,
    category: null,
    categories: [],
    orgId: 'org-1',
    author: {
      id: 'usr-1',
      name: 'Fikri',
      email: 'fikri@dokudocs.app',
      avatar: '/avatars/01.png',
    },
    isStarred: false,
    isShared: false,
    isDraft: true,
    createdAt: '2026-08-17T12:00:00.000Z',
    updatedAt: '2026-08-20T19:00:00.000Z',
    lastViewedAt: '2026-08-20T20:15:00.000Z',
  },
]
