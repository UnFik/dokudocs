package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	"backend/internal/domain/contract/notification"
	"backend/internal/domain/contract/repository"
	"backend/internal/domain/mention"
	"backend/internal/domain/model"
	"backend/internal/domain/policy"

	"github.com/google/uuid"
)

var ErrInvalidComment = errors.New("invalid comment")

const (
	// MaxCommentLength bounds one comment or reply, counted in characters.
	MaxCommentLength = 2000
	// MaxCommentSelection bounds the quoted text kept with a thread.
	MaxCommentSelection = 500
	// MaxCommentRawLength bounds the stored text, in which a mention is longer
	// than the name it shows.
	MaxCommentRawLength = 6000
	// MaxMentionsPerComment bounds how many people one comment or reply names.
	MaxMentionsPerComment = 20
	// MaxCommentAnchorBytes bounds the stored anchor.
	MaxCommentAnchorBytes = 4096
)

type CommentUseCase struct {
	comments  repository.CommentRepository
	deliverer notification.MentionDeliverer
}

// WithDeliverer sends email and push for the mentions a write reports.
func (u *CommentUseCase) WithDeliverer(deliverer notification.MentionDeliverer) *CommentUseCase {
	u.deliverer = deliverer
	return u
}

// deliver hands on what a write that saved reports; a write that failed owes nothing.
func (u *CommentUseCase) deliver(ctx context.Context, deliveries []model.MentionDelivery, err error) error {
	if err == nil && len(deliveries) > 0 && u.deliverer != nil {
		u.deliverer.Deliver(ctx, deliveries)
	}
	return err
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

// MentionCandidates lists whom a comment on the document may name.
func (u *CommentUseCase) MentionCandidates(ctx context.Context, workspaceID, documentID, actorID uuid.UUID) ([]model.MentionTarget, error) {
	if workspaceID == uuid.Nil || documentID == uuid.Nil || actorID == uuid.Nil {
		return nil, ErrInvalidComment
	}
	return u.comments.ListMentionCandidates(ctx, workspaceID, documentID, actorID)
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
	if input.WorkspaceID == uuid.Nil || input.DocumentID == uuid.Nil || input.ThreadID == uuid.Nil ||
		input.AuthorID == uuid.Nil || utf8.RuneCountInString(input.SelectedText) > MaxCommentSelection {
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
	docType, err := u.comments.CommentDocumentType(ctx, input.WorkspaceID, input.DocumentID, input.AuthorID)
	if err != nil {
		return err
	}
	if policy.ValidateCommentAnchor(docType, input.Anchor) != nil {
		return ErrInvalidComment
	}
	content, mentioned, err := u.prepareContent(ctx, input.WorkspaceID, input.DocumentID, input.Content)
	if err != nil {
		return err
	}
	deliveries, err := u.comments.CreateComment(ctx, input.WorkspaceID, model.CommentThread{
		ID: input.ThreadID, DocumentID: input.DocumentID, AuthorID: input.AuthorID,
		SelectedText: input.SelectedText, Content: content, Anchor: input.Anchor, Mentioned: mentioned,
	})
	return u.deliver(ctx, deliveries, err)
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
	if input.WorkspaceID == uuid.Nil || input.DocumentID == uuid.Nil || input.ThreadID == uuid.Nil ||
		input.ReplyID == uuid.Nil || input.AuthorID == uuid.Nil {
		return ErrInvalidComment
	}
	content, mentioned, err := u.prepareContent(ctx, input.WorkspaceID, input.DocumentID, input.Content)
	if err != nil {
		return err
	}
	deliveries, err := u.comments.CreateCommentReply(ctx, input.WorkspaceID, input.DocumentID, model.CommentReply{
		ID: input.ReplyID, ThreadID: input.ThreadID, AuthorID: input.AuthorID, Content: content, Mentioned: mentioned,
	})
	return u.deliver(ctx, deliveries, err)
}

func (u *CommentUseCase) Resolve(ctx context.Context, workspaceID, documentID, threadID, actorID uuid.UUID, resolved bool) error {
	if workspaceID == uuid.Nil || documentID == uuid.Nil || threadID == uuid.Nil || actorID == uuid.Nil {
		return ErrInvalidComment
	}
	return u.comments.SetCommentResolved(ctx, workspaceID, documentID, threadID, actorID, resolved)
}

// prepareContent checks the text of a comment and returns what to store: the
// mentions in it name members who can read the document, and each carries that
// member's name as it is now, so a label sent by a client cannot say otherwise.
// It also returns whom the text names, each once, in order.
func (u *CommentUseCase) prepareContent(ctx context.Context, workspaceID, documentID uuid.UUID, content string) (string, []uuid.UUID, error) {
	content = strings.TrimSpace(content)
	if content == "" || utf8.RuneCountInString(content) > MaxCommentRawLength {
		return "", nil, ErrInvalidComment
	}
	var ids []uuid.UUID
	if mentions := mention.Parse(content); len(mentions) > 0 {
		if len(mentions) > MaxMentionsPerComment {
			return "", nil, ErrInvalidComment
		}
		named := make(map[uuid.UUID]bool, len(mentions))
		for _, mentioned := range mentions {
			if !named[mentioned.UserID] {
				named[mentioned.UserID] = true
				ids = append(ids, mentioned.UserID)
			}
		}
		targets, err := u.comments.ResolveMentions(ctx, workspaceID, documentID, ids)
		if err != nil {
			return "", nil, err
		}
		labels := make(map[uuid.UUID]string, len(targets))
		for _, target := range targets {
			if target.CanRead {
				labels[target.UserID] = policy.CleanDisplayName(target.Name, target.Email)
			}
		}
		for _, id := range ids {
			if _, ok := labels[id]; !ok {
				return "", nil, ErrInvalidComment
			}
		}
		content = mention.Rewrite(content, func(id uuid.UUID) string { return labels[id] })
	}
	if utf8.RuneCountInString(mention.Visible(content)) > MaxCommentLength {
		return "", nil, ErrInvalidComment
	}
	return content, ids, nil
}

// Edit changes the text of a thread's first message.
func (u *CommentUseCase) Edit(ctx context.Context, workspaceID, documentID, threadID, actorID uuid.UUID, content string) error {
	if workspaceID == uuid.Nil || documentID == uuid.Nil || threadID == uuid.Nil || actorID == uuid.Nil {
		return ErrInvalidComment
	}
	stored, mentioned, err := u.prepareContent(ctx, workspaceID, documentID, content)
	if err != nil {
		return err
	}
	deliveries, err := u.comments.UpdateComment(ctx, workspaceID, documentID, threadID, actorID, stored, mentioned)
	return u.deliver(ctx, deliveries, err)
}

// EditReply changes the text of a reply.
func (u *CommentUseCase) EditReply(ctx context.Context, workspaceID, documentID, threadID, replyID, actorID uuid.UUID, content string) error {
	if workspaceID == uuid.Nil || documentID == uuid.Nil || threadID == uuid.Nil || replyID == uuid.Nil || actorID == uuid.Nil {
		return ErrInvalidComment
	}
	stored, mentioned, err := u.prepareContent(ctx, workspaceID, documentID, content)
	if err != nil {
		return err
	}
	deliveries, err := u.comments.UpdateCommentReply(ctx, workspaceID, documentID, threadID, replyID, actorID, stored, mentioned)
	return u.deliver(ctx, deliveries, err)
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
