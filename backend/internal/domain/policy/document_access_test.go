package policy

import (
	"testing"
	"time"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func TestCanReadDocument(t *testing.T) {
	userID := uuid.New()
	projectID := uuid.New()
	base := model.Document{ID: uuid.New(), WorkspaceID: uuid.New(), AuthorID: uuid.New(), Visibility: "private"}
	member := DocumentAccessContext{UserID: userID, WorkspaceRole: "member"}

	tests := []struct {
		name   string
		doc    model.Document
		access DocumentAccessContext
		want   bool
	}{
		{name: "workspace visibility requires membership", doc: withVisibility(base, "workspace"), want: false},
		{name: "workspace member reads workspace visibility", doc: withVisibility(base, "workspace"), access: member, want: true},
		{name: "workspace owner reads private document", doc: base, access: DocumentAccessContext{UserID: userID, WorkspaceRole: "owner"}, want: true},
		{name: "workspace admin reads private draft", doc: withDraft(base), access: DocumentAccessContext{UserID: userID, WorkspaceRole: "admin"}, want: true},
		{name: "public link visibility alone does not grant workspace access", doc: withVisibility(base, "public_link"), access: member, want: false},
		{name: "direct grant reads public link document internally", doc: withVisibility(base, "public_link"), access: withGrant(member, "view"), want: true},
		{name: "direct grant still requires workspace membership", doc: base, access: withGrant(DocumentAccessContext{UserID: userID}, "view"), want: false},
		{name: "workspace visibility overrides private project", doc: withProject(withVisibility(base, "workspace"), projectID), access: withProjectAccess(member, "private", ""), want: true},
		{name: "inherit without project is workspace readable", doc: withVisibility(base, "inherit"), access: member, want: true},
		{name: "inherited private project member reads", doc: withProject(withVisibility(base, "inherit"), projectID), access: withProjectAccess(member, "private", "viewer"), want: true},
		{name: "inherited private project hides from nonmember", doc: withProject(withVisibility(base, "inherit"), projectID), access: withProjectAccess(member, "private", ""), want: false},
		{name: "author without private project membership cannot read inherited document", doc: withProject(withVisibility(withAuthor(base, userID), "inherit"), projectID), access: withProjectAccess(member, "private", ""), want: false},
		{name: "explicit private ignores project membership", doc: withProject(base, projectID), access: withProjectAccess(member, "private", "editor"), want: false},
		{name: "direct view grant reads private document", doc: base, access: withGrant(member, "view"), want: true},
		{name: "comment grant cannot read draft", doc: withDraft(base), access: withGrant(member, "comment"), want: false},
		{name: "edit grant reads draft", doc: withDraft(base), access: withGrant(member, "edit"), want: true},
		{name: "author reads own private document", doc: withAuthor(base, userID), access: member, want: true},
		{name: "author reads own draft", doc: withDraft(withAuthor(base, userID)), access: member, want: true},
		{name: "valid public token reads public document without membership", doc: withVisibility(base, "public_link"), access: DocumentAccessContext{UserID: userID, PublicLinkTokenValid: true}, want: true},
		{name: "public token cannot read draft", doc: withDraft(withVisibility(base, "public_link")), access: DocumentAccessContext{UserID: userID, PublicLinkTokenValid: true}, want: false},
		{name: "public token cannot read private document", doc: base, access: DocumentAccessContext{UserID: userID, PublicLinkTokenValid: true}, want: false},
		{name: "trash excludes ordinary read", doc: withDeleted(base), access: member, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := CanReadDocument(tt.doc, tt.access); got != tt.want {
				t.Fatalf("CanReadDocument() = %t, want %t", got, tt.want)
			}
		})
	}
}

func TestCanEditDocumentRequiresEffectiveEditRole(t *testing.T) {
	userID := uuid.New()
	projectID := uuid.New()
	base := model.Document{ID: uuid.New(), WorkspaceID: uuid.New(), AuthorID: userID, Visibility: "workspace"}
	member := DocumentAccessContext{UserID: userID, WorkspaceRole: "member"}
	tests := []struct {
		name   string
		doc    model.Document
		access DocumentAccessContext
		want   bool
	}{
		{name: "author is not an implicit editor", doc: base, access: member, want: false},
		{name: "view grant cannot edit", doc: base, access: withGrant(member, "view"), want: false},
		{name: "comment grant cannot edit", doc: base, access: withGrant(member, "comment"), want: false},
		{name: "edit grant edits", doc: base, access: withGrant(member, "edit"), want: true},
		{name: "owner grant edits", doc: base, access: withGrant(member, "owner"), want: true},
		{name: "workspace admin edits", doc: base, access: DocumentAccessContext{UserID: userID, WorkspaceRole: "admin"}, want: true},
		{name: "project viewer cannot edit", doc: withProject(base, projectID), access: withProjectAccess(member, "private", "viewer"), want: false},
		{name: "project editor edits inherited document", doc: withProject(withVisibility(base, "inherit"), projectID), access: withProjectAccess(member, "private", "editor"), want: true},
		{name: "project editor cannot edit explicit private document", doc: withProject(withVisibility(base, "private"), projectID), access: withProjectAccess(member, "private", "editor"), want: false},
		{name: "trash blocks edit", doc: withDeleted(base), access: withGrant(member, "edit"), want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := CanEditDocument(tt.doc, tt.access); got != tt.want {
				t.Fatalf("CanEditDocument() = %t, want %t", got, tt.want)
			}
		})
	}
}

func TestCanPlaceDocumentInProject(t *testing.T) {
	tests := []struct {
		name, visibility, projectRole, workspaceRole string
		want                                         bool
	}{
		{name: "workspace project accepts member", visibility: "workspace", workspaceRole: "member", want: true},
		{name: "private project accepts editor", visibility: "private", projectRole: "editor", workspaceRole: "member", want: true},
		{name: "private project accepts manager", visibility: "private", projectRole: "manager", workspaceRole: "member", want: true},
		{name: "private project rejects viewer", visibility: "private", projectRole: "viewer", workspaceRole: "member"},
		{name: "workspace admin can place in private project", visibility: "private", workspaceRole: "admin", want: true},
		{name: "private project rejects nonmember", visibility: "private", workspaceRole: "member"},
		{name: "unknown visibility rejects placement", visibility: "unknown", projectRole: "manager", workspaceRole: "member"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := CanPlaceDocumentInProject(tt.visibility, tt.projectRole, tt.workspaceRole); got != tt.want {
				t.Fatalf("CanPlaceDocumentInProject() = %t, want %t", got, tt.want)
			}
		})
	}
}

func TestSuggestionPermissions(t *testing.T) {
	userID := uuid.New()
	doc := model.Document{ID: uuid.New(), WorkspaceID: uuid.New(), Visibility: "workspace"}
	member := DocumentAccessContext{UserID: userID, WorkspaceRole: "member"}
	if !CanSuggest(doc, withGrant(member, "comment")) {
		t.Fatal("CanSuggest() denied a comment grant")
	}
	if CanSuggest(doc, withGrant(member, "view")) {
		t.Fatal("CanSuggest() allowed a view-only grant")
	}
	if CanDecideSuggestion(doc, withGrant(member, "comment")) {
		t.Fatal("CanDecideSuggestion() allowed a comment-only grant")
	}
	if !CanDecideSuggestion(doc, withGrant(member, "edit")) {
		t.Fatal("CanDecideSuggestion() denied an edit grant")
	}
	if CanSuggest(withDraft(doc), withGrant(member, "comment")) {
		t.Fatal("CanSuggest() allowed a commenter to read/suggest on a draft")
	}
}

func TestTrashPermissionsRequireDocumentOwnerOrWorkspaceAdmin(t *testing.T) {
	userID := uuid.New()
	doc := withDeleted(model.Document{ID: uuid.New(), WorkspaceID: uuid.New(), AuthorID: userID})
	tests := []struct {
		name   string
		access DocumentAccessContext
		want   bool
	}{
		{name: "author without owner grant", access: DocumentAccessContext{UserID: userID, WorkspaceRole: "member"}},
		{name: "edit grant is insufficient", access: withGrant(DocumentAccessContext{UserID: userID, WorkspaceRole: "member"}, "edit")},
		{name: "document owner can restore", access: withGrant(DocumentAccessContext{UserID: userID, WorkspaceRole: "member"}, "owner"), want: true},
		{name: "workspace admin can restore", access: DocumentAccessContext{UserID: userID, WorkspaceRole: "admin"}, want: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := CanRestoreDocument(doc, tt.access); got != tt.want {
				t.Fatalf("CanRestoreDocument() = %t, want %t", got, tt.want)
			}
			if got := CanPermanentlyDeleteDocument(doc, tt.access); got != tt.want {
				t.Fatalf("CanPermanentlyDeleteDocument() = %t, want %t", got, tt.want)
			}
		})
	}
}

func withVisibility(doc model.Document, visibility string) model.Document {
	doc.Visibility = visibility
	return doc
}

func withProject(doc model.Document, projectID uuid.UUID) model.Document {
	doc.ProjectID = &projectID
	return doc
}

func withAuthor(doc model.Document, authorID uuid.UUID) model.Document {
	doc.AuthorID = authorID
	return doc
}

func withDraft(doc model.Document) model.Document {
	doc.IsDraft = true
	return doc
}

func withDeleted(doc model.Document) model.Document {
	now := time.Now()
	doc.DeletedAt = &now
	return doc
}

func withGrant(access DocumentAccessContext, grant string) DocumentAccessContext {
	access.DocumentGrant = grant
	return access
}

func withProjectAccess(access DocumentAccessContext, visibility, role string) DocumentAccessContext {
	access.ProjectVisibility = visibility
	access.ProjectRole = role
	return access
}
