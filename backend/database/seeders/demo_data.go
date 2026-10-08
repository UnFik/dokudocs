package seeders

import (
	"context"
	"database/sql"
	"fmt"
)

const (
	DemoWorkspaceID = "00000000-0000-0000-0000-000000000010"
	DemoProject1ID  = "00000000-0000-0000-0000-000000000020"
	DemoProject2ID  = "00000000-0000-0000-0000-000000000021"

	DemoCat1ID = "00000000-0000-0000-0000-000000000041"
	DemoCat2ID = "00000000-0000-0000-0000-000000000042"
	DemoCat3ID = "00000000-0000-0000-0000-000000000043"

	DemoDoc2ID = "00000000-0000-0000-0000-000000000032"
	DemoDoc3ID = "00000000-0000-0000-0000-000000000033"
)

func init() {
	Register(func(ctx context.Context, db *sql.DB) error {
		return SeedDemoData(ctx, db)
	})
}

// mockDocumentID is the fixed ID of the index-th mock Markdown document.
func mockDocumentID(index int) string {
	return fmt.Sprintf("00000000-0000-0000-0000-0000000001%02d", index)
}

func SeedDemoData(ctx context.Context, db *sql.DB) error {
	// 1. Seed Workspace
	const seedWorkspaceQuery = `
		INSERT INTO workspaces (id, name, slug, plan, created_by)
		VALUES ($1, 'Dokudocs Workspace', 'dokudocs-workspace', 'Pro Workspace', $2)
		ON CONFLICT (slug) DO UPDATE SET
			name = EXCLUDED.name,
			plan = EXCLUDED.plan,
			updated_at = NOW();
	`
	if _, err := db.ExecContext(ctx, seedWorkspaceQuery, DemoWorkspaceID, AdminUser.ID); err != nil {
		return err
	}

	// 2. Seed Workspace Member
	const seedMemberQuery = `
		INSERT INTO workspace_members (workspace_id, user_id, role)
		VALUES ($1, $2, 'owner')
		ON CONFLICT (workspace_id, user_id) DO NOTHING;
	`
	if _, err := db.ExecContext(ctx, seedMemberQuery, DemoWorkspaceID, AdminUser.ID); err != nil {
		return err
	}

	// 3. Seed Projects
	const seedProjectsQuery = `
		INSERT INTO projects (id, workspace_id, name, description, color_badge, visibility, created_by)
		VALUES 
			($1, $2, 'E-Commerce Core', 'Core commerce, checkout flow, and inventory models', '#3b82f6', 'workspace', $3),
			($4, $2, 'Payment Gateway', 'Unified payment orchestration and webhook handlers', '#10b981', 'workspace', $3)
		ON CONFLICT (id) DO UPDATE SET
			name = EXCLUDED.name,
			description = EXCLUDED.description,
			updated_at = NOW();
	`
	if _, err := db.ExecContext(ctx, seedProjectsQuery, DemoProject1ID, DemoWorkspaceID, AdminUser.ID, DemoProject2ID); err != nil {
		return err
	}

	// 4. Seed Project Categories
	const seedCategoriesQuery = `
		INSERT INTO project_categories (id, project_id, name, color_id, sort_order)
		VALUES
			($1, $2, 'Checkout Flow', 'blue', 1),
			($3, $2, 'Database Schema', 'emerald', 2),
			($4, $2, 'Core Architecture', 'purple', 3)
		ON CONFLICT (project_id, name) DO NOTHING;
	`
	if _, err := db.ExecContext(ctx, seedCategoriesQuery, DemoCat1ID, DemoProject1ID, DemoCat2ID, DemoCat3ID); err != nil {
		return err
	}

	// The Markdown document the AST-era seed made is gone; the mock documents below replace it.
	if _, err := db.ExecContext(ctx, `DELETE FROM documents WHERE id = '00000000-0000-0000-0000-000000000031'`); err != nil {
		return err
	}

	// 5. Seed Documents
	const seedDocsQuery = `
		INSERT INTO documents (id, workspace_id, project_id, title, type, content, author_id, tags, is_draft, visibility)
		VALUES
			(
				$1, $2, $3, 'E-Commerce Database Schema', 'dbdiagram',
				'Table users {\n  id int [pk, increment]\n  email varchar(255) [unique, not null]\n  full_name varchar(150)\n  created_at timestamp\n}\n\nTable orders {\n  id int [pk, increment]\n  user_id int [ref: > users.id]\n  total_amount decimal(12,2)\n  status varchar(50)\n  created_at timestamp\n}',
				$4, '{"Database", "Postgres", "DBML"}', false, 'workspace'
			),
			(
				$5, $2, $3, 'Checkout & Payment Flow', 'mermaid',
				'graph TD\n  Customer([Customer]) --> AddCart[Add Item to Cart]\n  AddCart --> Review[Review Cart]\n  Review --> Checkout[Click Checkout]\n  CheckStock -- No --> OutOfStock[Show Stock Error]\n  CheckStock -- Yes --> ReserveStock[Reserve Inventory 15m]\n  ReserveStock --> SelectPayment[Select Payment Method]',
				$4, '{"Flowchart", "Mermaid", "Checkout"}', false, 'workspace'
			)
		ON CONFLICT (id) DO UPDATE SET
			title = EXCLUDED.title,
			content = EXCLUDED.content,
			updated_at = NOW();
	`
	if _, err := db.ExecContext(ctx, seedDocsQuery, DemoDoc2ID, DemoWorkspaceID, DemoProject1ID, AdminUser.ID, DemoDoc3ID); err != nil {
		return err
	}

	// 5b. Seed the Markdown documents, with their editor JSON.
	for index, doc := range mockMarkdownDocuments() {
		id := mockDocumentID(index)
		if _, err := db.ExecContext(ctx, `
			INSERT INTO documents (id, workspace_id, project_id, title, type, content, content_json, author_id, is_draft, visibility)
			VALUES ($1, $2, $3, $4, 'markdown', $5, $6::jsonb, $7, false, 'workspace')
			ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content, content_json = EXCLUDED.content_json, updated_at = NOW()
		`, id, DemoWorkspaceID, DemoProject1ID, doc.title, doc.markdown, doc.json, AdminUser.ID); err != nil {
			return err
		}
		// A new JSON replaces the old state; the collaboration service builds a fresh one.
		if _, err := db.ExecContext(ctx, `DELETE FROM document_collab_states WHERE document_id = $1`, id); err != nil {
			return err
		}
		if err := ensureSeedDocumentOwnerGrant(ctx, db, id, AdminUser.ID); err != nil {
			return err
		}
	}

	// 6. Seed Document Category Mappings
	const seedCatMappingsQuery = `
		INSERT INTO document_category_mappings (document_id, category_id)
		VALUES
			($1, $2),
			($3, $4)
		ON CONFLICT (document_id, category_id) DO NOTHING;
	`
	if _, err := db.ExecContext(ctx, seedCatMappingsQuery, mockDocumentID(0), DemoCat1ID, DemoDoc2ID, DemoCat2ID); err != nil {
		return err
	}

	for _, documentID := range []string{DemoDoc2ID, DemoDoc3ID} {
		if err := ensureSeedDocumentOwnerGrant(ctx, db, documentID, AdminUser.ID); err != nil {
			return err
		}
	}

	return nil
}

func ensureSeedDocumentOwnerGrant(ctx context.Context, db *sql.DB, documentID, ownerID string) error {
	const query = `
		INSERT INTO document_accesses (document_id, user_id, access_level)
		SELECT $1, $2, 'owner'::document_access_level
		WHERE EXISTS (SELECT 1 FROM documents WHERE id = $1)
		  AND NOT EXISTS (
			SELECT 1 FROM document_accesses WHERE document_id = $1 AND access_level = 'owner'
		  )
		ON CONFLICT (document_id, user_id) DO UPDATE SET access_level = EXCLUDED.access_level;
	`
	_, err := db.ExecContext(ctx, query, documentID, ownerID)
	return err
}
