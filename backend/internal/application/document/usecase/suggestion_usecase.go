package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	"backend/constant"
	"backend/internal/application/collaboration"
	"backend/internal/domain/contract/repository"
	"backend/internal/domain/model"
	"backend/internal/domain/policy"

	"github.com/google/uuid"
)

var (
	ErrInvalidSuggestion  = errors.New("invalid suggestion")
	ErrSuggestionHidden   = errors.New("suggestion is not visible")
	ErrSuggestionDecision = errors.New("suggestion decision is not allowed")
)

type SuggestionInput struct {
	WorkspaceID            uuid.UUID
	DocumentID             uuid.UUID
	SuggestionID           uuid.UUID
	ProposerID             uuid.UUID
	BaseBodyVersion        int64
	BaseBodyEpoch          int64
	OperationSchemaVersion int
	Provenance             string
	Operations             json.RawMessage
	Summary                string
	Reason                 string
}

type SuggestionUseCase struct {
	docRepo        repository.DocumentRepository
	suggestionRepo repository.SuggestionRepository
	workspaceRepo  repository.WorkspaceRepository
	projectRepo    repository.ProjectRepository
}

func NewSuggestionUseCase(
	docRepo repository.DocumentRepository,
	suggestionRepo repository.SuggestionRepository,
	workspaceRepo repository.WorkspaceRepository,
	projectRepo repository.ProjectRepository,
) *SuggestionUseCase {
	return &SuggestionUseCase{docRepo: docRepo, suggestionRepo: suggestionRepo, workspaceRepo: workspaceRepo, projectRepo: projectRepo}
}

func (u *SuggestionUseCase) Propose(ctx context.Context, input SuggestionInput) error {
	if input.WorkspaceID == uuid.Nil || input.DocumentID == uuid.Nil || input.SuggestionID == uuid.Nil || input.ProposerID == uuid.Nil ||
		input.BaseBodyVersion < 1 || input.BaseBodyEpoch < 1 || input.OperationSchemaVersion < 1 ||
		(input.Provenance != "human" && input.Provenance != "AI") || len(input.Operations) == 0 || !json.Valid(input.Operations) {
		return ErrInvalidSuggestion
	}
	doc, err := u.docRepo.GetByID(ctx, input.DocumentID, input.ProposerID)
	if err != nil {
		return err
	}
	if doc.WorkspaceID != input.WorkspaceID {
		return constant.ErrDocumentNotFound
	}
	access, err := u.access(ctx, doc, input.ProposerID)
	if err != nil {
		return err
	}
	if !policy.CanSuggest(doc, access) {
		return constant.ErrForbidden
	}
	return u.suggestionRepo.CreateSuggestion(ctx, input.WorkspaceID, model.DocumentSuggestion{
		DocumentID: doc.ID, SuggestionID: input.SuggestionID, ProposerID: input.ProposerID,
		BaseBodyVersion: input.BaseBodyVersion, BaseBodyEpoch: input.BaseBodyEpoch,
		OperationSchemaVersion: input.OperationSchemaVersion, Provenance: input.Provenance,
		Operations: input.Operations, Summary: input.Summary, Reason: input.Reason,
	})
}

func (u *SuggestionUseCase) List(ctx context.Context, workspaceID, documentID, actorID uuid.UUID) ([]model.DocumentSuggestion, error) {
	if workspaceID == uuid.Nil || documentID == uuid.Nil || actorID == uuid.Nil {
		return nil, ErrInvalidSuggestion
	}
	return u.suggestionRepo.ListSuggestions(ctx, workspaceID, documentID, actorID)
}

func (u *SuggestionUseCase) Reject(ctx context.Context, workspaceID, documentID, suggestionID, actorID uuid.UUID) error {
	if workspaceID == uuid.Nil || documentID == uuid.Nil || suggestionID == uuid.Nil || actorID == uuid.Nil {
		return ErrInvalidSuggestion
	}
	doc, err := u.docRepo.GetByID(ctx, documentID, actorID)
	if err != nil {
		return err
	}
	if doc.WorkspaceID != workspaceID {
		return constant.ErrDocumentNotFound
	}
	access, err := u.access(ctx, doc, actorID)
	if err != nil {
		return err
	}
	// The repository lets a proposer withdraw only their own suggestion.
	if !policy.CanDecideSuggestion(doc, access) && !policy.CanSuggest(doc, access) {
		return ErrSuggestionDecision
	}
	return u.suggestionRepo.RejectSuggestion(ctx, workspaceID, documentID, suggestionID, actorID)
}

func (u *SuggestionUseCase) Accept(ctx context.Context, workspaceID, documentID, suggestionID, actorID uuid.UUID) error {
	if workspaceID == uuid.Nil || documentID == uuid.Nil || suggestionID == uuid.Nil || actorID == uuid.Nil {
		return ErrInvalidSuggestion
	}
	doc, err := u.docRepo.GetByID(ctx, documentID, actorID)
	if err != nil {
		return err
	}
	if doc.WorkspaceID != workspaceID {
		return constant.ErrDocumentNotFound
	}
	access, err := u.access(ctx, doc, actorID)
	if err != nil {
		return err
	}
	if !policy.CanDecideSuggestion(doc, access) {
		return ErrSuggestionDecision
	}
	if err := u.suggestionRepo.AcceptSuggestion(ctx, workspaceID, documentID, suggestionID, actorID); err != nil {
		if errors.Is(err, collaboration.ErrSuggestionConflict) {
			return collaboration.ErrSuggestionConflict
		}
		return err
	}
	return nil
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

func (u *SuggestionUseCase) access(ctx context.Context, doc model.Document, actorID uuid.UUID) (policy.DocumentAccessContext, error) {
	role, err := u.workspaceRepo.GetUserRole(ctx, doc.WorkspaceID, actorID)
	if err != nil {
		return policy.DocumentAccessContext{}, constant.ErrForbidden
	}
	grant, err := u.docRepo.GetUserAccessLevel(ctx, doc.ID, actorID)
	if err != nil && !errors.Is(err, constant.ErrAccessNotFound) {
		return policy.DocumentAccessContext{}, err
	}
	access := policy.DocumentAccessContext{UserID: actorID, WorkspaceRole: role}
	if err == nil {
		access.DocumentGrant = grant
	}
	if doc.ProjectID != nil {
		project, projectErr := u.projectRepo.GetByID(ctx, *doc.ProjectID, actorID)
		if projectErr != nil && !errors.Is(projectErr, constant.ErrProjectNotFound) {
			return policy.DocumentAccessContext{}, projectErr
		}
		if projectErr == nil && project.WorkspaceID == doc.WorkspaceID && project.DeletedAt == nil {
			access.ProjectVisibility, access.ProjectRole = project.Visibility, project.Role
		}
	}
	return access, nil
}
