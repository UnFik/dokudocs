// Package agent is what the Agent may do for a User and the Dokudocs tools it does it
// with (ADR 0043, 0044). The same tools serve chat inside Dokudocs and MCP clients.
package agent

import (
	"context"
	"errors"
	"slices"

	"github.com/google/uuid"
)

// AI permissions, one per group of Dokudocs features.
const (
	CapRead      = "read"
	CapDocuments = "documents"
	CapContent   = "content"
	CapComments  = "comments"
	CapProjects  = "projects"
)

var ErrUnknownCapability = errors.New("unknown AI permission")

type Capability struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

// Catalog is every AI permission a User can allow, in display order. Actions that
// are never allowed (ADR 0044) have no entry and no tool.
var Catalog = []Capability{
	{CapRead, "Read", "Search and list workspaces, projects and documents; read documents, comments, suggestions and versions."},
	{CapDocuments, "Documents", "Create documents, change their title, tags and categories, move, duplicate, move to trash and restore."},
	{CapContent, "Document content", "Edit what a document says and save named versions."},
	{CapComments, "Comments", "Write comments and replies, resolve and reopen them."},
	{CapProjects, "Projects", "Create and change projects, their categories and members. Never delete a project."},
}

// DefaultPermissions is what a User allows before choosing.
var DefaultPermissions = []string{CapRead}

type PermissionStore interface {
	// AIPermissions returns the saved set, and false when the User never saved one.
	AIPermissions(ctx context.Context, userID uuid.UUID) ([]string, bool, error)
	SetAIPermissions(ctx context.Context, userID uuid.UUID, caps []string) error
}

type PermissionService struct{ store PermissionStore }

func NewPermissionService(store PermissionStore) *PermissionService {
	return &PermissionService{store: store}
}

func (s *PermissionService) Permissions(ctx context.Context, userID uuid.UUID) ([]string, error) {
	caps, saved, err := s.store.AIPermissions(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !saved {
		return slices.Clone(DefaultPermissions), nil
	}
	return caps, nil
}

// SetPermissions keeps the known permissions, once each, in catalog order.
func (s *PermissionService) SetPermissions(ctx context.Context, userID uuid.UUID, caps []string) ([]string, error) {
	for _, key := range caps {
		if !slices.ContainsFunc(Catalog, func(c Capability) bool { return c.Key == key }) {
			return nil, ErrUnknownCapability
		}
	}
	ordered := make([]string, 0, len(caps))
	for _, c := range Catalog {
		if slices.Contains(caps, c.Key) {
			ordered = append(ordered, c.Key)
		}
	}
	if err := s.store.SetAIPermissions(ctx, userID, ordered); err != nil {
		return nil, err
	}
	return ordered, nil
}
