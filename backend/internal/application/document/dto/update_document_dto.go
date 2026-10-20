package dto

import "github.com/google/uuid"

type UpdateDocumentInput struct {
	ID          uuid.UUID
	WorkspaceID uuid.UUID
	UserID      uuid.UUID
	Title       string
	Content     string
	Visibility  string
	Tags        []string
	Categories  []string
	IsDraft     *bool
	ProjectID   *uuid.UUID
	// FromMCP is set only by the MCP tools; only they may change the body of an HTML document.
	FromMCP bool
	// ExpectedPageVersion, when set, makes the write of an HTML body fail with a conflict
	// unless the page still has that version (model.PageVersion).
	ExpectedPageVersion string
}
