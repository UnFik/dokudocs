package seeders

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

//go:embed data/backup_state.json
var backupStateJSON []byte

var seedNamespace = uuid.MustParse("e0f47c32-6a5e-44ef-9b0d-4bb816c8736a")

func toDeterministicUUID(prefix, rawID string) string {
	if rawID == "" {
		return ""
	}
	if _, err := uuid.Parse(rawID); err == nil {
		return rawID
	}
	switch rawID {
	case "org-1":
		return "00000000-0000-0000-0000-000000000010"
	case "usr-1":
		return "00000000-0000-0000-0000-000000000002"
	case "usr-2":
		return "00000000-0000-0000-0000-000000000003"
	case "usr-3":
		return "00000000-0000-0000-0000-000000000004"
	case "doc-1":
		return "00000000-0000-0000-0000-000000000031"
	case "doc-2":
		return "00000000-0000-0000-0000-000000000032"
	case "doc-3":
		return "00000000-0000-0000-0000-000000000033"
	}
	return uuid.NewSHA1(seedNamespace, []byte(prefix+":"+rawID)).String()
}

var nonAlphanumericRegex = regexp.MustCompile(`[^a-z0-9]+`)

func slugifyText(text string) string {
	lower := strings.ToLower(text)
	slug := nonAlphanumericRegex.ReplaceAllString(lower, "-")
	return strings.Trim(slug, "-")
}

type backupStateWrapper struct {
	State backupState `json:"state"`
}

type backupOrg struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Plan string `json:"plan"`
	Role string `json:"role"`
}

type backupProject struct {
	ID             string            `json:"id"`
	Name           string            `json:"name"`
	Description    string            `json:"description"`
	LogoURL        string            `json:"logoUrl"`
	Categories     []string          `json:"categories"`
	CategoryColors map[string]string `json:"categoryColors"`
	OrgID          string            `json:"orgId"`
	IsStarred      bool              `json:"isStarred"`
	CreatedAt      string            `json:"createdAt"`
	StarredAt      *string           `json:"starredAt"`
}

type backupUser struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Email  string `json:"email"`
	Avatar string `json:"avatar"`
}

type backupDoc struct {
	ID            string      `json:"id"`
	Title         string      `json:"title"`
	Type          string      `json:"type"`
	Content       string      `json:"content"`
	ProjectID     *string     `json:"projectId"`
	Categories    []string    `json:"categories"`
	OrgID         string      `json:"orgId"`
	Author        *backupUser `json:"author"`
	IsStarred     bool        `json:"isStarred"`
	IsDraft       bool        `json:"isDraft"`
	CreatedAt     string      `json:"createdAt"`
	UpdatedAt     string      `json:"updatedAt"`
	DeletedAt     *string     `json:"deletedAt"`
	StarredAt     *string     `json:"starredAt"`
	LastViewedAt  *string     `json:"lastViewedAt"`
	Tags          []string    `json:"tags"`
	Thumbnail     *string     `json:"thumbnail"`
	ThumbnailDark *string     `json:"thumbnailDark"`
}

type backupRev struct {
	ID            string      `json:"id"`
	VersionNumber int         `json:"versionNumber"`
	Title         *string     `json:"title"`
	Content       string      `json:"content"`
	Author        *backupUser `json:"author"`
	CreatedAt     string      `json:"createdAt"`
}

type backupAcc struct {
	ID          string      `json:"id"`
	UserID      string      `json:"userId"`
	User        *backupUser `json:"user"`
	AccessLevel string      `json:"accessLevel"`
}

func backupDocumentOwnerID(doc backupDoc, accesses []backupAcc, fallbackID string) string {
	for _, access := range accesses {
		userID := access.UserID
		if userID == "" && access.User != nil {
			userID = access.User.ID
		}
		if access.AccessLevel == "owner" && userID != "" {
			return toDeterministicUUID("user", userID)
		}
	}
	if doc.Author != nil && doc.Author.ID != "" {
		return toDeterministicUUID("user", doc.Author.ID)
	}
	return fallbackID
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

type backupPM struct {
	ID     string      `json:"id"`
	UserID string      `json:"userId"`
	User   *backupUser `json:"user"`
	Role   string      `json:"role"`
}

type backupState struct {
	Organizations    []backupOrg            `json:"organizations"`
	Projects         []backupProject        `json:"projects"`
	Documents        []backupDoc            `json:"documents"`
	Revisions        map[string][]backupRev `json:"revisions"`
	DocumentAccesses map[string][]backupAcc `json:"documentAccesses"`
	ProjectMembers   map[string][]backupPM  `json:"projectMembers"`
}

func init() {
	Register(func(ctx context.Context, db *sql.DB) error {
		return SeedBackupData(ctx, db)
	})
}

func SeedBackupData(ctx context.Context, db *sql.DB) error {
	if len(backupStateJSON) == 0 {
		return nil
	}

	var wrapper backupStateWrapper
	if err := json.Unmarshal(backupStateJSON, &wrapper); err != nil {
		return fmt.Errorf("unmarshal backup state: %w", err)
	}
	state := wrapper.State

	// 1. Seed Users
	users := []struct {
		ID        string
		AccountNo string
		Email     string
		FullName  string
		AvatarURL string
		Role      string
	}{
		{
			ID:        toDeterministicUUID("user", "usr-1"),
			AccountNo: "ACC-001",
			Email:     "fikri@dokudocs.app",
			FullName:  "Fikri",
			AvatarURL: "/avatars/01.png",
			Role:      "superadmin",
		},
		{
			ID:        toDeterministicUUID("user", "usr-2"),
			AccountNo: "ACC-002",
			Email:     "sarah@dokudocs.app",
			FullName:  "Sarah Chen",
			AvatarURL: "/avatars/02.png",
			Role:      "member",
		},
		{
			ID:        toDeterministicUUID("user", "usr-3"),
			AccountNo: "ACC-003",
			Email:     "alex@dokudocs.app",
			FullName:  "Alex Rivera",
			AvatarURL: "/avatars/03.png",
			Role:      "member",
		},
	}

	adminUUID := toDeterministicUUID("user", "usr-1")
	pwdHash := AdminUser.PasswordHash

	for _, u := range users {
		const seedUserQuery = `
			INSERT INTO users (id, account_no, email, password_hash, full_name, avatar_url)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (email) DO UPDATE SET
				account_no = EXCLUDED.account_no,
				full_name = EXCLUDED.full_name,
				avatar_url = EXCLUDED.avatar_url,
				updated_at = NOW();
		`
		if _, err := db.ExecContext(ctx, seedUserQuery, u.ID, u.AccountNo, u.Email, pwdHash, u.FullName, u.AvatarURL); err != nil {
			return fmt.Errorf("seed user %s: %w", u.Email, err)
		}

		if _, err := db.ExecContext(ctx, `INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING;`, u.ID); err != nil {
			return fmt.Errorf("seed user_settings for %s: %w", u.Email, err)
		}

		const assignRoleQuery = `
			INSERT INTO user_roles (user_id, role_id, assigned_at)
			SELECT $1::uuid, id, NOW()
			FROM roles
			WHERE slug = $2
			ON CONFLICT (user_id, role_id) DO NOTHING;
		`
		if _, err := db.ExecContext(ctx, assignRoleQuery, u.ID, u.Role); err != nil {
			return fmt.Errorf("assign role to %s: %w", u.Email, err)
		}
	}

	// 2. Seed Workspaces & Members
	for _, org := range state.Organizations {
		orgUUID := toDeterministicUUID("workspace", org.ID)
		slug := slugifyText(org.Name)
		plan := org.Plan
		if plan == "" {
			plan = "Free"
		}
		role := org.Role
		if role == "" {
			role = "owner"
		}

		const seedWorkspaceQuery = `
			INSERT INTO workspaces (id, name, slug, plan, created_by)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (id) DO UPDATE SET
				name = EXCLUDED.name,
				plan = EXCLUDED.plan,
				updated_at = NOW();
		`
		if _, err := db.ExecContext(ctx, seedWorkspaceQuery, orgUUID, org.Name, slug, plan, adminUUID); err != nil {
			return fmt.Errorf("seed workspace %s: %w", org.Name, err)
		}

		const seedMemberQuery = `
			INSERT INTO workspace_members (workspace_id, user_id, role)
			VALUES ($1, $2, $3)
			ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role;
		`
		if _, err := db.ExecContext(ctx, seedMemberQuery, orgUUID, adminUUID, role); err != nil {
			return fmt.Errorf("seed workspace_member for %s: %w", org.Name, err)
		}
	}

	primaryOrgUUID := toDeterministicUUID("workspace", "org-1")
	for _, extraUser := range []string{"usr-2", "usr-3"} {
		extraUUID := toDeterministicUUID("user", extraUser)
		if _, err := db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT (workspace_id, user_id) DO NOTHING;`, primaryOrgUUID, extraUUID); err != nil {
			return err
		}
	}

	// 3. Seed Projects, Categories, Members, Stars
	categoryUUIDMap := make(map[string]string) // "project_id:cat_name" -> category UUID

	for _, p := range state.Projects {
		pUUID := toDeterministicUUID("project", p.ID)
		wsUUID := toDeterministicUUID("workspace", p.OrgID)
		if wsUUID == "" {
			wsUUID = primaryOrgUUID
		}

		createdAt := parseTimeOrNow(p.CreatedAt)

		const seedProjectQuery = `
			INSERT INTO projects (id, workspace_id, name, description, logo_url, color_badge, visibility, created_by, created_at)
			VALUES ($1, $2, $3, $4, $5, '#3b82f6', 'workspace', $6, $7)
			ON CONFLICT (id) DO UPDATE SET
				name = EXCLUDED.name,
				description = EXCLUDED.description,
				logo_url = EXCLUDED.logo_url,
				updated_at = NOW();
		`
		if _, err := db.ExecContext(ctx, seedProjectQuery, pUUID, wsUUID, p.Name, p.Description, p.LogoURL, adminUUID, createdAt); err != nil {
			return fmt.Errorf("seed project %s: %w", p.Name, err)
		}

		// Categories
		for idx, catName := range p.Categories {
			catUUID := toDeterministicUUID("category", fmt.Sprintf("%s:%s", p.ID, catName))
			categoryUUIDMap[fmt.Sprintf("%s:%s", p.ID, catName)] = catUUID

			color := "blue"
			if c, ok := p.CategoryColors[catName]; ok && c != "" {
				color = c
			}

			const seedCategoryQuery = `
				INSERT INTO project_categories (id, project_id, name, color_id, sort_order)
				VALUES ($1, $2, $3, $4, $5)
				ON CONFLICT (project_id, name) DO UPDATE SET
					color_id = EXCLUDED.color_id,
					sort_order = EXCLUDED.sort_order;
			`
			if _, err := db.ExecContext(ctx, seedCategoryQuery, catUUID, pUUID, catName, color, idx+1); err != nil {
				return fmt.Errorf("seed category %s: %w", catName, err)
			}
		}

		// Project Stars
		if p.IsStarred {
			starredAt := createdAt
			if p.StarredAt != nil && *p.StarredAt != "" {
				starredAt = parseTimeOrNow(*p.StarredAt)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO project_stars (user_id, project_id, starred_at) VALUES ($1, $2, $3) ON CONFLICT (user_id, project_id) DO NOTHING;`, adminUUID, pUUID, starredAt); err != nil {
				return err
			}
		}

		// Project Member
		if _, err := db.ExecContext(ctx, `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'manager') ON CONFLICT (project_id, user_id) DO NOTHING;`, pUUID, adminUUID); err != nil {
			return err
		}
	}

	// 4. Seed Documents & Mappings
	validDocUUIDs := make(map[string]bool)
	validDocUUIDs["00000000-0000-0000-0000-000000000031"] = true // demo doc-1

	for _, doc := range state.Documents {
		docUUID := toDeterministicUUID("document", doc.ID)
		validDocUUIDs[docUUID] = true
		wsUUID := toDeterministicUUID("workspace", doc.OrgID)
		if wsUUID == "" {
			wsUUID = primaryOrgUUID
		}

		var pUUID *string
		if doc.ProjectID != nil && *doc.ProjectID != "" {
			id := toDeterministicUUID("project", *doc.ProjectID)
			pUUID = &id
		}

		authorID := adminUUID
		if doc.Author != nil && doc.Author.ID != "" {
			authorID = toDeterministicUUID("user", doc.Author.ID)
		}

		createdAt := parseTimeOrNow(doc.CreatedAt)
		updatedAt := createdAt
		if doc.UpdatedAt != "" && doc.UpdatedAt != "Just now" {
			updatedAt = parseTimeOrNow(doc.UpdatedAt)
		}

		var deletedAt *time.Time
		if doc.DeletedAt != nil && *doc.DeletedAt != "" {
			t := parseTimeOrNow(*doc.DeletedAt)
			deletedAt = &t
		}

		tags := doc.Tags
		if tags == nil {
			tags = []string{}
		}
		var pgTags pgtype.FlatArray[string] = tags

		const seedDocQuery = `
			INSERT INTO documents (
				id, workspace_id, project_id, title, type, content, author_id, tags,
				is_draft, visibility, thumbnail, thumbnail_dark, created_at, updated_at, deleted_at
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8, $9, 'workspace', $10, $11, $12, $13, $14
			) ON CONFLICT (id) DO UPDATE SET
				title = EXCLUDED.title,
				type = EXCLUDED.type,
				content = EXCLUDED.content,
				tags = EXCLUDED.tags,
				is_draft = EXCLUDED.is_draft,
				thumbnail = EXCLUDED.thumbnail,
				thumbnail_dark = EXCLUDED.thumbnail_dark,
				deleted_at = EXCLUDED.deleted_at,
				updated_at = EXCLUDED.updated_at;
		`
		if _, err := db.ExecContext(ctx, seedDocQuery, docUUID, wsUUID, pUUID, doc.Title, doc.Type, doc.Content, authorID, pgTags, doc.IsDraft, doc.Thumbnail, doc.ThumbnailDark, createdAt, updatedAt, deletedAt); err != nil {
			return fmt.Errorf("seed doc %s (%s): %w", doc.Title, doc.ID, err)
		}

		// Category mappings
		if doc.ProjectID != nil && *doc.ProjectID != "" {
			for _, cname := range doc.Categories {
				key := fmt.Sprintf("%s:%s", *doc.ProjectID, cname)
				if catUUID, ok := categoryUUIDMap[key]; ok {
					if _, err := db.ExecContext(ctx, `INSERT INTO document_category_mappings (document_id, category_id) VALUES ($1, $2) ON CONFLICT (document_id, category_id) DO NOTHING;`, docUUID, catUUID); err != nil {
						return err
					}
				}
			}
		}

		// Document Stars
		if doc.IsStarred {
			starredAt := createdAt
			if doc.StarredAt != nil && *doc.StarredAt != "" {
				starredAt = parseTimeOrNow(*doc.StarredAt)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO document_stars (user_id, document_id, starred_at) VALUES ($1, $2, $3) ON CONFLICT (user_id, document_id) DO NOTHING;`, authorID, docUUID, starredAt); err != nil {
				return err
			}
		}

		// Document Views
		if doc.LastViewedAt != nil && *doc.LastViewedAt != "" {
			lastViewed := parseTimeOrNow(*doc.LastViewedAt)
			if _, err := db.ExecContext(ctx, `INSERT INTO document_views (user_id, document_id, last_viewed_at, view_count) VALUES ($1, $2, $3, 5) ON CONFLICT (user_id, document_id) DO UPDATE SET last_viewed_at = EXCLUDED.last_viewed_at;`, authorID, docUUID, lastViewed); err != nil {
				return err
			}
		}
	}

	// 5. Seed Document Revisions
	for docKey, revs := range state.Revisions {
		matchedDocUUID := toDeterministicUUID("document", docKey)
		if !validDocUUIDs[matchedDocUUID] {
			continue
		}
		for _, rev := range revs {
			revUUID := toDeterministicUUID("revision", rev.ID)
			authorID := adminUUID
			if rev.Author != nil && rev.Author.ID != "" {
				authorID = toDeterministicUUID("user", rev.Author.ID)
			}
			createdAt := parseTimeOrNow(rev.CreatedAt)

			const seedRevQuery = `
				INSERT INTO document_revisions (id, document_id, author_id, version_number, title, content, is_named, created_at)
				SELECT $1, $2, $3, $4, $5, $6, false, $7
				WHERE EXISTS (SELECT 1 FROM documents WHERE id = $2)
				ON CONFLICT (document_id, version_number) DO UPDATE SET
					title = EXCLUDED.title,
					content = EXCLUDED.content;
			`
			if _, err := db.ExecContext(ctx, seedRevQuery, revUUID, matchedDocUUID, authorID, rev.VersionNumber, rev.Title, rev.Content, createdAt); err != nil {
				return fmt.Errorf("seed revision %s: %w", rev.ID, err)
			}
		}
	}

	// 6. Seed Document Accesses
	for docKey, accesses := range state.DocumentAccesses {
		docUUID := toDeterministicUUID("document", docKey)
		for _, acc := range accesses {
			accUserUUID := toDeterministicUUID("user", acc.UserID)
			lvl := acc.AccessLevel
			if lvl == "" {
				lvl = "view"
			}
			const seedAccQuery = `
				INSERT INTO document_accesses (document_id, user_id, access_level)
				SELECT $1, $2, $3
				WHERE EXISTS (SELECT 1 FROM documents WHERE id = $1)
				ON CONFLICT (document_id, user_id) DO UPDATE SET access_level = EXCLUDED.access_level;
			`
			if _, err := db.ExecContext(ctx, seedAccQuery, docUUID, accUserUUID, lvl); err != nil {
				return fmt.Errorf("seed doc access %s: %w", acc.ID, err)
			}
		}
	}

	// Older browser backups omit owner grants. Restore their explicit owner if
	// present, otherwise use the legacy author only when no owner is recorded.
	for _, doc := range state.Documents {
		docUUID := toDeterministicUUID("document", doc.ID)
		ownerID := backupDocumentOwnerID(doc, state.DocumentAccesses[doc.ID], adminUUID)
		if err := ensureSeedDocumentOwnerGrant(ctx, db, docUUID, ownerID); err != nil {
			return fmt.Errorf("seed owner grant for document %s: %w", doc.ID, err)
		}
	}

	return nil
}

func parseTimeOrNow(s string) time.Time {
	if s == "" || s == "Just now" {
		return time.Now()
	}
	formats := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05Z07:00",
		"2006-01-02 15:04:05",
	}
	for _, f := range formats {
		if t, err := time.Parse(f, s); err == nil {
			return t
		}
	}
	return time.Now()
}
