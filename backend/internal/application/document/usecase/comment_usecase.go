package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	"backend/internal/domain/contract/repository"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

var ErrInvalidComment = errors.New("invalid comment")

const (
	// MaxCommentLength bounds one comment or reply, counted in characters.
	MaxCommentLength = 2000
	// MaxCommentSelection bounds the quoted text kept with a thread.
	MaxCommentSelection = 500
	// MaxCommentAnchorBytes bounds the stored anchor.
	MaxCommentAnchorBytes = 4096
)

type CommentUseCase struct {
	comments repository.CommentRepository
}

func NewCommentUseCase(comments repository.CommentRepository) *CommentUseCase {
	return &CommentUseCase{comments: comments}
}

func (u *CommentUseCase) List(ctx context.Context, workspaceID, documentID, actorID uuid.UUID) ([]model.CommentThread, error) {
	if workspaceID == uuid.Nil || documentID == uuid.Nil || actorID == uuid.Nil {
		return nil, ErrInvalidComment
	}
	return u.comments.ListComments(ctx, workspaceID, documentID, actorID)
}

type CommentInput struct {
	WorkspaceID  uuid.UUID
	DocumentID   uuid.UUID
	ThreadID     uuid.UUID
	AuthorID     uuid.UUID
	SelectedText string
	Content      string
	Anchor       json.RawMessage
}

func (u *CommentUseCase) Create(ctx context.Context, input CommentInput) error {
	content := strings.TrimSpace(input.Content)
	if input.WorkspaceID == uuid.Nil || input.DocumentID == uuid.Nil || input.ThreadID == uuid.Nil ||
		input.AuthorID == uuid.Nil || content == "" || utf8.RuneCountInString(content) > MaxCommentLength ||
		utf8.RuneCountInString(input.SelectedText) > MaxCommentSelection {
		return ErrInvalidComment
	}
	if string(input.Anchor) == "null" {
		input.Anchor = nil
	}
	if len(input.Anchor) > 0 {
		var object map[string]json.RawMessage
		if len(input.Anchor) > MaxCommentAnchorBytes || json.Unmarshal(input.Anchor, &object) != nil || object == nil {
			return ErrInvalidComment
		}
	}
	return u.comments.CreateComment(ctx, input.WorkspaceID, model.CommentThread{
		ID: input.ThreadID, DocumentID: input.DocumentID, AuthorID: input.AuthorID,
		SelectedText: input.SelectedText, Content: content, Anchor: input.Anchor,
	})
}

type CommentReplyInput struct {
	WorkspaceID uuid.UUID
	DocumentID  uuid.UUID
	ThreadID    uuid.UUID
	ReplyID     uuid.UUID
	AuthorID    uuid.UUID
	Content     string
}

func (u *CommentUseCase) Reply(ctx context.Context, input CommentReplyInput) error {
	content := strings.TrimSpace(input.Content)
	if input.WorkspaceID == uuid.Nil || input.DocumentID == uuid.Nil || input.ThreadID == uuid.Nil ||
		input.ReplyID == uuid.Nil || input.AuthorID == uuid.Nil || content == "" ||
		utf8.RuneCountInString(content) > MaxCommentLength {
		return ErrInvalidComment
	}
	return u.comments.CreateCommentReply(ctx, input.WorkspaceID, input.DocumentID, model.CommentReply{
		ID: input.ReplyID, ThreadID: input.ThreadID, AuthorID: input.AuthorID, Content: content,
	})
}

func (u *CommentUseCase) Resolve(ctx context.Context, workspaceID, documentID, threadID, actorID uuid.UUID, resolved bool) error {
	if workspaceID == uuid.Nil || documentID == uuid.Nil || threadID == uuid.Nil || actorID == uuid.Nil {
		return ErrInvalidComment
	}
	return u.comments.SetCommentResolved(ctx, workspaceID, documentID, threadID, actorID, resolved)
}

func validContent(content string) (string, bool) {
	trimmed := strings.TrimSpace(content)
	return trimmed, trimmed != "" && utf8.RuneCountInString(trimmed) <= MaxCommentLength
}

// Edit changes the text of a thread's first message.
func (u *CommentUseCase) Edit(ctx context.Context, workspaceID, documentID, threadID, actorID uuid.UUID, content string) error {
	trimmed, ok := validContent(content)
	if !ok || workspaceID == uuid.Nil || documentID == uuid.Nil || threadID == uuid.Nil || actorID == uuid.Nil {
		return ErrInvalidComment
	}
	return u.comments.UpdateComment(ctx, workspaceID, documentID, threadID, actorID, trimmed)
}

// EditReply changes the text of a reply.
func (u *CommentUseCase) EditReply(ctx context.Context, workspaceID, documentID, threadID, replyID, actorID uuid.UUID, content string) error {
	trimmed, ok := validContent(content)
	if !ok || workspaceID == uuid.Nil || documentID == uuid.Nil || threadID == uuid.Nil || replyID == uuid.Nil || actorID == uuid.Nil {
		return ErrInvalidComment
	}
	return u.comments.UpdateCommentReply(ctx, workspaceID, documentID, threadID, replyID, actorID, trimmed)
}

// Delete removes a thread with its replies.
func (u *CommentUseCase) Delete(ctx context.Context, workspaceID, documentID, threadID, actorID uuid.UUID) error {
	if workspaceID == uuid.Nil || documentID == uuid.Nil || threadID == uuid.Nil || actorID == uuid.Nil {
		return ErrInvalidComment
	}
	return u.comments.DeleteComment(ctx, workspaceID, documentID, threadID, actorID)
}

// DeleteReply removes one reply.
func (u *CommentUseCase) DeleteReply(ctx context.Context, workspaceID, documentID, threadID, replyID, actorID uuid.UUID) error {
	if workspaceID == uuid.Nil || documentID == uuid.Nil || threadID == uuid.Nil || replyID == uuid.Nil || actorID == uuid.Nil {
		return ErrInvalidComment
	}
	return u.comments.DeleteCommentReply(ctx, workspaceID, documentID, threadID, replyID, actorID)
}
