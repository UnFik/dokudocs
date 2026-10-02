package usecase

import (
	"context"
	"errors"
	"testing"

	"backend/constant"
	"backend/internal/domain/contract/repository"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

type readDocumentRepositoryStub struct {
	repository.DocumentRepository
	doc              model.Document
	documents        []model.Document
	listWorkspaceID  uuid.UUID
	listUserID       uuid.UUID
	listFilter       repository.DocumentFilter
	listCalls        int
	shareToken       string
	shareCalls       int
	shareErr         error
	viewDocumentID   uuid.UUID
	viewWorkspaceID  uuid.UUID
	viewUserID       uuid.UUID
	viewErr          error
	starDocumentID   uuid.UUID
	starWorkspaceID  uuid.UUID
	starUserID       uuid.UUID
	starred          bool
	starErr          error
	duplicateDoc     model.Document
	duplicateDocID   uuid.UUID
	duplicateWSID    uuid.UUID
	duplicateActor   uuid.UUID
	duplicateRequest uuid.UUID
	duplicateErr     error
	trash            []model.TrashItem
	trashWorkspaceID uuid.UUID
	trashUserID      uuid.UUID
	trashCalls       int
	trashErr         error
}

func (r *readDocumentRepositoryStub) List(_ context.Context, workspaceID, userID uuid.UUID, filter repository.DocumentFilter) ([]model.Document, error) {
	r.listCalls++
	r.listWorkspaceID = workspaceID
	r.listUserID = userID
	r.listFilter = filter
	return r.documents, nil
}

func (r *readDocumentRepositoryStub) ListTrash(_ context.Context, workspaceID, userID uuid.UUID) ([]model.TrashItem, error) {
	r.trashCalls++
	r.trashWorkspaceID, r.trashUserID = workspaceID, userID
	return r.trash, r.trashErr
}

func (r *readDocumentRepositoryStub) GetByShareToken(_ context.Context, token string) (model.Document, error) {
	r.shareCalls++
	r.shareToken = token
	return r.doc, r.shareErr
}

func (r *readDocumentRepositoryStub) RecordView(_ context.Context, docID, workspaceID, userID uuid.UUID) error {
	r.viewDocumentID, r.viewWorkspaceID, r.viewUserID = docID, workspaceID, userID
	return r.viewErr
}

func (r *readDocumentRepositoryStub) ToggleStar(_ context.Context, docID, workspaceID, userID uuid.UUID) (bool, error) {
	r.starDocumentID, r.starWorkspaceID, r.starUserID = docID, workspaceID, userID
	return r.starred, r.starErr
}

func (r *readDocumentRepositoryStub) DuplicateAuthorized(_ context.Context, docID, workspaceID, actorID, requestID uuid.UUID) (model.Document, error) {
	r.duplicateDocID, r.duplicateWSID, r.duplicateActor = docID, workspaceID, actorID
	r.duplicateRequest = requestID
	return r.duplicateDoc, r.duplicateErr
}

type workspaceReadStub struct {
	repository.WorkspaceRepository
	role string
	err  error
}

func (r workspaceReadStub) GetUserRole(context.Context, uuid.UUID, uuid.UUID) (string, error) {
	return r.role, r.err
}

func TestListDocumentsRequiresMembershipAndPassesScope(t *testing.T) {
	ctx := context.Background()
	workspaceID, userID := uuid.New(), uuid.New()
	filter := repository.DocumentFilter{Search: "needle", SortField: "title", SortOrder: "asc"}

	t.Run("denies nonmember before querying documents", func(t *testing.T) {
		docRepo := &readDocumentRepositoryStub{}
		uc := NewUseCaseWithRepos(docRepo, workspaceReadStub{err: errors.New("not a member")}, nil, nil)

		if _, err := uc.ListDocuments(ctx, workspaceID, userID, filter); !errors.Is(err, constant.ErrForbidden) {
			t.Fatalf("ListDocuments() error = %v, want %v", err, constant.ErrForbidden)
		}
		if docRepo.listCalls != 0 {
			t.Fatalf("List() calls = %d, want 0 for nonmember", docRepo.listCalls)
		}
	})

	t.Run("passes workspace actor and filters", func(t *testing.T) {
		want := []model.Document{{ID: uuid.New()}}
		docRepo := &readDocumentRepositoryStub{documents: want}
		uc := NewUseCaseWithRepos(docRepo, workspaceReadStub{role: "member"}, nil, nil)

		got, err := uc.ListDocuments(ctx, workspaceID, userID, filter)
		if err != nil {
			t.Fatalf("ListDocuments() error = %v, want nil", err)
		}
		if len(got) != 1 || got[0].ID != want[0].ID {
			t.Fatalf("ListDocuments() = %#v, want %#v", got, want)
		}
		if docRepo.listCalls != 1 || docRepo.listWorkspaceID != workspaceID || docRepo.listUserID != userID || docRepo.listFilter != filter {
			t.Fatalf("List() received (%d calls, %s, %s, %#v), want (1, %s, %s, %#v)", docRepo.listCalls, docRepo.listWorkspaceID, docRepo.listUserID, docRepo.listFilter, workspaceID, userID, filter)
		}
	})
}

func TestListTrashRequiresMembershipAndPassesActor(t *testing.T) {
	ctx := context.Background()
	workspaceID, userID := uuid.New(), uuid.New()
	want := []model.TrashItem{{DocID: uuid.New()}}
	docRepo := &readDocumentRepositoryStub{trash: want}
	uc := NewUseCaseWithRepos(docRepo, workspaceReadStub{role: "member"}, nil, nil)

	got, err := uc.ListTrash(ctx, workspaceID, userID)
	if err != nil || len(got) != 1 || got[0].DocID != want[0].DocID {
		t.Fatalf("ListTrash() = (%#v, %v), want (%#v, nil)", got, err, want)
	}
	if docRepo.trashCalls != 1 || docRepo.trashWorkspaceID != workspaceID || docRepo.trashUserID != userID {
		t.Fatalf("ListTrash() forwarded (%d calls, %s, %s), want (1, %s, %s)", docRepo.trashCalls, docRepo.trashWorkspaceID, docRepo.trashUserID, workspaceID, userID)
	}
}

func TestGetPublicDocumentValidatesTokenAndReturnedDocument(t *testing.T) {
	ctx := context.Background()
	for _, tc := range []struct {
		name       string
		token      string
		doc        model.Document
		wantErr    error
		wantCalls  int
		wantLookup string
	}{
		{name: "empty token", token: " \t ", wantErr: constant.ErrDocumentNotFound},
		{name: "draft is hidden", token: " secret ", doc: model.Document{ID: uuid.New(), Visibility: "public_link", IsDraft: true}, wantErr: constant.ErrDocumentNotFound, wantCalls: 1, wantLookup: "secret"},
		{name: "nonpublic document is hidden", token: " secret ", doc: model.Document{ID: uuid.New(), Visibility: "workspace"}, wantErr: constant.ErrDocumentNotFound, wantCalls: 1, wantLookup: "secret"},
		{name: "valid public document", token: " secret ", doc: model.Document{ID: uuid.New(), Visibility: "public_link"}, wantCalls: 1, wantLookup: "secret"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			docRepo := &readDocumentRepositoryStub{doc: tc.doc}
			uc := NewUseCaseWithRepos(docRepo, nil, nil, nil)

			got, err := uc.GetPublicDocument(ctx, tc.token)
			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("GetPublicDocument() error = %v, want %v", err, tc.wantErr)
				}
				if got.ID != uuid.Nil {
					t.Fatalf("GetPublicDocument() leaked document ID %s", got.ID)
				}
			} else if err != nil || got.ID != tc.doc.ID {
				t.Fatalf("GetPublicDocument() = (%s, %v), want (%s, nil)", got.ID, err, tc.doc.ID)
			}
			if docRepo.shareCalls != tc.wantCalls || docRepo.shareToken != tc.wantLookup {
				t.Fatalf("repository lookup = (%d calls, %q), want (%d calls, %q)", docRepo.shareCalls, docRepo.shareToken, tc.wantCalls, tc.wantLookup)
			}
		})
	}
}

func TestDocumentMetadataUsecasesDelegateScopedAuthorizationToRepository(t *testing.T) {
	ctx := context.Background()
	docID, workspaceID, userID := uuid.New(), uuid.New(), uuid.New()
	denied := constant.ErrDocumentNotFound
	docRepo := &readDocumentRepositoryStub{viewErr: denied, starErr: denied}
	uc := NewUseCaseWithRepos(docRepo, nil, nil, nil)

	if err := uc.RecordView(ctx, docID, workspaceID, userID); !errors.Is(err, denied) {
		t.Fatalf("RecordView() error = %v, want %v", err, denied)
	}
	if docRepo.viewDocumentID != docID || docRepo.viewWorkspaceID != workspaceID || docRepo.viewUserID != userID {
		t.Fatalf("RecordView() forwarded (%s, %s, %s), want (%s, %s, %s)", docRepo.viewDocumentID, docRepo.viewWorkspaceID, docRepo.viewUserID, docID, workspaceID, userID)
	}

	if starred, err := uc.ToggleStar(ctx, docID, workspaceID, userID); !errors.Is(err, denied) || starred {
		t.Fatalf("ToggleStar() = (%t, %v), want (false, %v)", starred, err, denied)
	}
	if docRepo.starDocumentID != docID || docRepo.starWorkspaceID != workspaceID || docRepo.starUserID != userID {
		t.Fatalf("ToggleStar() forwarded (%s, %s, %s), want (%s, %s, %s)", docRepo.starDocumentID, docRepo.starWorkspaceID, docRepo.starUserID, docID, workspaceID, userID)
	}
}

func TestDuplicateUsecaseDelegatesAuthorizationAndCopyToRepository(t *testing.T) {
	ctx := context.Background()
	docID, workspaceID, actorID, requestID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	want := model.Document{ID: uuid.New(), Title: "Copy of source", AuthorID: actorID}
	docRepo := &readDocumentRepositoryStub{duplicateDoc: want}
	uc := NewUseCaseWithRepos(docRepo, nil, nil, nil)

	got, err := uc.DuplicateDocument(ctx, docID, workspaceID, actorID, requestID)
	if err != nil {
		t.Fatalf("DuplicateDocument() error = %v, want nil", err)
	}
	if got.ID != want.ID || docRepo.duplicateDocID != docID || docRepo.duplicateWSID != workspaceID || docRepo.duplicateActor != actorID || docRepo.duplicateRequest != requestID {
		t.Fatalf("duplicate result/scope/request = (%s, %s, %s, %s, %s), want (%s, %s, %s, %s, %s)", got.ID, docRepo.duplicateDocID, docRepo.duplicateWSID, docRepo.duplicateActor, docRepo.duplicateRequest, want.ID, docID, workspaceID, actorID, requestID)
	}
}
