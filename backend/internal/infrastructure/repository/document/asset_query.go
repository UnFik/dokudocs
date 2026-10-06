package document

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"backend/constant"
	"backend/internal/application/asset"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

// AssetRepository stores uploaded files; it shares the document repository's connection.
type AssetRepository struct{ *Repository }

func NewAssetRepository(r *Repository) *AssetRepository { return &AssetRepository{r} }

var _ asset.Repository = (*AssetRepository)(nil)

func (r *AssetRepository) Create(ctx context.Context, record asset.Asset, actorID uuid.UUID) error {
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, record.DocumentID, record.WorkspaceID, actorID, false, nil)
		if err != nil {
			return err
		}
		if !policy.CanEditDocument(doc, access) {
			if !policy.CanReadDocument(doc, access) {
				return constant.ErrDocumentNotFound
			}
			return constant.ErrForbidden
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO document_assets (id, document_id, workspace_id, uploaded_by, file_name, content_type, size_bytes, sha256, store_key)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		`, record.ID, record.DocumentID, record.WorkspaceID, actorID, record.FileName, record.ContentType, record.SizeBytes, record.SHA256, record.StoreKey)
		return err
	})
}

const assetColumns = `a.id, a.document_id, a.workspace_id, a.file_name, a.content_type, a.size_bytes, a.sha256, a.store_key, a.created_at`

func scanAsset(row interface{ Scan(...any) error }) (asset.Asset, error) {
	var found asset.Asset
	err := row.Scan(&found.ID, &found.DocumentID, &found.WorkspaceID, &found.FileName, &found.ContentType, &found.SizeBytes, &found.SHA256, &found.StoreKey, &found.CreatedAt)
	return found, err
}

func (r *AssetRepository) ForRead(ctx context.Context, workspaceID, documentID, assetID, actorID uuid.UUID) (asset.Asset, error) {
	var found asset.Asset
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, documentID, workspaceID, actorID, false, nil)
		if err != nil {
			return err
		}
		if !policy.CanReadDocument(doc, access) {
			return constant.ErrDocumentNotFound
		}
		found, err = scanAsset(tx.QueryRowContext(ctx, `
			SELECT `+assetColumns+` FROM document_assets a WHERE a.id = $1 AND a.document_id = $2
		`, assetID, documentID))
		if errors.Is(err, sql.ErrNoRows) {
			return asset.ErrNotFound
		}
		return err
	})
	return found, err
}

func (r *AssetRepository) ForPublicLink(ctx context.Context, shareToken string, assetID uuid.UUID) (asset.Asset, error) {
	found, err := scanAsset(r.db.QueryRowContext(ctx, `
		SELECT `+assetColumns+`
		FROM document_assets a
		JOIN documents d ON d.id = a.document_id
		WHERE a.id = $1 AND d.share_token = $2
		  AND d.visibility = 'public_link' AND d.is_draft = FALSE AND d.deleted_at IS NULL
	`, assetID, shareToken))
	if errors.Is(err, sql.ErrNoRows) {
		return found, asset.ErrNotFound
	}
	return found, err
}

// Orphans are files older than `olderThan` whose ID is nowhere in their
// document's JSON or in any of its revisions.
func (r *AssetRepository) Orphans(ctx context.Context, olderThan time.Duration) ([]asset.Asset, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT `+assetColumns+`
		FROM document_assets a
		JOIN documents d ON d.id = a.document_id
		WHERE a.created_at < NOW() - make_interval(secs => $1)
		  AND COALESCE(strpos(d.content_json::text, a.id::text), 0) = 0
		  AND NOT EXISTS (
		      SELECT 1 FROM document_revisions v
		      WHERE v.document_id = a.document_id AND strpos(COALESCE(v.content_json::text, ''), a.id::text) > 0
		  )
	`, olderThan.Seconds())
	if err != nil {
		return nil, fmt.Errorf("find orphan assets: %w", err)
	}
	defer rows.Close()
	var orphans []asset.Asset
	for rows.Next() {
		found, err := scanAsset(rows)
		if err != nil {
			return nil, err
		}
		orphans = append(orphans, found)
	}
	return orphans, rows.Err()
}

func (r *AssetRepository) Remove(ctx context.Context, assetID uuid.UUID) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM document_assets WHERE id = $1`, assetID)
	return err
}
