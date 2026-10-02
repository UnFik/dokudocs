-- Dokudocs Workspace Database Seed & Backup
-- Generated: 2026-09-10T02:12:10.176Z
-- Compatible with Dokudocs PostgreSQL schema

BEGIN;

-- Workspaces
INSERT INTO workspaces (id, name, slug, plan, created_by)
VALUES 
  ('00000000-0000-0000-0000-000000000010', 'Dokudocs Workspace', 'dokudocs-workspace', 'Pro Workspace', '00000000-0000-0000-0000-000000000001')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  plan = EXCLUDED.plan,
  updated_at = NOW();

-- Projects
INSERT INTO projects (id, workspace_id, name, description, color_badge, visibility, created_by)
VALUES (
  '00000000-0000-0000-0000-000000000020',
  '00000000-0000-0000-0000-000000000010',
  'E-Commerce Core',
  'Core microservices, checkout, orders, and payment integrations',
  '#3b82f6',
  'workspace',
  '00000000-0000-0000-0000-000000000001'
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  color_badge = EXCLUDED.color_badge,
  updated_at = NOW();

INSERT INTO projects (id, workspace_id, name, description, color_badge, visibility, created_by)
VALUES (
  '00000000-0000-0000-0000-000000000021',
  '00000000-0000-0000-0000-000000000010',
  'Payment Gateway',
  'Third-party payment providers, ledger, and reconciliation flow',
  '#10b981',
  'workspace',
  '00000000-0000-0000-0000-000000000001'
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  color_badge = EXCLUDED.color_badge,
  updated_at = NOW();

INSERT INTO projects (id, workspace_id, name, description, color_badge, visibility, created_by)
VALUES (
  '00000000-0000-0000-0000-000000000022',
  '00000000-0000-0000-0000-000000000010',
  'User Auth & SSO',
  'Authentication architecture, RBAC permissions, and OAuth2 flow',
  '#8b5cf6',
  'workspace',
  '00000000-0000-0000-0000-000000000001'
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  color_badge = EXCLUDED.color_badge,
  updated_at = NOW();

-- Project Categories
INSERT INTO project_categories (project_id, name, color_id, sort_order)
VALUES (
  '00000000-0000-0000-0000-000000000020',
  'Checkout Flow',
  'blue',
  1
)
ON CONFLICT (project_id, name) DO UPDATE SET
  sort_order = EXCLUDED.sort_order;
INSERT INTO project_categories (project_id, name, color_id, sort_order)
VALUES (
  '00000000-0000-0000-0000-000000000020',
  'Order Engine',
  'blue',
  2
)
ON CONFLICT (project_id, name) DO UPDATE SET
  sort_order = EXCLUDED.sort_order;
INSERT INTO project_categories (project_id, name, color_id, sort_order)
VALUES (
  '00000000-0000-0000-0000-000000000020',
  'Database Schema',
  'blue',
  3
)
ON CONFLICT (project_id, name) DO UPDATE SET
  sort_order = EXCLUDED.sort_order;
INSERT INTO project_categories (project_id, name, color_id, sort_order)
VALUES (
  '00000000-0000-0000-0000-000000000020',
  'API Specs',
  'blue',
  4
)
ON CONFLICT (project_id, name) DO UPDATE SET
  sort_order = EXCLUDED.sort_order;
INSERT INTO project_categories (project_id, name, color_id, sort_order)
VALUES (
  '00000000-0000-0000-0000-000000000021',
  'Integration',
  'blue',
  1
)
ON CONFLICT (project_id, name) DO UPDATE SET
  sort_order = EXCLUDED.sort_order;
INSERT INTO project_categories (project_id, name, color_id, sort_order)
VALUES (
  '00000000-0000-0000-0000-000000000021',
  'Ledger',
  'blue',
  2
)
ON CONFLICT (project_id, name) DO UPDATE SET
  sort_order = EXCLUDED.sort_order;
INSERT INTO project_categories (project_id, name, color_id, sort_order)
VALUES (
  '00000000-0000-0000-0000-000000000021',
  'Security',
  'blue',
  3
)
ON CONFLICT (project_id, name) DO UPDATE SET
  sort_order = EXCLUDED.sort_order;
INSERT INTO project_categories (project_id, name, color_id, sort_order)
VALUES (
  '00000000-0000-0000-0000-000000000022',
  'OAuth2',
  'blue',
  1
)
ON CONFLICT (project_id, name) DO UPDATE SET
  sort_order = EXCLUDED.sort_order;
INSERT INTO project_categories (project_id, name, color_id, sort_order)
VALUES (
  '00000000-0000-0000-0000-000000000022',
  'RBAC',
  'blue',
  2
)
ON CONFLICT (project_id, name) DO UPDATE SET
  sort_order = EXCLUDED.sort_order;
INSERT INTO project_categories (project_id, name, color_id, sort_order)
VALUES (
  '00000000-0000-0000-0000-000000000022',
  'Session',
  'blue',
  3
)
ON CONFLICT (project_id, name) DO UPDATE SET
  sort_order = EXCLUDED.sort_order;

-- Documents
INSERT INTO documents (id, workspace_id, project_id, title, type, content, author_id, tags, is_draft, visibility)
VALUES (
  '00000000-0000-0000-0000-000000000031',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000020',
  'Order Processing FSD',
  'markdown',
  '# Functional Specification: Order Processing Service

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
- Webhook retry with exponential backoff up to 5 attempts.',
  '00000000-0000-0000-0000-000000000001',
  '{"Checkout", "Core API", "FSD"}',
  false,
  'workspace'
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  type = EXCLUDED.type,
  tags = EXCLUDED.tags,
  is_draft = EXCLUDED.is_draft,
  updated_at = NOW();

INSERT INTO documents (id, workspace_id, project_id, title, type, content, author_id, tags, is_draft, visibility)
VALUES (
  '00000000-0000-0000-0000-000000000032',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000020',
  'E-Commerce Database Schema',
  'dbdiagram',
  'Table users {
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
}',
  '00000000-0000-0000-0000-000000000001',
  '{"Database", "Postgres", "DBML"}',
  false,
  'workspace'
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  type = EXCLUDED.type,
  tags = EXCLUDED.tags,
  is_draft = EXCLUDED.is_draft,
  updated_at = NOW();

INSERT INTO documents (id, workspace_id, project_id, title, type, content, author_id, tags, is_draft, visibility)
VALUES (
  '00000000-0000-0000-0000-000000000033',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000020',
  'Checkout & Payment Flow',
  'mermaid',
  'graph TD
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
  NotifyFulfillment --> Finish([Order Complete])',
  '00000000-0000-0000-0000-000000000001',
  '{"Flowchart", "Mermaid", "Checkout"}',
  false,
  'workspace'
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  type = EXCLUDED.type,
  tags = EXCLUDED.tags,
  is_draft = EXCLUDED.is_draft,
  updated_at = NOW();

INSERT INTO documents (id, workspace_id, project_id, title, type, content, author_id, tags, is_draft, visibility)
VALUES (
  '00000000-0000-0000-0000-000000000034',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000021',
  'Payment Gateway Integration FSD',
  'markdown',
  '# Payment Gateway Integration Specification

## 1. Scope
Integration with Stripe, Xendit, and Midtrans unified router.

## 2. Security Requirements
- PCI-DSS Compliance Level 1.
- Zero raw card storage on internal servers.',
  '00000000-0000-0000-0000-000000000001',
  '{}',
  false,
  'workspace'
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  type = EXCLUDED.type,
  tags = EXCLUDED.tags,
  is_draft = EXCLUDED.is_draft,
  updated_at = NOW();

INSERT INTO documents (id, workspace_id, project_id, title, type, content, author_id, tags, is_draft, visibility)
VALUES (
  '00000000-0000-0000-0000-000000000035',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000021',
  'Payment Transactions ERD',
  'dbdiagram',
  'Table payment_transactions {
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
}',
  '00000000-0000-0000-0000-000000000001',
  '{}',
  false,
  'workspace'
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  type = EXCLUDED.type,
  tags = EXCLUDED.tags,
  is_draft = EXCLUDED.is_draft,
  updated_at = NOW();

INSERT INTO documents (id, workspace_id, project_id, title, type, content, author_id, tags, is_draft, visibility)
VALUES (
  '00000000-0000-0000-0000-000000000036',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000021',
  'Refund Lifecycle Sequence',
  'mermaid',
  'sequenceDiagram
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
  API-->>Admin: 200 OK (Refund Completed)',
  '00000000-0000-0000-0000-000000000001',
  '{}',
  false,
  'workspace'
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  type = EXCLUDED.type,
  tags = EXCLUDED.tags,
  is_draft = EXCLUDED.is_draft,
  updated_at = NOW();

INSERT INTO documents (id, workspace_id, project_id, title, type, content, author_id, tags, is_draft, visibility)
VALUES (
  '00000000-0000-0000-0000-000000000037',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000022',
  'OAuth2 & OIDC Authentication Spec',
  'markdown',
  '# OAuth2 & OIDC Authentication Specification

## 1. Identity Providers
- Google Workspace OAuth2
- GitHub Enterprise SSO
- Microsoft Entra ID (SAML 2.0)',
  '00000000-0000-0000-0000-000000000001',
  '{}',
  false,
  'workspace'
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  type = EXCLUDED.type,
  tags = EXCLUDED.tags,
  is_draft = EXCLUDED.is_draft,
  updated_at = NOW();

INSERT INTO documents (id, workspace_id, project_id, title, type, content, author_id, tags, is_draft, visibility)
VALUES (
  '00000000-0000-0000-0000-000000000038',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000022',
  'User Identity & Sessions Schema',
  'dbdiagram',
  'Table accounts {
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
}',
  '00000000-0000-0000-0000-000000000001',
  '{}',
  false,
  'workspace'
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  type = EXCLUDED.type,
  tags = EXCLUDED.tags,
  is_draft = EXCLUDED.is_draft,
  updated_at = NOW();

INSERT INTO documents (id, workspace_id, project_id, title, type, content, author_id, tags, is_draft, visibility)
VALUES (
  '00000000-0000-0000-0000-000000000039',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000022',
  'MFA SMS & Authenticator Flow',
  'mermaid',
  'graph TD
  Start([User Enters Password]) --> CheckMfa{MFA Enabled?}
  CheckMfa -- No --> IssueToken[Issue Session JWT]
  CheckMfa -- Yes --> PromptOTP[Prompt TOTP Authenticator]
  PromptOTP --> ValidateOTP{Valid Code?}
  ValidateOTP -- Yes --> IssueToken
  ValidateOTP -- No --> LockoutCheck{Failed Attempts >= 5?}
  LockoutCheck -- Yes --> LockAccount[Temporary 15m Lockout]
  LockoutCheck -- No --> PromptOTP
  IssueToken --> Complete([Dashboard Access])',
  '00000000-0000-0000-0000-000000000001',
  '{}',
  false,
  'workspace'
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  type = EXCLUDED.type,
  tags = EXCLUDED.tags,
  is_draft = EXCLUDED.is_draft,
  updated_at = NOW();

INSERT INTO documents (id, workspace_id, project_id, title, type, content, author_id, tags, is_draft, visibility)
VALUES (
  '00000000-0000-0000-0000-000000000040',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000022',
  'RBAC Permission Matrix FSD',
  'markdown',
  '# Role-Based Access Control Specification

## Roles
- **SuperAdmin**: Global access across all organizations.
- **OrgAdmin**: Workspace management and billing control.
- **Editor**: Create and edit documents in assigned projects.
- **Viewer**: Read-only access to published documents.',
  '00000000-0000-0000-0000-000000000001',
  '{}',
  false,
  'workspace'
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  type = EXCLUDED.type,
  tags = EXCLUDED.tags,
  is_draft = EXCLUDED.is_draft,
  updated_at = NOW();

INSERT INTO documents (id, workspace_id, project_id, title, type, content, author_id, tags, is_draft, visibility)
VALUES (
  '00000000-0000-0000-0000-000000000041',
  '00000000-0000-0000-0000-000000000010',
  NULL,
  'Q3 Microservice Migration Notes',
  'markdown',
  '# Q3 Architecture Scratchpad

- Monolith decoupling plan
- Event-driven Kafka topics
- Redis distributed lock evaluation',
  '00000000-0000-0000-0000-000000000001',
  '{}',
  true,
  'workspace'
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  type = EXCLUDED.type,
  tags = EXCLUDED.tags,
  is_draft = EXCLUDED.is_draft,
  updated_at = NOW();

INSERT INTO documents (id, workspace_id, project_id, title, type, content, author_id, tags, is_draft, visibility)
VALUES (
  '00000000-0000-0000-0000-000000000042',
  '00000000-0000-0000-0000-000000000010',
  NULL,
  'Exploratory GraphQL Gateway Schema',
  'dbdiagram',
  'Table graphql_resolvers {
  id int [pk]
  name varchar(100)
  target_service varchar(100)
}',
  '00000000-0000-0000-0000-000000000001',
  '{}',
  true,
  'workspace'
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  type = EXCLUDED.type,
  tags = EXCLUDED.tags,
  is_draft = EXCLUDED.is_draft,
  updated_at = NOW();

COMMIT;
