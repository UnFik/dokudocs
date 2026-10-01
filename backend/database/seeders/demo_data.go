package seeders

import (
	"context"
	"database/sql"
)

const (
	DemoWorkspaceID = "00000000-0000-0000-0000-000000000010"
	DemoProject1ID  = "00000000-0000-0000-0000-000000000020"
	DemoProject2ID  = "00000000-0000-0000-0000-000000000021"

	DemoCat1ID = "00000000-0000-0000-0000-000000000041"
	DemoCat2ID = "00000000-0000-0000-0000-000000000042"
	DemoCat3ID = "00000000-0000-0000-0000-000000000043"

	DemoDoc1ID = "00000000-0000-0000-0000-000000000031"
	DemoDoc2ID = "00000000-0000-0000-0000-000000000032"
	DemoDoc3ID = "00000000-0000-0000-0000-000000000033"
)

func init() {
	Register(func(ctx context.Context, db *sql.DB) error {
		return SeedDemoData(ctx, db)
	})
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

	// 5. Seed Documents
	const seedDocsQuery = `
		INSERT INTO documents (id, workspace_id, project_id, title, type, content, author_id, tags, is_draft, visibility)
		VALUES
			(
				$1, $2, $3, 'Order Processing FSD', 'markdown',
				'# Functional Specification: Order Processing Service\n\n## 1. Overview\nThe Order Processing Service manages cart validation, inventory reservation, payment authorization, and fulfillment dispatch.\n\n## 2. Order States\n- **PENDING**: Order placed, waiting for payment confirmation.\n- **PAID**: Payment verified by gateway.\n- **PROCESSING**: Warehouse allocation underway.\n- **SHIPPED**: Courier tracking active.\n- **COMPLETED**: Received by customer.',
				$4, '{"Checkout", "Core API", "FSD"}', false, 'workspace'
			),
			(
				$5, $2, $3, 'E-Commerce Database Schema', 'dbdiagram',
				'Table users {\n  id int [pk, increment]\n  email varchar(255) [unique, not null]\n  full_name varchar(150)\n  created_at timestamp\n}\n\nTable orders {\n  id int [pk, increment]\n  user_id int [ref: > users.id]\n  total_amount decimal(12,2)\n  status varchar(50)\n  created_at timestamp\n}',
				$4, '{"Database", "Postgres", "DBML"}', false, 'workspace'
			),
			(
				$6, $2, $3, 'Checkout & Payment Flow', 'mermaid',
				'graph TD\n  Customer([Customer]) --> AddCart[Add Item to Cart]\n  AddCart --> Review[Review Cart]\n  Review --> Checkout[Click Checkout]\n  CheckStock -- No --> OutOfStock[Show Stock Error]\n  CheckStock -- Yes --> ReserveStock[Reserve Inventory 15m]\n  ReserveStock --> SelectPayment[Select Payment Method]',
				$4, '{"Flowchart", "Mermaid", "Checkout"}', false, 'workspace'
			)
		ON CONFLICT (id) DO UPDATE SET
			title = EXCLUDED.title,
			content = EXCLUDED.content,
			updated_at = NOW();
	`
	if _, err := db.ExecContext(ctx, seedDocsQuery, DemoDoc1ID, DemoWorkspaceID, DemoProject1ID, AdminUser.ID, DemoDoc2ID, DemoDoc3ID); err != nil {
		return err
	}

	// 6. Seed Document Category Mappings
	const seedCatMappingsQuery = `
		INSERT INTO document_category_mappings (document_id, category_id)
		VALUES
			($1, $2),
			($3, $4)
		ON CONFLICT (document_id, category_id) DO NOTHING;
	`
	if _, err := db.ExecContext(ctx, seedCatMappingsQuery, DemoDoc1ID, DemoCat1ID, DemoDoc2ID, DemoCat2ID); err != nil {
		return err
	}

	for _, documentID := range []string{DemoDoc1ID, DemoDoc2ID, DemoDoc3ID} {
		if err := ensureSeedDocumentOwnerGrant(ctx, db, documentID, AdminUser.ID); err != nil {
			return err
		}
	}

	return nil
}
