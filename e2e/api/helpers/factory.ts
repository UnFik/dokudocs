export function uniqueId(prefix = 'test'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export function generateUser() {
  const id = uniqueId('usr')
  return {
    email: `${id}@dokudocs.test`,
    password: 'password12345678',
    fullName: `Test User ${id}`,
  }
}

export function generateWorkspace() {
  const id = uniqueId('ws')
  return {
    name: `Workspace ${id}`,
    plan: 'Pro Workspace',
    logoUrl: `https://example.com/${id}.png`,
  }
}

export function generateProject(namePrefix = 'Project') {
  const id = uniqueId('prj')
  return {
    name: `${namePrefix} ${id}`,
    description: `Description for ${namePrefix} ${id}`,
    logoUrl: `https://example.com/${id}.png`,
    colorBadge: '#6366f1',
    visibility: 'workspace',
    categories: ['General', 'API', 'Docs'],
  }
}

export function generateCategory(prefix = 'Cat') {
  const id = uniqueId('cat')
  return {
    name: `${prefix} ${id}`,
    colorId: 'purple',
  }
}

export function generateDocument(titlePrefix = 'Architecture Doc') {
  const id = uniqueId('doc')
  return {
    title: `${titlePrefix} ${id}`,
    type: 'markdown',
    content: `# ${titlePrefix}\n\nContent details for document ${id}.`,
    visibility: 'workspace',
    tags: ['design', 'v1'],
    categories: ['General'],
    isDraft: false,
  }
}

