package policy

import (
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

// DocumentAccessContext contains facts resolved by trusted repositories for one actor and document.
type DocumentAccessContext struct {
	UserID               uuid.UUID
	WorkspaceRole        string
	ProjectVisibility    string
	ProjectRole          string
	DocumentGrant        string
	PublicLinkTokenValid bool
}

func CanReadDocument(doc model.Document, access DocumentAccessContext) bool {
	if isTrashed(doc) {
		return false
	}
	if access.PublicLinkTokenValid {
		return doc.Visibility == "public_link" && !doc.IsDraft
	}
	if !isWorkspaceMember(access) {
		return false
	}

	canRead := isWorkspaceAdmin(access) || hasReadGrant(access.DocumentGrant)
	switch doc.Visibility {
	case "workspace":
		canRead = true
	case "inherit":
		if doc.ProjectID == nil || access.ProjectVisibility == "workspace" {
			canRead = true
		} else if access.ProjectVisibility == "private" && hasProjectReadRole(access.ProjectRole) {
			canRead = true
		}
	case "private", "public_link":
		canRead = canRead || doc.AuthorID == access.UserID
	default:
		return false
	}
	if !canRead {
		return false
	}
	if doc.IsDraft {
		return doc.AuthorID == access.UserID || isWorkspaceAdmin(access) || CanEditDocument(doc, access)
	}
	return true
}

func CanEditDocument(doc model.Document, access DocumentAccessContext) bool {
	if isTrashed(doc) || !isWorkspaceMember(access) {
		return false
	}
	if isWorkspaceAdmin(access) || access.DocumentGrant == "owner" || access.DocumentGrant == "edit" {
		return true
	}
	return (doc.Visibility == "inherit" || doc.Visibility == "workspace") &&
		doc.ProjectID != nil && hasProjectEditRole(access.ProjectRole)
}

func CanSuggest(doc model.Document, access DocumentAccessContext) bool {
	if !CanReadDocument(doc, access) {
		return false
	}
	return CanEditDocument(doc, access) || access.DocumentGrant == "comment"
}

func CanDecideSuggestion(doc model.Document, access DocumentAccessContext) bool {
	return CanEditDocument(doc, access)
}

func CanManageDocumentOwnership(access DocumentAccessContext) bool {
	return isWorkspaceAdmin(access) || access.DocumentGrant == "owner"
}

func CanPlaceDocumentInProject(projectVisibility, projectRole, workspaceRole string) bool {
	if projectVisibility == "workspace" {
		return isWorkspaceMember(DocumentAccessContext{WorkspaceRole: workspaceRole})
	}
	return projectVisibility == "private" && (isWorkspaceAdmin(DocumentAccessContext{WorkspaceRole: workspaceRole}) || hasProjectEditRole(projectRole))
}

func CanRestoreDocument(doc model.Document, access DocumentAccessContext) bool {
	return canManageTrash(doc, access)
}

func CanPermanentlyDeleteDocument(doc model.Document, access DocumentAccessContext) bool {
	return canManageTrash(doc, access)
}

func canManageTrash(doc model.Document, access DocumentAccessContext) bool {
	return isTrashed(doc) && isWorkspaceMember(access) && (isWorkspaceAdmin(access) || access.DocumentGrant == "owner")
}

func isWorkspaceMember(access DocumentAccessContext) bool {
	return access.WorkspaceRole == "owner" || access.WorkspaceRole == "admin" || access.WorkspaceRole == "member" || access.WorkspaceRole == "guest"
}

func isWorkspaceAdmin(access DocumentAccessContext) bool {
	return access.WorkspaceRole == "owner" || access.WorkspaceRole == "admin"
}

func isTrashed(doc model.Document) bool {
	return doc.DeletedAt != nil
}

func hasReadGrant(grant string) bool {
	return grant == "owner" || grant == "edit" || grant == "comment" || grant == "view"
}

func hasProjectReadRole(role string) bool {
	return role == "manager" || role == "editor" || role == "viewer"
}

func hasProjectEditRole(role string) bool {
	return role == "manager" || role == "editor"
}
