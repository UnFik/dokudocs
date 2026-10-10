package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	authdto "backend/internal/application/auth/dto"
	"errors"

	"backend/constant"
	appdoc "backend/internal/application/document/usecase"
	"backend/internal/domain/model"
	"backend/internal/presentation/middleware"

	"github.com/google/uuid"
)

type commentRepoFake struct{ err error }

func (f commentRepoFake) ListComments(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) ([]model.CommentThread, error) {
	return []model.CommentThread{}, f.err
}
func (f commentRepoFake) ResolveMentions(context.Context, uuid.UUID, uuid.UUID, []uuid.UUID) ([]model.MentionTarget, error) {
	return nil, f.err
}
func (f commentRepoFake) CommentDocumentType(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (string, error) {
	return "markdown", f.err
}
func (f commentRepoFake) CreateComment(context.Context, uuid.UUID, model.CommentThread) error {
	return f.err
}
func (f commentRepoFake) CreateCommentReply(context.Context, uuid.UUID, uuid.UUID, model.CommentReply) error {
	return f.err
}
func (f commentRepoFake) UpdateComment(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, string) error {
	return f.err
}
func (f commentRepoFake) UpdateCommentReply(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, string) error {
	return f.err
}
func (f commentRepoFake) DeleteComment(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) error {
	return f.err
}
func (f commentRepoFake) DeleteCommentReply(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) error {
	return f.err
}
func (f commentRepoFake) SetCommentResolved(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, bool) error {
	return f.err
}

type notifierFake struct{ documents []uuid.UUID }

func (n *notifierFake) NotifyComments(documentID uuid.UUID) {
	n.documents = append(n.documents, documentID)
}

func callComment(t *testing.T, h *CommentHandler, invoke func(http.ResponseWriter, *http.Request), body string, documentID, threadID uuid.UUID) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/documents/"+documentID.String()+"/comments", strings.NewReader(body))
	r.SetPathValue("id", documentID.String())
	r.SetPathValue("threadID", threadID.String())
	r.Header.Set("X-Workspace-Id", uuid.NewString())
	r = r.WithContext(middleware.ContextWithUser(r.Context(), authdto.ResponseUser{ID: uuid.NewString()}))
	rr := httptest.NewRecorder()
	middleware.RequireWorkspace(documentErrorWorkspaceStub{})(http.HandlerFunc(invoke)).ServeHTTP(rr, r)
	return rr
}

func TestCommentWritesWakeTheRoomAndReadsDoNot(t *testing.T) {
	documentID, threadID := uuid.New(), uuid.New()
	notifier := &notifierFake{}
	h := NewCommentHandler(appdoc.NewCommentUseCase(commentRepoFake{})).WithNotifier(notifier)

	create := `{"threadID":"` + uuid.NewString() + `","selectedText":"x","content":"a question"}`
	reply := `{"replyID":"` + uuid.NewString() + `","content":"an answer"}`
	for name, step := range map[string]struct {
		invoke func(http.ResponseWriter, *http.Request)
		body   string
		status int
	}{
		"create":  {h.Create, create, http.StatusCreated},
		"reply":   {h.Reply, reply, http.StatusCreated},
		"resolve": {h.Resolve, "", http.StatusNoContent},
		"reopen":  {h.Reopen, "", http.StatusNoContent},
	} {
		before := len(notifier.documents)
		rr := callComment(t, h, step.invoke, step.body, documentID, threadID)
		if rr.Code != step.status {
			t.Fatalf("%s status = %d, want %d; body: %s", name, rr.Code, step.status, rr.Body.String())
		}
		if len(notifier.documents) != before+1 || notifier.documents[before] != documentID {
			t.Fatalf("%s woke %v, want the document once", name, notifier.documents[before:])
		}
	}

	before := len(notifier.documents)
	if rr := callComment(t, h, h.List, "", documentID, threadID); rr.Code != http.StatusOK {
		t.Fatalf("list status = %d, want 200", rr.Code)
	}
	if len(notifier.documents) != before {
		t.Fatal("reading comments must not wake the room")
	}
}

func TestCommentWritesThatFailDoNotWakeTheRoom(t *testing.T) {
	notifier := &notifierFake{}
	h := NewCommentHandler(appdoc.NewCommentUseCase(commentRepoFake{})).WithNotifier(notifier)

	empty := `{"threadID":"` + uuid.NewString() + `","content":"   "}`
	if rr := callComment(t, h, h.Create, empty, uuid.New(), uuid.New()); rr.Code != http.StatusBadRequest {
		t.Fatalf("empty comment status = %d, want 400", rr.Code)
	}
	if rr := callComment(t, h, h.Create, `not json`, uuid.New(), uuid.New()); rr.Code != http.StatusBadRequest {
		t.Fatalf("malformed body status = %d, want 400", rr.Code)
	}
	if len(notifier.documents) != 0 {
		t.Fatalf("failed writes woke %v, want nothing", notifier.documents)
	}
}

func TestCommentErrorsMapToTheRightStatus(t *testing.T) {
	for name, tc := range map[string]struct {
		err    error
		status int
	}{
		"viewer":          {constant.ErrForbidden, http.StatusForbidden},
		"unknown thread":  {constant.ErrDocumentNotFound, http.StatusNotFound},
		"unexpected fail": {errors.New("database password leaked"), http.StatusInternalServerError},
	} {
		notifier := &notifierFake{}
		h := NewCommentHandler(appdoc.NewCommentUseCase(commentRepoFake{err: tc.err})).WithNotifier(notifier)
		body := `{"replyID":"` + uuid.NewString() + `","content":"hi"}`
		rr := callComment(t, h, h.Reply, body, uuid.New(), uuid.New())
		if rr.Code != tc.status {
			t.Fatalf("%s: status = %d, want %d", name, rr.Code, tc.status)
		}
		if strings.Contains(rr.Body.String(), "password") {
			t.Fatalf("%s: internal detail leaked: %s", name, rr.Body.String())
		}
		if len(notifier.documents) != 0 {
			t.Fatalf("%s: a failed write woke the room", name)
		}
	}
}

func TestCommentEditAndDeleteWakeTheRoomAndCheckTheText(t *testing.T) {
	documentID, threadID := uuid.New(), uuid.New()
	notifier := &notifierFake{}
	h := NewCommentHandler(appdoc.NewCommentUseCase(commentRepoFake{})).WithNotifier(notifier)
	call := func(invoke func(http.ResponseWriter, *http.Request), body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPatch, "/documents/"+documentID.String()+"/comments/"+threadID.String(), strings.NewReader(body))
		r.SetPathValue("id", documentID.String())
		r.SetPathValue("threadID", threadID.String())
		r.SetPathValue("replyID", uuid.NewString())
		r.Header.Set("X-Workspace-Id", uuid.NewString())
		r = r.WithContext(middleware.ContextWithUser(r.Context(), authdto.ResponseUser{ID: uuid.NewString()}))
		rr := httptest.NewRecorder()
		middleware.RequireWorkspace(documentErrorWorkspaceStub{})(http.HandlerFunc(invoke)).ServeHTTP(rr, r)
		return rr
	}

	for name, step := range map[string]struct {
		invoke func(http.ResponseWriter, *http.Request)
		body   string
	}{
		"edit":         {h.Edit, `{"content":"fixed"}`},
		"edit reply":   {h.EditReply, `{"content":"fixed"}`},
		"delete":       {h.Delete, ""},
		"delete reply": {h.DeleteReply, ""},
	} {
		before := len(notifier.documents)
		if rr := call(step.invoke, step.body); rr.Code != http.StatusNoContent {
			t.Fatalf("%s status = %d, want 204; body: %s", name, rr.Code, rr.Body.String())
		}
		if len(notifier.documents) != before+1 {
			t.Fatalf("%s did not wake the room", name)
		}
	}
	before := len(notifier.documents)
	if rr := call(h.Edit, `{"content":"   "}`); rr.Code != http.StatusBadRequest {
		t.Fatalf("an empty edit = %d, want 400", rr.Code)
	}
	if rr := call(h.EditReply, `{"content":"`+strings.Repeat("a", appdoc.MaxCommentLength+1)+`"}`); rr.Code != http.StatusBadRequest {
		t.Fatalf("a too long edit = %d, want 400", rr.Code)
	}
	if len(notifier.documents) != before {
		t.Fatal("a refused edit woke the room")
	}
}
