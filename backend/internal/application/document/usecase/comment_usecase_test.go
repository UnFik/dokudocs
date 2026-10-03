package usecase

import (
	"context"
	"errors"
	"strings"
	"testing"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

type recordingComments struct {
	created []model.CommentThread
	replies []model.CommentReply
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

func (r *recordingComments) UpdateComment(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, string) error {
	return nil
}

func (r *recordingComments) UpdateCommentReply(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, string) error {
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
		i.Anchor = []byte(`{"nodeID":"n"}`)
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
