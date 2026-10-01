// Package ownergrants audits and repairs document owner grants.
//
// Every document needs an owner grant (Gate G0). Rows created before that rule
// may have none. The backfill rule is: keep an existing owner; otherwise the
// document's author becomes owner. An author who is no longer a workspace
// member is not repaired automatically: an owner grant for a non-member does
// nothing, so someone has to decide who owns the document.
package ownergrants

import (
	"context"
	"fmt"
	"strings"

	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

// Resolution says how a document without an owner would be repaired.
type Resolution string

const (
	// GrantToAuthor inserts an owner grant for the author, who has no grant.
	GrantToAuthor Resolution = "grant-to-author"
	// PromoteAuthor raises the author's existing non-owner grant to owner.
	PromoteAuthor Resolution = "promote-author"
	// BlockedAuthorNotMember leaves the document alone because its author is no
	// longer a member of the workspace.
	BlockedAuthorNotMember Resolution = "blocked-author-not-member"
)

// Fixable reports whether Reconcile will change documents with this resolution.
func (r Resolution) Fixable() bool { return r == GrantToAuthor || r == PromoteAuthor }

// Scope limits an audit or reconcile to some workspaces; empty means all.
type Scope struct {
	WorkspaceIDs []uuid.UUID
}

// Finding is one document that needs attention.
type Finding struct {
	DocumentID  uuid.UUID  `json:"documentID"`
	WorkspaceID uuid.UUID  `json:"workspaceID"`
	Type        string     `json:"type"`
	AuthorID    uuid.UUID  `json:"authorID"`
	Trashed     bool       `json:"trashed"`
	Owners      int        `json:"owners"`
	Resolution  Resolution `json:"resolution,omitempty"`
}

// Report is the ownership state of the documents in scope.
type Report struct {
	Documents int `json:"documents"`
	Trashed   int `json:"trashed"`
	// WithoutOwner lists documents with no owner grant, each with the repair
	// Reconcile would apply.
	WithoutOwner []Finding `json:"withoutOwner"`
	// MultipleOwners lists documents with more than one owner grant. They are
	// reported only; which owner to keep is a product decision.
	MultipleOwners []Finding `json:"multipleOwners"`
	// OwnerIsNotAuthor counts documents with an owner grant held by someone other
	// than the author (ownership was transferred or shared).
	OwnerIsNotAuthor int `json:"ownerIsNotAuthor"`
}

// Fixable counts the documents Reconcile would change.
func (r Report) Fixable() int {
	count := 0
	for _, finding := range r.WithoutOwner {
		if finding.Resolution.Fixable() {
			count++
		}
	}
	return count
}

// Blocked counts the documents that need a decision before they can be fixed.
func (r Report) Blocked() int { return len(r.WithoutOwner) - r.Fixable() }

func scopeFilter(scope Scope, args *[]any) string {
	if len(scope.WorkspaceIDs) == 0 {
		return ""
	}
	ids := make([]string, len(scope.WorkspaceIDs))
	for i, id := range scope.WorkspaceIDs {
		ids[i] = id.String()
	}
	*args = append(*args, ids)
	return fmt.Sprintf("WHERE d.workspace_id = ANY($%d::uuid[])", len(*args))
}

// Audit reads ownership state without changing anything.
func Audit(ctx context.Context, q database.Queryer, scope Scope) (Report, error) {
	var args []any
	filter := scopeFilter(scope, &args)
	rows, err := q.QueryContext(ctx, strings.Join([]string{`
		SELECT d.id, d.workspace_id, d.type::text, d.author_id, d.deleted_at IS NOT NULL,
		       (SELECT COUNT(*) FROM document_accesses a WHERE a.document_id = d.id AND a.access_level = 'owner'),
		       (SELECT COUNT(*) FROM document_accesses a WHERE a.document_id = d.id AND a.access_level = 'owner' AND a.user_id <> d.author_id),
		       COALESCE((SELECT a.access_level::text FROM document_accesses a WHERE a.document_id = d.id AND a.user_id = d.author_id), ''),
		       EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = d.workspace_id AND m.user_id = d.author_id)
		FROM documents d`, filter, `ORDER BY d.id`}, "\n"), args...)
	if err != nil {
		return Report{}, err
	}
	defer rows.Close()

	report := Report{WithoutOwner: []Finding{}, MultipleOwners: []Finding{}}
	for rows.Next() {
		var finding Finding
		var otherOwners int
		var authorGrant string
		var authorIsMember bool
		if err := rows.Scan(&finding.DocumentID, &finding.WorkspaceID, &finding.Type, &finding.AuthorID,
			&finding.Trashed, &finding.Owners, &otherOwners, &authorGrant, &authorIsMember); err != nil {
			return Report{}, err
		}
		report.Documents++
		if finding.Trashed {
			report.Trashed++
		}
		if otherOwners > 0 {
			report.OwnerIsNotAuthor++
		}
		switch {
		case finding.Owners == 0:
			switch {
			case !authorIsMember:
				finding.Resolution = BlockedAuthorNotMember
			case authorGrant != "":
				finding.Resolution = PromoteAuthor
			default:
				finding.Resolution = GrantToAuthor
			}
			report.WithoutOwner = append(report.WithoutOwner, finding)
		case finding.Owners > 1:
			report.MultipleOwners = append(report.MultipleOwners, finding)
		}
	}
	return report, rows.Err()
}

// Result is the outcome of Reconcile.
type Result struct {
	// Applied is true when changes were committed; false for a dry run.
	Applied bool `json:"applied"`
	// Before is the state the repairs were planned from.
	Before Report `json:"before"`
	// After is the state once the repairs were applied (equal to Before for a
	// dry run).
	After Report `json:"after"`
	// Fixed is the number of documents that gained an owner.
	Fixed int `json:"fixed"`
}

// Reconcile plans the repairs for documents without an owner and, only when
// apply is true, commits them in one transaction. A dry run changes nothing.
//
// Each repair makes the author the owner: an author with no grant gets an owner
// grant, an author with a lesser grant is promoted. Other users' grants are
// kept. Documents whose author left the workspace, and documents with several
// owners, are reported and left alone. The transaction takes the document rows
// FOR UPDATE first, in ID order, as the access lock contract requires, plans
// again from that locked state, and rolls back if anything fixable remains.
func Reconcile(ctx context.Context, db database.DB, scope Scope, apply bool) (Result, error) {
	before, err := Audit(ctx, db, scope)
	if err != nil {
		return Result{}, err
	}
	if !apply {
		return Result{Before: before, After: before}, nil
	}

	result := Result{}
	err = db.WithTransaction(ctx, func(tx database.Queryer) error {
		candidates, err := Audit(ctx, tx, scope)
		if err != nil {
			return err
		}
		ids := make([]string, 0, candidates.Fixable())
		for _, finding := range candidates.WithoutOwner {
			if finding.Resolution.Fixable() {
				ids = append(ids, finding.DocumentID.String())
			}
		}
		result.Before = candidates
		if len(ids) > 0 {
			if _, err := tx.ExecContext(ctx, `
				SELECT id FROM documents WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE
			`, ids); err != nil {
				return err
			}
			// Plan again now that the rows are locked.
			locked, err := Audit(ctx, tx, scope)
			if err != nil {
				return err
			}
			ids = ids[:0]
			for _, finding := range locked.WithoutOwner {
				if finding.Resolution.Fixable() {
					ids = append(ids, finding.DocumentID.String())
				}
			}
			result.Before = locked
			res, err := tx.ExecContext(ctx, `
				INSERT INTO document_accesses (document_id, user_id, access_level)
				SELECT d.id, d.author_id, 'owner'::document_access_level FROM documents d WHERE d.id = ANY($1::uuid[])
				ON CONFLICT (document_id, user_id) DO UPDATE SET access_level = 'owner'
			`, ids)
			if err != nil {
				return err
			}
			fixed, err := res.RowsAffected()
			if err != nil {
				return err
			}
			result.Fixed = int(fixed)
		}
		after, err := Audit(ctx, tx, scope)
		if err != nil {
			return err
		}
		if after.Fixable() != 0 {
			return fmt.Errorf("owner grant reconcile left %d fixable documents without an owner", after.Fixable())
		}
		result.After = after
		return nil
	})
	if err != nil {
		return Result{}, err
	}
	result.Applied = true
	return result, nil
}
