package usecase

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"backend/internal/domain/contract/repository"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

var ErrInvalidSuggestion = errors.New("invalid suggestion")

type SuggestionUseCase struct {
	suggestionRepo repository.SuggestionRepository
}

func NewSuggestionUseCase(suggestionRepo repository.SuggestionRepository) *SuggestionUseCase {
	return &SuggestionUseCase{suggestionRepo: suggestionRepo}
}

func (u *SuggestionUseCase) List(ctx context.Context, workspaceID, documentID, actorID uuid.UUID) ([]model.DocumentSuggestion, error) {
	if workspaceID == uuid.Nil || documentID == uuid.Nil || actorID == uuid.Nil {
		return nil, ErrInvalidSuggestion
	}
	return u.suggestionRepo.ListSuggestions(ctx, workspaceID, documentID, actorID)
}

// MaxSuggestionReplyLength bounds one reply, counted in characters.
const MaxSuggestionReplyLength = 2000

type SuggestionReplyInput struct {
	WorkspaceID  uuid.UUID
	DocumentID   uuid.UUID
	SuggestionID uuid.UUID
	ReplyID      uuid.UUID
	AuthorID     uuid.UUID
	Body         string
}

func (u *SuggestionUseCase) Reply(ctx context.Context, input SuggestionReplyInput) error {
	body := strings.TrimSpace(input.Body)
	if input.WorkspaceID == uuid.Nil || input.DocumentID == uuid.Nil || input.SuggestionID == uuid.Nil ||
		input.ReplyID == uuid.Nil || input.AuthorID == uuid.Nil || body == "" ||
		utf8.RuneCountInString(body) > MaxSuggestionReplyLength {
		return ErrInvalidSuggestion
	}
	return u.suggestionRepo.CreateSuggestionReply(ctx, input.WorkspaceID, model.SuggestionReply{
		DocumentID: input.DocumentID, SuggestionID: input.SuggestionID, ReplyID: input.ReplyID,
		AuthorID: input.AuthorID, Body: body,
	})
}

// Resolve closes a suggestion's thread, or reopens it when resolved is false.
func (u *SuggestionUseCase) Resolve(ctx context.Context, workspaceID, documentID, suggestionID, actorID uuid.UUID, resolved bool) error {
	if workspaceID == uuid.Nil || documentID == uuid.Nil || suggestionID == uuid.Nil || actorID == uuid.Nil {
		return ErrInvalidSuggestion
	}
	return u.suggestionRepo.SetSuggestionResolved(ctx, workspaceID, documentID, suggestionID, actorID, resolved)
}
