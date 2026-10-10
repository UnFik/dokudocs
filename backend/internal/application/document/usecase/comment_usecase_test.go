package usecase

import (
	"context"
	"errors"
	"strings"
	"testing"

	"backend/internal/domain/mention"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

type recordingComments struct {
	created []model.CommentThread
	replies []model.CommentReply
	// docType is what the document reports; markdown when left empty.
	docType    string
	docTypeErr error
	// members are who a mention may name; anyone else is not in the workspace.
	members map[uuid.UUID]model.MentionTarget
	edits   []string
	// candidates are what the document offers to mention.
	candidates    []model.MentionTarget
	candidatesErr error
}

func (r *recordingComments) ListMentionCandidates(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) ([]model.MentionTarget, error) {
	return r.candidates, r.candidatesErr
}

func (r *recordingComments) ResolveMentions(_ context.Context, _, _ uuid.UUID, ids []uuid.UUID) ([]model.MentionTarget, error) {
	var found []model.MentionTarget
	for _, id := range ids {
		if target, ok := r.members[id]; ok {
			found = append(found, target)
		}
	}
	return found, nil
}

func (r *recordingComments) CommentDocumentType(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (string, error) {
	if r.docTypeErr != nil {
		return "", r.docTypeErr
	}
	if r.docType == "" {
		return "markdown", nil
	}
	return r.docType, nil
}

func (r *recordingComments) ListComments(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) ([]model.CommentThread, error) {
	return nil, nil
}

func (r *recordingComments) CreateComment(_ context.Context, _ uuid.UUID, thread model.CommentThread) error {
	r.created = append(r.created, thread)
	return nil
}

func (r *recordingComments) CreateCommentReply(_ context.Context, _, _ uuid.UUID, reply model.CommentReply) error {
	r.replies = append(r.replies, reply)
	return nil
}

func (r *recordingComments) UpdateComment(_ context.Context, _, _, _, _ uuid.UUID, content string) error {
	r.edits = append(r.edits, content)
	return nil
}

func (r *recordingComments) UpdateCommentReply(_ context.Context, _, _, _, _, _ uuid.UUID, content string) error {
	r.edits = append(r.edits, content)
	return nil
}

func (r *recordingComments) DeleteComment(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) error {
	return nil
}

func (r *recordingComments) DeleteCommentReply(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) error {
	return nil
}

func (r *recordingComments) SetCommentResolved(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, bool) error {
	return nil
}

func TestCommentUseCaseRejectsInvalidInputBeforeTheRepository(t *testing.T) {
	valid := CommentInput{
		WorkspaceID: uuid.New(), DocumentID: uuid.New(), ThreadID: uuid.New(), AuthorID: uuid.New(),
		SelectedText: "text", Content: "a comment",
	}
	with := func(edit func(*CommentInput)) CommentInput {
		input := valid
		edit(&input)
		return input
	}
	cases := map[string]CommentInput{
		"empty content":       with(func(i *CommentInput) { i.Content = "  \n " }),
		"long content":        with(func(i *CommentInput) { i.Content = strings.Repeat("a", MaxCommentLength+1) }),
		"long selection":      with(func(i *CommentInput) { i.SelectedText = strings.Repeat("a", MaxCommentSelection+1) }),
		"no thread id":        with(func(i *CommentInput) { i.ThreadID = uuid.Nil }),
		"anchor not object":   with(func(i *CommentInput) { i.Anchor = []byte(`[1]`) }),
		"anchor not json":     with(func(i *CommentInput) { i.Anchor = []byte(`{`) }),
		"anchor too large":    with(func(i *CommentInput) { i.Anchor = []byte(`{"a":"` + strings.Repeat("x", MaxCommentAnchorBytes) + `"}`) }),
		"anchor empty string": with(func(i *CommentInput) { i.Anchor = []byte(`""`) }),
	}
	for name, input := range cases {
		repo := &recordingComments{}
		if err := NewCommentUseCase(repo).Create(context.Background(), input); !errors.Is(err, ErrInvalidComment) {
			t.Errorf("%s: Create() = %v, want ErrInvalidComment", name, err)
		}
		if len(repo.created) != 0 {
			t.Errorf("%s: invalid input reached the repository", name)
		}
	}

	repo := &recordingComments{}
	good := with(func(i *CommentInput) {
		i.Content = "  trimmed  "
		i.Anchor = []byte(`{"nodeID":"n","start":"AA==","end":"AQ=="}`)
	})
	if err := NewCommentUseCase(repo).Create(context.Background(), good); err != nil {
		t.Fatalf("Create() = %v", err)
	}
	withNull := with(func(i *CommentInput) { i.Anchor = []byte(`null`) })
	if err := NewCommentUseCase(repo).Create(context.Background(), withNull); err != nil {
		t.Fatalf("a null anchor means none: %v", err)
	}
	if repo.created[1].Anchor != nil {
		t.Fatalf("null anchor stored as %q, want none", repo.created[1].Anchor)
	}
	if len(repo.created) != 2 || repo.created[0].Content != "trimmed" {
		t.Fatalf("stored %+v, want one thread with trimmed content", repo.created)
	}
}

func TestCommentUseCaseChecksTheAnchorAgainstTheDocumentType(t *testing.T) {
	const (
		text    = `{"nodeID":"n","start":"AA==","end":"AQ=="}`
		element = `{"kind":"element","elementId":"node-1"}`
		source  = `{"kind":"source","start":"AA==","end":"AQ=="}`
	)
	input := func(anchor string) CommentInput {
		return CommentInput{
			WorkspaceID: uuid.New(), DocumentID: uuid.New(), ThreadID: uuid.New(), AuthorID: uuid.New(),
			Content: "a comment", Anchor: []byte(anchor),
		}
	}
	for _, tc := range []struct {
		docType, anchor string
		valid           bool
	}{
		{"markdown", text, true},
		{"markdown", element, false},
		{"architecture", element, true},
		{"architecture", text, false},
		{"architecture", "", false},
		{"dbdiagram", source, true},
		{"mermaid", source, true},
		{"mermaid", element, false},
	} {
		repo := &recordingComments{docType: tc.docType}
		err := NewCommentUseCase(repo).Create(context.Background(), input(tc.anchor))
		if tc.valid && err != nil {
			t.Errorf("%s %s: Create() = %v, want nil", tc.docType, tc.anchor, err)
		}
		if !tc.valid && !errors.Is(err, ErrInvalidComment) {
			t.Errorf("%s %s: Create() = %v, want ErrInvalidComment", tc.docType, tc.anchor, err)
		}
		if got := len(repo.created) == 1; got != tc.valid {
			t.Errorf("%s %s: reached the repository = %v, want %v", tc.docType, tc.anchor, got, tc.valid)
		}
	}

	denied := errors.New("no access")
	repo := &recordingComments{docTypeErr: denied}
	if err := NewCommentUseCase(repo).Create(context.Background(), input(text)); !errors.Is(err, denied) {
		t.Fatalf("a document the actor cannot discuss = %v, want that error, not a verdict on the anchor", err)
	}
}

func TestCommentUseCaseReplyValidation(t *testing.T) {
	repo := &recordingComments{}
	usecase := NewCommentUseCase(repo)
	base := CommentReplyInput{
		WorkspaceID: uuid.New(), DocumentID: uuid.New(), ThreadID: uuid.New(),
		ReplyID: uuid.New(), AuthorID: uuid.New(), Content: "ok",
	}
	for name, edit := range map[string]func(*CommentReplyInput){
		"empty":       func(i *CommentReplyInput) { i.Content = " " },
		"too long":    func(i *CommentReplyInput) { i.Content = strings.Repeat("a", MaxCommentLength+1) },
		"no reply id": func(i *CommentReplyInput) { i.ReplyID = uuid.Nil },
	} {
		input := base
		edit(&input)
		if err := usecase.Reply(context.Background(), input); !errors.Is(err, ErrInvalidComment) {
			t.Errorf("%s: Reply() = %v, want ErrInvalidComment", name, err)
		}
	}
	if err := usecase.Reply(context.Background(), base); err != nil || len(repo.replies) != 1 {
		t.Fatalf("Reply() = %v, %d stored, want one", err, len(repo.replies))
	}
}

func mentionedMember(name string, canRead bool) (uuid.UUID, model.MentionTarget) {
	id := uuid.New()
	return id, model.MentionTarget{UserID: id, Name: name, Email: "m@example.com", CanRead: canRead}
}

func TestCommentUseCaseMentions(t *testing.T) {
	ana, anaTarget := mentionedMember("Ana Bo", true)
	locked, lockedTarget := mentionedMember("Locked Out", false)
	stranger := uuid.New()
	repo := &recordingComments{members: map[uuid.UUID]model.MentionTarget{ana: anaTarget, locked: lockedTarget}}
	usecase := NewCommentUseCase(repo)
	token := func(id uuid.UUID, label string) string { return mention.Token(id, label) }
	create := func(content string) error {
		return usecase.Create(context.Background(), CommentInput{
			WorkspaceID: uuid.New(), DocumentID: uuid.New(), ThreadID: uuid.New(), AuthorID: uuid.New(),
			Content: content, Anchor: []byte(`{"nodeID":"n","start":"AA==","end":"AQ=="}`),
		})
	}

	if err := create("look " + token(ana, "an old name") + " and " + token(ana, "Ana Bo")); err != nil {
		t.Fatalf("a mention of a member = %v", err)
	}
	if got, want := repo.created[0].Content, "look "+token(ana, "Ana Bo")+" and "+token(ana, "Ana Bo"); got != want {
		t.Fatalf("stored %q, want the label written from the member's name: %q", got, want)
	}

	for name, content := range map[string]string{
		"someone outside the workspace": "hi " + token(stranger, "Stranger"),
		"someone who cannot read":       "hi " + token(locked, "Locked Out"),
		"too many mentions":             strings.Repeat(token(ana, "Ana Bo")+" ", MaxMentionsPerComment+1),
		"visible text too long":         strings.Repeat("a", MaxCommentLength) + token(ana, "Ana Bo"),
	} {
		before := len(repo.created)
		if err := create(content); !errors.Is(err, ErrInvalidComment) {
			t.Errorf("%s: Create() = %v, want ErrInvalidComment", name, err)
		}
		if len(repo.created) != before {
			t.Errorf("%s: reached the repository", name)
		}
	}

	// The token is longer than the name it shows; only what reads counts.
	roomy := strings.Repeat("a", MaxCommentLength-len("@Ana Bo")) + token(ana, "Ana Bo")
	if err := create(roomy); err != nil {
		t.Fatalf("a comment that reads %d characters = %v", MaxCommentLength, err)
	}

	odd, oddTarget := mentionedMember("Ana [Bo] (HQ)", true)
	repo.members[odd] = oddTarget
	if err := create(token(odd, "x")); err != nil {
		t.Fatal(err)
	}
	if got, want := repo.created[len(repo.created)-1].Content, token(odd, "Ana Bo HQ"); got != want {
		t.Fatalf("stored %q, want a label that cannot end the token early: %q", got, want)
	}
}

func TestCommentUseCaseRepliesAndEditsResolveMentionsToo(t *testing.T) {
	ana, anaTarget := mentionedMember("Ana Bo", true)
	stranger := uuid.New()
	repo := &recordingComments{members: map[uuid.UUID]model.MentionTarget{ana: anaTarget}}
	usecase := NewCommentUseCase(repo)
	ws, doc, thread, actor := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	reply := func(content string) error {
		return usecase.Reply(context.Background(), CommentReplyInput{
			WorkspaceID: ws, DocumentID: doc, ThreadID: thread, ReplyID: uuid.New(), AuthorID: actor, Content: content,
		})
	}
	if err := reply(mention.Token(ana, "old")); err != nil || repo.replies[0].Content != mention.Token(ana, "Ana Bo") {
		t.Fatalf("Reply() = %v, stored %+v", err, repo.replies)
	}
	if err := reply(mention.Token(stranger, "Who")); !errors.Is(err, ErrInvalidComment) {
		t.Fatalf("Reply() naming a stranger = %v, want ErrInvalidComment", err)
	}

	if err := usecase.Edit(context.Background(), ws, doc, thread, actor, "now "+mention.Token(ana, "old")); err != nil {
		t.Fatalf("Edit() = %v", err)
	}
	if err := usecase.EditReply(context.Background(), ws, doc, thread, uuid.New(), actor, mention.Token(ana, "old")); err != nil {
		t.Fatalf("EditReply() = %v", err)
	}
	if repo.edits[0] != "now "+mention.Token(ana, "Ana Bo") || repo.edits[1] != mention.Token(ana, "Ana Bo") {
		t.Fatalf("edits stored as %q", repo.edits)
	}
	if err := usecase.Edit(context.Background(), ws, doc, thread, actor, mention.Token(stranger, "Who")); !errors.Is(err, ErrInvalidComment) {
		t.Fatalf("Edit() naming a stranger = %v, want ErrInvalidComment", err)
	}
	if err := usecase.EditReply(context.Background(), ws, doc, thread, uuid.New(), actor, mention.Token(stranger, "Who")); !errors.Is(err, ErrInvalidComment) {
		t.Fatalf("EditReply() naming a stranger = %v, want ErrInvalidComment", err)
	}
}

func TestCommentUseCaseListsWhoCanBeMentioned(t *testing.T) {
	ana, anaTarget := mentionedMember("Ana Bo", true)
	_, lockedTarget := mentionedMember("Locked Out", false)
	repo := &recordingComments{candidates: []model.MentionTarget{anaTarget, lockedTarget}}
	usecase := NewCommentUseCase(repo)
	got, err := usecase.MentionCandidates(context.Background(), uuid.New(), uuid.New(), uuid.New())
	if err != nil || len(got) != 2 || got[0].UserID != ana || got[1].CanRead {
		t.Fatalf("MentionCandidates() = %+v, %v, want both members with their access", got, err)
	}
	if _, err := usecase.MentionCandidates(context.Background(), uuid.Nil, uuid.New(), uuid.New()); !errors.Is(err, ErrInvalidComment) {
		t.Fatalf("MentionCandidates() without a workspace = %v, want ErrInvalidComment", err)
	}
	denied := errors.New("no access")
	if _, err := NewCommentUseCase(&recordingComments{candidatesErr: denied}).MentionCandidates(context.Background(), uuid.New(), uuid.New(), uuid.New()); !errors.Is(err, denied) {
		t.Fatalf("MentionCandidates() = %v, want the repository's refusal", err)
	}
}
