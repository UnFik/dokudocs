import json
import uuid
import re

NAMESPACE = uuid.UUID('e0f47c32-6a5e-44ef-9b0d-4bb816c8736a')

def to_uuid(prefix, raw_id):
    if not raw_id:
        return None
    try:
        return str(uuid.UUID(raw_id))
    except ValueError:
        pass
    if raw_id == 'org-1':
        return '00000000-0000-0000-0000-000000000010'
    if raw_id == 'usr-1':
        return '00000000-0000-0000-0000-000000000002'
    if raw_id == 'usr-2':
        return '00000000-0000-0000-0000-000000000003'
    if raw_id == 'usr-3':
        return '00000000-0000-0000-0000-000000000004'
    if raw_id == 'doc-1':
        return '00000000-0000-0000-0000-000000000031'
    if raw_id == 'doc-2':
        return '00000000-0000-0000-0000-000000000032'
    if raw_id == 'doc-3':
        return '00000000-0000-0000-0000-000000000033'
    return str(uuid.uuid5(NAMESPACE, f'{prefix}:{raw_id}'))

def escape_sql(s):
    if s is None:
        return 'NULL'
    return "'" + str(s).replace("'", "''") + "'"

def slugify(text):
    text = text.lower()
    text = re.sub(r'[^a-z0-9]+', '-', text)
    return text.strip('-')

with open('backups/dokudocs_backup_state.json', 'r', encoding='utf-8') as f:
    state = json.load(f)['state']

sql_lines = []
sql_lines.append("-- Dokudocs SQL Seeder from Backup State")
sql_lines.append("BEGIN;\n")

# 1. Users
users = {
    'usr-1': {'id': 'usr-1', 'name': 'Fikri', 'email': 'fikri@dokudocs.app', 'avatar': '/avatars/01.png', 'role': 'superadmin', 'acc': 'ACC-001'},
    'usr-2': {'id': 'usr-2', 'name': 'Sarah Chen', 'email': 'sarah@dokudocs.app', 'avatar': '/avatars/02.png', 'role': 'member', 'acc': 'ACC-002'},
    'usr-3': {'id': 'usr-3', 'name': 'Alex Rivera', 'email': 'alex@dokudocs.app', 'avatar': '/avatars/03.png', 'role': 'member', 'acc': 'ACC-003'},
}

sql_lines.append("-- 1. Users & Settings")
for u_id, u in users.items():
    u_uuid = to_uuid('user', u_id)
    pwd_hash = "$2b$10$spIx2n0YXUjQqPHKX5SVJ.A9F8Zhg6ENvnAOFXEDbwId2rz.86Eyq" # password123
    sql_lines.append(f"""INSERT INTO users (id, account_no, email, password_hash, full_name, avatar_url)
VALUES ('{u_uuid}', '{u['acc']}', '{u['email']}', '{pwd_hash}', {escape_sql(u['name'])}, {escape_sql(u['avatar'])})
ON CONFLICT (email) DO UPDATE SET
    account_no = EXCLUDED.account_no,
    full_name = EXCLUDED.full_name,
    avatar_url = EXCLUDED.avatar_url,
    updated_at = NOW();""")
    sql_lines.append(f"""INSERT INTO user_settings (user_id) VALUES ('{u_uuid}') ON CONFLICT (user_id) DO NOTHING;""")
    sql_lines.append(f"""INSERT INTO user_roles (user_id, role_id, assigned_at)
SELECT '{u_uuid}'::uuid, id, NOW() FROM roles WHERE slug = '{u['role']}'
ON CONFLICT (user_id, role_id) DO NOTHING;\n""")

# 2. Workspaces
sql_lines.append("-- 2. Workspaces & Members")
admin_uuid = to_uuid('user', 'usr-1')
for org in state['organizations']:
    org_uuid = to_uuid('workspace', org['id'])
    slug = slugify(org['name'])
    plan = org.get('plan', 'Free')
    role = org.get('role', 'owner')
    sql_lines.append(f"""INSERT INTO workspaces (id, name, slug, plan, created_by)
VALUES ('{org_uuid}', {escape_sql(org['name'])}, '{slug}', '{plan}', '{admin_uuid}')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    plan = EXCLUDED.plan,
    updated_at = NOW();""")
    sql_lines.append(f"""INSERT INTO workspace_members (workspace_id, user_id, role)
VALUES ('{org_uuid}', '{admin_uuid}', '{role}')
ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role;\n""")

# Additional workspace members for org-1
sql_lines.append(f"""INSERT INTO workspace_members (workspace_id, user_id, role)
VALUES ('{to_uuid("workspace", "org-1")}', '{to_uuid("user", "usr-2")}', 'member')
ON CONFLICT (workspace_id, user_id) DO NOTHING;""")
sql_lines.append(f"""INSERT INTO workspace_members (workspace_id, user_id, role)
VALUES ('{to_uuid("workspace", "org-1")}', '{to_uuid("user", "usr-3")}', 'member')
ON CONFLICT (workspace_id, user_id) DO NOTHING;\n""")

# 3. Projects & Categories
sql_lines.append("-- 3. Projects, Categories, Members, & Stars")
category_map = {}

for proj in state['projects']:
    proj_uuid = to_uuid('project', proj['id'])
    ws_uuid = to_uuid('workspace', proj.get('orgId', 'org-1'))
    desc = proj.get('description', '')
    logo = proj.get('logoUrl', '')
    created_at = proj.get('createdAt', 'NOW()')
    sql_lines.append(f"""INSERT INTO projects (id, workspace_id, name, description, logo_url, color_badge, visibility, created_by, created_at)
VALUES ('{proj_uuid}', '{ws_uuid}', {escape_sql(proj['name'])}, {escape_sql(desc)}, {escape_sql(logo)}, '#3b82f6', 'workspace', '{admin_uuid}', '{created_at}')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    logo_url = EXCLUDED.logo_url,
    updated_at = NOW();""")

    # Categories
    cats = proj.get('categories', [])
    colors = proj.get('categoryColors', {})
    for idx, cat_name in enumerate(cats):
        cat_uuid = to_uuid('category', f"{proj['id']}:{cat_name}")
        category_map[(proj['id'], cat_name)] = cat_uuid
        color = colors.get(cat_name, 'blue')
        sql_lines.append(f"""INSERT INTO project_categories (id, project_id, name, color_id, sort_order)
VALUES ('{cat_uuid}', '{proj_uuid}', {escape_sql(cat_name)}, '{color}', {idx + 1})
ON CONFLICT (project_id, name) DO UPDATE SET color_id = EXCLUDED.color_id, sort_order = EXCLUDED.sort_order;""")

    # Project Stars
    if proj.get('isStarred'):
        starred_at = proj.get('starredAt') or created_at
        sql_lines.append(f"""INSERT INTO project_stars (user_id, project_id, starred_at)
VALUES ('{admin_uuid}', '{proj_uuid}', '{starred_at}')
ON CONFLICT (user_id, project_id) DO NOTHING;""")

    # Project Members
    sql_lines.append(f"""INSERT INTO project_members (project_id, user_id, role)
VALUES ('{proj_uuid}', '{admin_uuid}', 'manager')
ON CONFLICT (project_id, user_id) DO NOTHING;\n""")

# 4. Documents & Categories
sql_lines.append("-- 4. Documents & Mappings")
valid_doc_uuids = set()

for doc in state['documents']:
    doc_uuid = to_uuid('document', doc['id'])
    valid_doc_uuids.add(doc_uuid)
    ws_uuid = to_uuid('workspace', doc.get('orgId', 'org-1'))
    p_id = doc.get('projectId')
    p_uuid = f"'{to_uuid('project', p_id)}'" if p_id else "NULL"
    doc_type = doc['type'] # markdown, dbdiagram, mermaid
    content = doc.get('content', '')
    title = doc.get('title', 'Untitled')
    author_id = to_uuid('user', doc.get('author', {}).get('id', 'usr-1'))
    is_draft = 'true' if doc.get('isDraft') else 'false'
    del_at = f"'{doc['deletedAt']}'" if doc.get('deletedAt') else "NULL"
    tags_list = doc.get('tags', [])
    tags_sql = "{" + ",".join(f'"{t}"' for t in tags_list) + "}"
    thumb = escape_sql(doc.get('thumbnail'))
    thumb_dark = escape_sql(doc.get('thumbnailDark'))
    created_at = doc.get('createdAt', 'NOW()')
    updated_at = doc.get('updatedAt')
    if not updated_at or updated_at == 'Just now':
        updated_at = created_at

    sql_lines.append(f"""INSERT INTO documents (
    id, workspace_id, project_id, title, type, content, author_id, tags, is_draft, visibility,
    thumbnail, thumbnail_dark, created_at, updated_at, deleted_at
) VALUES (
    '{doc_uuid}', '{ws_uuid}', {p_uuid}, {escape_sql(title)}, '{doc_type}', {escape_sql(content)}, '{author_id}',
    '{tags_sql}', {is_draft}, 'workspace', {thumb}, {thumb_dark}, '{created_at}', '{updated_at}', {del_at}
) ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    type = EXCLUDED.type,
    content = EXCLUDED.content,
    tags = EXCLUDED.tags,
    is_draft = EXCLUDED.is_draft,
    thumbnail = EXCLUDED.thumbnail,
    thumbnail_dark = EXCLUDED.thumbnail_dark,
    deleted_at = EXCLUDED.deleted_at,
    updated_at = EXCLUDED.updated_at;""")

    # Category mappings
    if p_id:
        doc_cats = doc.get('categories', [])
        for cname in doc_cats:
            cat_uuid = category_map.get((p_id, cname))
            if cat_uuid:
                sql_lines.append(f"""INSERT INTO document_category_mappings (document_id, category_id)
VALUES ('{doc_uuid}', '{cat_uuid}') ON CONFLICT (document_id, category_id) DO NOTHING;""")

    # Document stars
    if doc.get('isStarred'):
        starred_at = doc.get('starredAt') or created_at
        sql_lines.append(f"""INSERT INTO document_stars (user_id, document_id, starred_at)
VALUES ('{author_id}', '{doc_uuid}', '{starred_at}') ON CONFLICT (user_id, document_id) DO NOTHING;""")

    # Document views
    last_viewed = doc.get('lastViewedAt')
    if last_viewed:
        sql_lines.append(f"""INSERT INTO document_views (user_id, document_id, last_viewed_at, view_count)
VALUES ('{author_id}', '{doc_uuid}', '{last_viewed}', 5)
ON CONFLICT (user_id, document_id) DO UPDATE SET last_viewed_at = EXCLUDED.last_viewed_at;""")

# 5. Revisions (only for documents that exist in this seed or demo seed)
sql_lines.append("\n-- 5. Document Revisions")
# Add demo doc-1 UUID to valid if present
valid_doc_uuids.add('00000000-0000-0000-0000-000000000031')

for d_key, revs in state.get('revisions', {}).items():
    matched_doc_uuid = to_uuid('document', d_key)
    if matched_doc_uuid in valid_doc_uuids:
        for rev in revs:
            r_uuid = to_uuid('revision', rev['id'])
            r_author = to_uuid('user', rev.get('author', {}).get('id', 'usr-1'))
            r_ver = rev.get('versionNumber', 1)
            r_title = escape_sql(rev.get('title'))
            r_content = escape_sql(rev.get('content', ''))
            r_created = rev.get('createdAt', 'NOW()')
            sql_lines.append(f"""INSERT INTO document_revisions (id, document_id, author_id, version_number, title, content, is_named, created_at)
SELECT '{r_uuid}', '{matched_doc_uuid}', '{r_author}', {r_ver}, {r_title}, {r_content}, false, '{r_created}'
WHERE EXISTS (SELECT 1 FROM documents WHERE id = '{matched_doc_uuid}')
ON CONFLICT (document_id, version_number) DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content;""")

# 6. Document Accesses
sql_lines.append("\n-- 6. Document Accesses")
for d_key, accesses in state.get('documentAccesses', {}).items():
    d_uuid = to_uuid('document', d_key)
    for acc in accesses:
        acc_user = to_uuid('user', acc['userId'])
        lvl = acc.get('accessLevel', 'view')
        sql_lines.append(f"""INSERT INTO document_accesses (document_id, user_id, access_level)
SELECT '{d_uuid}', '{acc_user}', '{lvl}'
WHERE EXISTS (SELECT 1 FROM documents WHERE id = '{d_uuid}')
ON CONFLICT (document_id, user_id) DO UPDATE SET access_level = EXCLUDED.access_level;""")

sql_lines.append("\nCOMMIT;\n")

out_sql = "\n".join(sql_lines)
with open('backups/seed_from_backup.sql', 'w', encoding='utf-8') as f:
    f.write(out_sql)

print(f"Generated backups/seed_from_backup.sql successfully! Total lines: {len(sql_lines)}")
