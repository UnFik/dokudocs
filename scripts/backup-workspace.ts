import fs from 'node:fs'
import path from 'node:path'
import { mockDocuments } from '../frontend/src/features/docs/data/mock-docs'
import { mockProjects } from '../frontend/src/features/projects/data/mock-projects'
import { mockTrash } from '../frontend/src/features/trash/data/mock-trash'
import { defaultWorkspaces } from '../frontend/src/stores/dokudocs-store'

const BACKUP_DIR = path.resolve(import.meta.dir, '../backups')
const DOCS_DIR = path.join(BACKUP_DIR, 'documents')

// Ensure directories exist
fs.mkdirSync(path.join(DOCS_DIR, 'markdown'), { recursive: true })
fs.mkdirSync(path.join(DOCS_DIR, 'dbml'), { recursive: true })
fs.mkdirSync(path.join(DOCS_DIR, 'mermaid'), { recursive: true })

function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

// 1. Export individual files
for (const doc of mockDocuments) {
  const filenameBase = sanitizeFilename(doc.title)
  let subDir = 'markdown'
  let ext = '.md'

  if (doc.type === 'dbdiagram') {
    subDir = 'dbml'
    ext = '.dbml'
  } else if (doc.type === 'mermaid') {
    subDir = 'mermaid'
    ext = '.mmd'
  }

  const filePath = path.join(DOCS_DIR, subDir, `${filenameBase}${ext}`)
  fs.writeFileSync(filePath, doc.content, 'utf8')
}

// 2. Export full workspace JSON snapshot
const fullBackup = {
  version: 2,
  createdAt: new Date().toISOString(),
  description: 'Dokudocs Workspace data backup (documents, projects, workspaces, trash)',
  workspaces: defaultWorkspaces,
  projects: mockProjects,
  documents: mockDocuments,
  trash: mockTrash,
}

const jsonBackupPath = path.join(BACKUP_DIR, 'dokudocs_workspace_backup.json')
fs.writeFileSync(jsonBackupPath, JSON.stringify(fullBackup, null, 2), 'utf8')

// 3. Export SQL Seeder / Backup
function escapeSqlString(str: string): string {
  return str.replace(/'/g, "''")
}

let sqlContent = `-- Dokudocs Workspace Database Seed & Backup
-- Generated: ${new Date().toISOString()}
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
`

const projectUuidMap: Record<string, string> = {
  'proj-1': '00000000-0000-0000-0000-000000000020',
  'proj-2': '00000000-0000-0000-0000-000000000021',
  'proj-3': '00000000-0000-0000-0000-000000000022',
}

for (const p of mockProjects) {
  const uuid = projectUuidMap[p.id] || `00000000-0000-0000-0000-${p.id.replace(/[^0-9]/g, '').padStart(12, '0')}`
  sqlContent += `INSERT INTO projects (id, workspace_id, name, description, color_badge, visibility, created_by)
VALUES (
  '${uuid}',
  '00000000-0000-0000-0000-000000000010',
  '${escapeSqlString(p.name)}',
  '${escapeSqlString(p.description || '')}',
  '${p.colorBadge || '#3b82f6'}',
  'workspace',
  '00000000-0000-0000-0000-000000000001'
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  color_badge = EXCLUDED.color_badge,
  updated_at = NOW();
\n`
}

sqlContent += `-- Project Categories\n`
for (const p of mockProjects) {
  const pUuid = projectUuidMap[p.id]
  for (let i = 0; i < (p.categories || []).length; i++) {
    const catName = p.categories![i]
    sqlContent += `INSERT INTO project_categories (project_id, name, color_id, sort_order)
VALUES (
  '${pUuid}',
  '${escapeSqlString(catName)}',
  'blue',
  ${i + 1}
)
ON CONFLICT (project_id, name) DO UPDATE SET
  sort_order = EXCLUDED.sort_order;
`
  }
}

sqlContent += `\n-- Documents\n`
const docUuidMap: Record<string, string> = {
  'doc-1': '00000000-0000-0000-0000-000000000031',
  'doc-2': '00000000-0000-0000-0000-000000000032',
  'doc-3': '00000000-0000-0000-0000-000000000033',
}
let docNum = 33
for (const doc of mockDocuments) {
  let docId = docUuidMap[doc.id]
  if (!docId) {
    docNum++
    docId = `00000000-0000-0000-0000-0000000000${docNum}`
    docUuidMap[doc.id] = docId
  }
  const pUuid = doc.projectId ? projectUuidMap[doc.projectId] : null
  const tagsArray = (doc.tags || []).map((t) => `"${escapeSqlString(t)}"`).join(', ')

  sqlContent += `INSERT INTO documents (id, workspace_id, project_id, title, type, content, author_id, tags, is_draft, visibility)
VALUES (
  '${docId}',
  '00000000-0000-0000-0000-000000000010',
  ${pUuid ? `'${pUuid}'` : 'NULL'},
  '${escapeSqlString(doc.title)}',
  '${doc.type}',
  '${escapeSqlString(doc.content)}',
  '00000000-0000-0000-0000-000000000001',
  '{${tagsArray}}',
  ${doc.isDraft ? 'true' : 'false'},
  'workspace'
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  type = EXCLUDED.type,
  tags = EXCLUDED.tags,
  is_draft = EXCLUDED.is_draft,
  updated_at = NOW();
\n`
}

sqlContent += `COMMIT;\n`

const sqlBackupPath = path.join(BACKUP_DIR, 'seed_workspace_backup.sql')
fs.writeFileSync(sqlBackupPath, sqlContent, 'utf8')

console.log(`Backup completed successfully in ${BACKUP_DIR}`)
