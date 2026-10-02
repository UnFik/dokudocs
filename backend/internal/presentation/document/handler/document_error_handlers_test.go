package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"backend/constant"
	authdto "backend/internal/application/auth/dto"
	documentdto "backend/internal/application/document/dto"
	"backend/internal/domain/contract/repository"
	usecasecontract "backend/internal/domain/contract/usecase"
	"backend/internal/domain/model"
	"backend/internal/presentation/middleware"

	"github.com/google/uuid"
)

type documentErrorServiceStub struct {
	usecasecontract.DocumentUseCase
	err error
}

func (s documentErrorServiceStub) MoveDocument(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, *uuid.UUID) error {
	return s.err
}

func (s documentErrorServiceStub) RestoreDocument(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error {
	return s.err
}

func (s documentErrorServiceStub) PermanentDelete(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error {
	return s.err
}

func (s documentErrorServiceStub) RecordView(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error {
	return s.err
}

func (s documentErrorServiceStub) UpdateThumbnails(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string, string, string, string) error {
	return s.err
}

func (s documentErrorServiceStub) ListDocuments(context.Context, uuid.UUID, uuid.UUID, repository.DocumentFilter) ([]model.Document, error) {
	return nil, s.err
}

func (s documentErrorServiceStub) ListTrash(context.Context, uuid.UUID, uuid.UUID) ([]model.TrashItem, error) {
	return nil, s.err
}

func (s documentErrorServiceStub) ListAccesses(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) ([]model.DocumentAccess, error) {
	return nil, s.err
}

func (s documentErrorServiceStub) ToggleStar(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (bool, error) {
	return false, s.err
}

func (s documentErrorServiceStub) CreateShareToken(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (string, error) {
	return "", s.err
}

func (s documentErrorServiceStub) DuplicateDocument(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) (model.Document, error) {
	return model.Document{}, s.err
}

func (s documentErrorServiceStub) CreateDocument(context.Context, documentdto.CreateDocumentInput) (model.Document, error) {
	return model.Document{}, s.err
}

func (s documentErrorServiceStub) GetDocument(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (model.Document, error) {
	return model.Document{}, s.err
}

func (s documentErrorServiceStub) GetPublicDocument(context.Context, string) (model.Document, error) {
	return model.Document{}, s.err
}

func (s documentErrorServiceStub) UpdateDocument(context.Context, documentdto.UpdateDocumentInput) (model.Document, error) {
	return model.Document{}, s.err
}

func (s documentErrorServiceStub) MoveToTrash(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error {
	return s.err
}

func (s documentErrorServiceStub) AddOrUpdateAccess(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string, string) error {
	return s.err
}

func (s documentErrorServiceStub) RemoveAccess(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) error {
	return s.err
}

func (s documentErrorServiceStub) EmptyTrash(context.Context, uuid.UUID, uuid.UUID) error {
	return s.err
}

type documentErrorWorkspaceStub struct {
	usecasecontract.WorkspaceUseCase
}

func (documentErrorWorkspaceStub) GetUserRole(context.Context, uuid.UUID, uuid.UUID) (string, error) {
	return "member", nil
}

func TestDocumentHandlersMapDomainErrors(t *testing.T) {
	userID, workspaceID, docID := uuid.New(), uuid.New(), uuid.New()
	tests := []struct {
		name       string
		serviceErr error
		wantStatus int
		invoke     func(*Handler, http.ResponseWriter, *http.Request)
		body       string
		key        string
	}{
		{
			name:       "move forbidden",
			serviceErr: constant.ErrForbidden,
			wantStatus: http.StatusForbidden,
			invoke:     (*Handler).Move,
			body:       "{}",
		},
		{
			name:       "list forbidden",
			serviceErr: constant.ErrForbidden,
			wantStatus: http.StatusForbidden,
			invoke:     (*Handler).List,
		},
		{
			name:       "list trash forbidden",
			serviceErr: constant.ErrForbidden,
			wantStatus: http.StatusForbidden,
			invoke:     (*Handler).ListTrash,
		},
		{
			name:       "list accesses not found",
			serviceErr: constant.ErrDocumentNotFound,
			wantStatus: http.StatusNotFound,
			invoke:     (*Handler).ListAccesses,
		},
		{
			name:       "toggle star not found",
			serviceErr: constant.ErrDocumentNotFound,
			wantStatus: http.StatusNotFound,
			invoke:     (*Handler).ToggleStar,
		},
		{
			name:       "create share token forbidden",
			serviceErr: constant.ErrForbidden,
			wantStatus: http.StatusForbidden,
			invoke:     (*Handler).CreateShareToken,
		},
		{
			name:       "duplicate not found",
			serviceErr: constant.ErrDocumentNotFound,
			wantStatus: http.StatusNotFound,
			invoke:     (*Handler).Duplicate,
			key:        uuid.NewString(),
		},
		{
			name:       "create forbidden",
			serviceErr: constant.ErrForbidden,
			wantStatus: http.StatusForbidden,
			invoke:     (*Handler).Create,
			key:        uuid.NewString(),
			body:       `{"title":"Test","type":"markdown","content":"body"}`,
		},
		{
			name:       "get forbidden",
			serviceErr: constant.ErrForbidden,
			wantStatus: http.StatusForbidden,
			invoke:     (*Handler).Get,
		},
		{
			name:       "update conflict",
			serviceErr: constant.ErrDocumentConflict,
			wantStatus: http.StatusConflict,
			invoke:     (*Handler).Update,
			body:       `{}`,
		},
		{
			name:       "move to trash forbidden",
			serviceErr: constant.ErrForbidden,
			wantStatus: http.StatusForbidden,
			invoke:     (*Handler).MoveToTrash,
		},
		{
			name:       "add access document not found",
			serviceErr: constant.ErrDocumentNotFound,
			wantStatus: http.StatusNotFound,
			invoke:     (*Handler).AddAccess,
			body:       `{"email":"user@example.com","level":"view"}`,
		},
		{
			name:       "add access user not found",
			serviceErr: constant.ErrUserNotFound,
			wantStatus: http.StatusNotFound,
			invoke:     (*Handler).AddAccess,
			body:       `{"email":"missing@example.com","level":"view"}`,
		},
		{
			name:       "remove access not found",
			serviceErr: constant.ErrAccessNotFound,
			wantStatus: http.StatusNotFound,
			invoke:     (*Handler).RemoveAccess,
		},
		{
			name:       "empty trash forbidden",
			serviceErr: constant.ErrForbidden,
			wantStatus: http.StatusForbidden,
			invoke:     (*Handler).EmptyTrash,
		},
		{
			name:       "restore forbidden",
			serviceErr: constant.ErrForbidden,
			wantStatus: http.StatusForbidden,
			invoke:     (*Handler).Restore,
		},
		{
			name:       "permanent delete not found",
			serviceErr: constant.ErrDocumentNotFound,
			wantStatus: http.StatusNotFound,
			invoke:     (*Handler).PermanentDelete,
		},
		{
			name:       "record view forbidden",
			serviceErr: constant.ErrForbidden,
			wantStatus: http.StatusForbidden,
			invoke:     (*Handler).RecordView,
		},
		{
			name:       "thumbnail update not found",
			serviceErr: constant.ErrDocumentNotFound,
			wantStatus: http.StatusNotFound,
			invoke:     (*Handler).UpdateThumbnails,
			body:       "{}",
		},
		{
			name:       "public document hides service error",
			serviceErr: constant.ErrForbidden,
			wantStatus: http.StatusNotFound,
			invoke:     (*Handler).GetPublic,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewHandler(documentErrorServiceStub{err: tt.serviceErr}, nil)
			r := httptest.NewRequest(http.MethodPost, "/documents/"+docID.String(), strings.NewReader(tt.body))
			r.SetPathValue("id", docID.String())
			r.SetPathValue("accessId", uuid.New().String())
			r.SetPathValue("shareToken", "opaque-token")
			r.Header.Set("X-Workspace-Id", workspaceID.String())
			if tt.key != "" {
				r.Header.Set("Idempotency-Key", tt.key)
			}
			ctx := middleware.ContextWithUser(r.Context(), authdto.ResponseUser{ID: userID.String()})
			r = r.WithContext(ctx)
			rr := httptest.NewRecorder()
			middleware.RequireWorkspace(documentErrorWorkspaceStub{})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				tt.invoke(h, w, r)
			})).ServeHTTP(rr, r)

			if rr.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body: %s", rr.Code, tt.wantStatus, rr.Body.String())
			}
		})
	}
}

func TestCreateAndDuplicateRequireIdempotencyKey(t *testing.T) {
	userID, workspaceID, docID := uuid.New(), uuid.New(), uuid.New()
	for _, endpoint := range []struct {
		name   string
		invoke func(*Handler, http.ResponseWriter, *http.Request)
		path   string
	}{
		{name: "create", invoke: (*Handler).Create, path: "/documents"},
		{name: "duplicate", invoke: (*Handler).Duplicate, path: "/documents/" + docID.String() + "/duplicate"},
	} {
		t.Run(endpoint.name, func(t *testing.T) {
			h := NewHandler(documentErrorServiceStub{err: constant.ErrDocumentNotFound}, nil)
			r := httptest.NewRequest(http.MethodPost, endpoint.path, strings.NewReader(`{"title":"Test","type":"markdown"}`))
			r.SetPathValue("id", docID.String())
			r.Header.Set("X-Workspace-Id", workspaceID.String())
			r = r.WithContext(middleware.ContextWithUser(r.Context(), authdto.ResponseUser{ID: userID.String()}))
			rr := httptest.NewRecorder()
			middleware.RequireWorkspace(documentErrorWorkspaceStub{})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				endpoint.invoke(h, w, r)
			})).ServeHTTP(rr, r)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("%s without Idempotency-Key status = %d, want %d", endpoint.name, rr.Code, http.StatusBadRequest)
			}
		})
	}
}

func TestListRejectsInvalidProjectID(t *testing.T) {
	userID, workspaceID := uuid.New(), uuid.New()
	h := NewHandler(documentErrorServiceStub{}, nil)
	r := httptest.NewRequest(http.MethodGet, "/documents?projectId=not-a-uuid", nil)
	r.Header.Set("X-Workspace-Id", workspaceID.String())
	r = r.WithContext(middleware.ContextWithUser(r.Context(), authdto.ResponseUser{ID: userID.String()}))
	rr := httptest.NewRecorder()
	middleware.RequireWorkspace(documentErrorWorkspaceStub{})(http.HandlerFunc(h.List)).ServeHTTP(rr, r)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body: %s", rr.Code, http.StatusBadRequest, rr.Body.String())
	}
}

func TestDocumentErrorsDoNotExposeInternalDetails(t *testing.T) {
	h := NewHandler(documentErrorServiceStub{err: errors.New("database password leaked")}, nil)
	r := httptest.NewRequest(http.MethodGet, "/documents", nil)
	r.Header.Set("X-Workspace-Id", uuid.NewString())
	r = r.WithContext(middleware.ContextWithUser(r.Context(), authdto.ResponseUser{ID: uuid.NewString()}))
	rr := httptest.NewRecorder()
	middleware.RequireWorkspace(documentErrorWorkspaceStub{})(http.HandlerFunc(h.List)).ServeHTTP(rr, r)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusInternalServerError)
	}
	if strings.Contains(rr.Body.String(), "database password leaked") {
		t.Fatalf("internal error leaked in response: %s", rr.Body.String())
	}
}
