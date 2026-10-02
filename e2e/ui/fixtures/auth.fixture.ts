import { type Page } from '@playwright/test'

export const MOCK_USER = {
  id: '00000000-0000-0000-0000-000000000002',
  accountNo: 'ACC-001',
  email: 'fikri@dokudocs.app',
  role: ['superadmin'],
  exp: 1893456000,
}

export const MOCK_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDIiLCJleHAiOjE4OTM0NTYwMDB9.mock-signature'

const MOCK_WORKSPACE_ID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const mockDocument = (
  id: string,
  title: string,
  type: 'markdown' | 'dbdiagram' | 'mermaid',
  content: string
) => ({
  id,
  workspaceId: MOCK_WORKSPACE_ID,
  projectId: 'proj-1',
  projectName: 'Core Platform',
  title,
  type,
  content,
  authorId: MOCK_USER.id,
  author: {
    id: MOCK_USER.id,
    name: 'Fikri',
    email: MOCK_USER.email,
    avatar: '/avatars/01.png',
  },
  tags: [],
  isDraft: false,
  visibility: 'workspace',
  isStarred: false,
  isShared: false,
  categories: [],
  createdAt: '2026-09-28T00:00:00.000Z',
  updatedAt: '2026-09-28T00:00:00.000Z',
})

const MOCK_DOCUMENTS = [
  mockDocument(
    'doc-1',
    'Order Processing FSD',
    'markdown',
    '# Functional Specification: Order Processing Service\n\n## 1. Overview\nOrder processing.'
  ),
  mockDocument(
    'doc-2',
    'E-Commerce Database Schema',
    'dbdiagram',
    'Table users {\n  id int [pk]\n  email varchar\n}'
  ),
  mockDocument(
    'doc-3',
    'Checkout & Payment Flow',
    'mermaid',
    'flowchart TD\n  A --> B'
  ),
]

export async function setupAuthMockRoutes(page: Page) {
  await page.route('**/api/v1/auth/login', async (route) => {
    const postData = route.request().postDataJSON()
    if (postData?.email === 'fikri@dokudocs.app' && postData?.password === 'password123') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            accessToken: MOCK_TOKEN,
            user: MOCK_USER,
          },
        }),
      })
    } else {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          title: 'Invalid email or password',
          message: 'Invalid email or password',
        }),
      })
    }
  })

  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: MOCK_USER,
      }),
    })
  })

  await page.route('**/api/v1/users/me/profile', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          id: MOCK_USER.id,
          accountNo: MOCK_USER.accountNo,
          email: MOCK_USER.email,
          fullName: 'Fikri',
          phoneNumber: '',
          bio: '',
          avatarUrl: '/avatars/01.png',
        },
      }),
    })
  })

  await page.route('**/api/v1/workspaces', async (route) => {
    if (route.request().method() === 'POST') {
      const input = route.request().postDataJSON()
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            id: '249a8d07-8490-43ed-98fa-ebaa91b05e90',
            name: input.name,
            plan: 'Free',
            logoUrl: '',
            role: 'owner',
          },
        }),
      })
      return
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            id: MOCK_WORKSPACE_ID,
            name: 'Dokudocs Workspace',
            plan: 'Pro Workspace',
            logoUrl: '',
            role: 'owner',
          },
        ],
      }),
    })
  })

  await page.route('**/api/v1/projects', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    })
  })

  await page.route('**/api/v1/documents', async (route) => {
    if (route.request().method() === 'POST') {
      const input = route.request().postDataJSON()
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            ...mockDocument('doc-created', input.title, input.type, input.content),
            projectId: input.projectId,
            categories: input.categories,
            isDraft: input.isDraft,
            visibility: input.visibility,
          },
        }),
      })
      return
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: MOCK_DOCUMENTS }),
    })
  })
}

export async function setAuthenticatedState(page: Page) {
  await setupAuthMockRoutes(page)
  await page.context().addCookies([
    {
      name: 'thisisjustarandomstring',
      value: JSON.stringify(MOCK_TOKEN),
      url: 'http://127.0.0.1:4173',
    },
  ])
}
