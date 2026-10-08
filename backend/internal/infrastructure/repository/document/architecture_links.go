package document

import (
	"context"
	"encoding/json"
	"strings"

	"backend/constant"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

// canvasLinks is the part of an Architecture canvas that names documents.
type canvasLinks struct {
	Nodes []struct {
		ID    string   `json:"id"`
		Kind  string   `json:"kind"`
		Name  string   `json:"name"`
		Links []string `json:"links"`
	} `json:"nodes"`
	Connections []struct {
		ID     string   `json:"id"`
		Source string   `json:"source"`
		Target string   `json:"target"`
		Links  []string `json:"links"`
	} `json:"connections"`
}

// projectArchitectureLinks replaces the link rows of a canvas with what its JSON
// names now. Links to documents outside the workspace, or to anything but
// Markdown, DBML and Mermaid, are dropped, so a crafted update cannot plant one.
func projectArchitectureLinks(ctx context.Context, tx database.Queryer, workspaceID, architectureID uuid.UUID, content json.RawMessage) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM architecture_document_links WHERE architecture_id = $1`, architectureID); err != nil {
		return err
	}
	var canvas canvasLinks
	if json.Unmarshal(content, &canvas) != nil {
		return nil
	}
	names := map[string]string{}
	for _, n := range canvas.Nodes {
		names[n.ID] = n.Name
	}
	var elements, kinds, labels, documents []string
	add := func(element, kind, label string, links []string) {
		for _, link := range links {
			if _, err := uuid.Parse(link); err == nil {
				elements, kinds, labels, documents = append(elements, element), append(kinds, kind), append(labels, label), append(documents, link)
			}
		}
	}
	for _, n := range canvas.Nodes {
		if n.Kind == "system" {
			add(n.ID, "system", n.Name, n.Links)
		}
	}
	for _, c := range canvas.Connections {
		add(c.ID, "connection", names[c.Source]+" → "+names[c.Target], c.Links)
	}
	if len(documents) == 0 {
		return nil
	}
	_, err := tx.ExecContext(ctx, `
		INSERT INTO architecture_document_links (architecture_id, element_id, element_kind, element_name, document_id)
		SELECT $1, l.element, l.kind, l.label, d.id
		FROM unnest($3::text[], $4::text[], $5::text[], $6::uuid[]) AS l(element, kind, label, document)
		JOIN documents d ON d.id = l.document AND d.workspace_id = $2 AND d.type IN ('markdown', 'dbdiagram', 'mermaid')
		ON CONFLICT DO NOTHING
	`, architectureID, workspaceID, pgArray(elements), pgArray(kinds), pgArray(labels), pgArray(documents))
	return err
}

// ArchitectureUse is one element of a canvas that links to a document.
type ArchitectureUse struct {
	ArchitectureID uuid.UUID `json:"architectureId"`
	Title          string    `json:"title"`
	ElementID      string    `json:"elementId"`
	ElementKind    string    `json:"elementKind"`
	ElementName    string    `json:"elementName"`
}

// ArchitectureUses lists the canvases the actor may open whose elements link to documentID.
func (r *Repository) ArchitectureUses(ctx context.Context, workspaceID, documentID, actorID uuid.UUID) ([]ArchitectureUse, error) {
	found := []ArchitectureUse{}
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, documentID, workspaceID, actorID, false, nil)
		if err != nil {
			return err
		}
		if !policy.CanReadDocument(doc, access) {
			return constant.ErrDocumentNotFound
		}
		rows, err := tx.QueryContext(ctx, `
			SELECT d.id, d.title, l.element_id, l.element_kind, l.element_name
			FROM architecture_document_links l
			JOIN documents d ON d.id = l.architecture_id
			WHERE d.workspace_id = $1 AND l.document_id = $3 AND d.deleted_at IS NULL
		`+documentReadPredicate+`
			ORDER BY d.title, l.element_name
			LIMIT 200
		`, workspaceID, actorID, documentID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var use ArchitectureUse
			if err := rows.Scan(&use.ArchitectureID, &use.Title, &use.ElementID, &use.ElementKind, &use.ElementName); err != nil {
				return err
			}
			found = append(found, use)
		}
		return rows.Err()
	})
	return found, err
}

// pgArray writes a PostgreSQL array literal with every element quoted, so names
// holding commas, quotes or braces stay whole.
func pgArray(values []string) string {
	quoted := make([]string, len(values))
	for i, v := range values {
		quoted[i] = `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(v) + `"`
	}
	return "{" + strings.Join(quoted, ",") + "}"
}
