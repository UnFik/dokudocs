package document

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"backend/constant"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

// ArchitectureVersionPin is one linked document of a version: the named revision
// made for it, or none when the tagger could not read the document.
type ArchitectureVersionPin struct {
	DocumentID    uuid.UUID  `json:"documentId"`
	Title         string     `json:"title"`
	DocumentType  string     `json:"documentType"`
	RevisionID    *uuid.UUID `json:"revisionId"`
	VersionNumber *int       `json:"versionNumber"`
}

// ArchitectureVersion is a labelled, frozen state of a canvas and its linked documents (ADR 0032).
type ArchitectureVersion struct {
	ID             uuid.UUID                `json:"id"`
	ArchitectureID uuid.UUID                `json:"architectureId"`
	RevisionID     uuid.UUID                `json:"revisionId"`
	RevisionNumber int                      `json:"revisionNumber"`
	Label          string                   `json:"label"`
	Description    string                   `json:"description"`
	CreatedBy      *uuid.UUID               `json:"createdBy"`
	CreatedByName  string                   `json:"createdByName"`
	CreatedAt      time.Time                `json:"createdAt"`
	Pins           []ArchitectureVersionPin `json:"pins"`
}

func uniqueViolation(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23505"
}

func validVersionText(label, description string) bool {
	label = strings.TrimSpace(label)
	return label != "" && len([]rune(label)) <= 80 && len([]rune(description)) <= 1000
}

// CreateArchitectureVersion tags the canvas: a named revision of it, and a named
// revision of every linked document the actor can read, titled "<canvas> <label>".
// Documents the actor cannot read are recorded as not pinned.
func (r *Repository) CreateArchitectureVersion(ctx context.Context, workspaceID, architectureID, actorID uuid.UUID, label, description string) (ArchitectureVersion, error) {
	if !validVersionText(label, description) {
		return ArchitectureVersion{}, constant.ErrDocumentConflict
	}
	label = strings.TrimSpace(label)
	var created uuid.UUID
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, architectureID, workspaceID, actorID, false, nil)
		if err != nil {
			return err
		}
		if !policy.CanReadDocument(doc, access) {
			return constant.ErrDocumentNotFound
		}
		if !policy.CanEditDocument(doc, access) {
			return constant.ErrForbidden
		}
		var documentType, title string
		if err := tx.QueryRowContext(ctx, `SELECT type::text, title FROM documents WHERE id = $1`, architectureID).Scan(&documentType, &title); err != nil {
			return err
		}
		if documentType != "architecture" {
			return constant.ErrDocumentNotFound
		}
		var taken bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM architecture_versions WHERE architecture_id = $1 AND label = $2)`, architectureID, label).Scan(&taken); err != nil {
			return err
		}
		if taken {
			return constant.ErrDocumentConflict
		}
		canvas, err := insertNamedRevision(ctx, tx, architectureID, workspaceID, actorID, label)
		if err != nil {
			return err
		}
		if err := tx.QueryRowContext(ctx, `
			INSERT INTO architecture_versions (architecture_id, revision_id, label, description, created_by)
			VALUES ($1, $2, $3, $4, $5) RETURNING id
		`, architectureID, canvas.ID, label, description, actorID).Scan(&created); err != nil {
			if uniqueViolation(err) {
				return constant.ErrDocumentConflict
			}
			return err
		}
		linked, err := collectIDs(ctx, tx, `SELECT DISTINCT document_id FROM architecture_document_links WHERE architecture_id = $1`, architectureID)
		if err != nil {
			return err
		}
		readable := map[uuid.UUID]bool{}
		if len(linked) > 0 {
			ids, err := collectIDs(ctx, tx, `
				SELECT d.id FROM documents d
				WHERE d.workspace_id = $1 AND d.id = ANY($3::uuid[]) AND d.deleted_at IS NULL
			`+documentReadPredicate, workspaceID, actorID, uuidArray(linked))
			if err != nil {
				return err
			}
			for _, id := range ids {
				readable[id] = true
			}
		}
		for _, documentID := range linked {
			var revisionID *uuid.UUID
			if readable[documentID] {
				revision, err := insertNamedRevision(ctx, tx, documentID, workspaceID, actorID, title+" "+label)
				if err != nil {
					return err
				}
				revisionID = &revision.ID
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO architecture_version_pins (version_id, document_id, revision_id) VALUES ($1, $2, $3)`,
				created, documentID, revisionID); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return ArchitectureVersion{}, err
	}
	versions, err := r.ListArchitectureVersions(ctx, workspaceID, architectureID, actorID)
	if err != nil {
		return ArchitectureVersion{}, err
	}
	for _, v := range versions {
		if v.ID == created {
			return v, nil
		}
	}
	return ArchitectureVersion{}, constant.ErrDocumentNotFound
}

func collectIDs(ctx context.Context, tx database.Queryer, query string, args ...any) ([]uuid.UUID, error) {
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func uuidArray(ids []uuid.UUID) string {
	values := make([]string, len(ids))
	for i, id := range ids {
		values[i] = id.String()
	}
	return "{" + strings.Join(values, ",") + "}"
}

// ListArchitectureVersions lists a canvas's versions, newest first, for anyone who can read it.
func (r *Repository) ListArchitectureVersions(ctx context.Context, workspaceID, architectureID, actorID uuid.UUID) ([]ArchitectureVersion, error) {
	versions := []ArchitectureVersion{}
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, architectureID, workspaceID, actorID, false, nil)
		if err != nil {
			return err
		}
		if !policy.CanReadDocument(doc, access) {
			return constant.ErrDocumentNotFound
		}
		rows, err := tx.QueryContext(ctx, `
			SELECT v.id, v.architecture_id, v.revision_id, rv.version_number, v.label, v.description, v.created_by, COALESCE(u.full_name, ''), v.created_at
			FROM architecture_versions v
			JOIN document_revisions rv ON rv.id = v.revision_id
			LEFT JOIN users u ON u.id = v.created_by
			WHERE v.architecture_id = $1
			ORDER BY v.created_at DESC, v.label
		`, architectureID)
		if err != nil {
			return err
		}
		index := map[uuid.UUID]int{}
		for rows.Next() {
			var v ArchitectureVersion
			var createdBy uuid.NullUUID
			if err := rows.Scan(&v.ID, &v.ArchitectureID, &v.RevisionID, &v.RevisionNumber, &v.Label, &v.Description, &createdBy, &v.CreatedByName, &v.CreatedAt); err != nil {
				rows.Close()
				return err
			}
			if createdBy.Valid {
				v.CreatedBy = &createdBy.UUID
			}
			v.Pins = []ArchitectureVersionPin{}
			index[v.ID] = len(versions)
			versions = append(versions, v)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		pins, err := tx.QueryContext(ctx, `
			SELECT p.version_id, p.document_id, d.title, d.type::text, p.revision_id, rv.version_number
			FROM architecture_version_pins p
			JOIN architecture_versions v ON v.id = p.version_id
			JOIN documents d ON d.id = p.document_id
			LEFT JOIN document_revisions rv ON rv.id = p.revision_id
			WHERE v.architecture_id = $1
			ORDER BY d.title
		`, architectureID)
		if err != nil {
			return err
		}
		defer pins.Close()
		for pins.Next() {
			var versionID uuid.UUID
			var pin ArchitectureVersionPin
			var revisionID uuid.NullUUID
			var number sql.NullInt64
			if err := pins.Scan(&versionID, &pin.DocumentID, &pin.Title, &pin.DocumentType, &revisionID, &number); err != nil {
				return err
			}
			if revisionID.Valid {
				pin.RevisionID = &revisionID.UUID
				n := int(number.Int64)
				pin.VersionNumber = &n
			}
			if i, ok := index[versionID]; ok {
				versions[i].Pins = append(versions[i].Pins, pin)
			}
		}
		return pins.Err()
	})
	return versions, err
}

// UpdateArchitectureVersion changes the label and description; what the version froze never changes.
func (r *Repository) UpdateArchitectureVersion(ctx context.Context, workspaceID, architectureID, versionID, actorID uuid.UUID, label, description string) error {
	if !validVersionText(label, description) {
		return constant.ErrDocumentConflict
	}
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, architectureID, workspaceID, actorID, false, nil)
		if err != nil {
			return err
		}
		if !policy.CanEditDocument(doc, access) {
			return constant.ErrForbidden
		}
		result, err := tx.ExecContext(ctx, `UPDATE architecture_versions SET label = $3, description = $4 WHERE id = $1 AND architecture_id = $2`,
			versionID, architectureID, strings.TrimSpace(label), description)
		if uniqueViolation(err) {
			return constant.ErrDocumentConflict
		}
		if err != nil {
			return err
		}
		if n, _ := result.RowsAffected(); n == 0 {
			return constant.ErrDocumentNotFound
		}
		return nil
	})
}

// DeleteArchitectureVersion removes a version; only an owner may. The named revisions it made stay as history.
func (r *Repository) DeleteArchitectureVersion(ctx context.Context, workspaceID, architectureID, versionID, actorID uuid.UUID) error {
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		_, access, err := lockDocumentAccess(ctx, tx, architectureID, workspaceID, actorID, false, nil)
		if err != nil {
			return err
		}
		if !policy.CanManageDocumentOwnership(access) {
			return constant.ErrForbidden
		}
		result, err := tx.ExecContext(ctx, `DELETE FROM architecture_versions WHERE id = $1 AND architecture_id = $2`, versionID, architectureID)
		if err != nil {
			return err
		}
		if n, _ := result.RowsAffected(); n == 0 {
			return constant.ErrDocumentNotFound
		}
		return nil
	})
}
