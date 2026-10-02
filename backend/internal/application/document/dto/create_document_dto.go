package dto

import (
	"backend/internal/domain/documentbody"

	"github.com/google/uuid"
)

type CreateDocumentInput struct {
	WorkspaceID       uuid.UUID
	UserID            uuid.UUID
	RequestID         uuid.UUID
	DocumentID        uuid.UUID
	Title             string
	Type              string
	Content           string
	InitialBody       *documentbody.Body
	BodySchemaVersion int
	Visibility        string
	Tags              []string
	Categories        []string
	IsDraft           bool
	ProjectID         *uuid.UUID
}
