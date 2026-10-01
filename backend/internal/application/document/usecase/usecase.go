package usecase

import (
	"context"

	"backend/constant"
	"backend/internal/domain/contract/repository"
	usecasecontract "backend/internal/domain/contract/usecase"
	"backend/internal/domain/model"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/database"
	docrepo "backend/internal/infrastructure/repository/document"
	projectrepo "backend/internal/infrastructure/repository/project"
	userrepo "backend/internal/infrastructure/repository/user"
	workspacerepo "backend/internal/infrastructure/repository/workspace"

	"github.com/google/uuid"
)

type useCase struct {
	docRepo       repository.DocumentRepository
	workspaceRepo repository.WorkspaceRepository
	userRepo      repository.UserRepository
	projectRepo   repository.ProjectRepository
}

func NewUseCase(db database.DB) usecasecontract.DocumentUseCase {
	return NewUseCaseWithRepos(
		docrepo.NewRepository(db),
		workspacerepo.NewRepository(db),
		userrepo.NewRepository(db),
		projectrepo.NewRepository(db),
	)
}

func NewUseCaseWithRepos(
	docRepo repository.DocumentRepository,
	workspaceRepo repository.WorkspaceRepository,
	userRepo repository.UserRepository,
	projectRepo repository.ProjectRepository,
) usecasecontract.DocumentUseCase {
	return &useCase{
		docRepo:       docRepo,
		workspaceRepo: workspaceRepo,
		userRepo:      userRepo,
		projectRepo:   projectRepo,
	}
}

func (u *useCase) checkWorkspaceMembership(ctx context.Context, workspaceID, userID uuid.UUID) (string, error) {
	role, err := u.workspaceRepo.GetUserRole(ctx, workspaceID, userID)
	if err != nil {
		return "", constant.ErrForbidden
	}
	return role, nil
}

func (u *useCase) checkProjectWorkspace(ctx context.Context, projectID *uuid.UUID, workspaceID, userID uuid.UUID) error {
	if projectID == nil {
		return nil
	}
	project, err := u.projectRepo.GetByID(ctx, *projectID, userID)
	if err != nil {
		return err
	}
	if project.WorkspaceID != workspaceID {
		return constant.ErrProjectNotFound
	}
	workspaceRole, err := u.checkWorkspaceMembership(ctx, workspaceID, userID)
	if err != nil {
		return err
	}
	if !policy.CanPlaceDocumentInProject(project.Visibility, project.Role, workspaceRole) {
		return constant.ErrForbidden
	}
	return nil
}

func sameProject(left, right *uuid.UUID) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func (u *useCase) canManageDoc(ctx context.Context, doc model.Document, workspaceID, userID uuid.UUID) (bool, error) {
	if doc.WorkspaceID != workspaceID {
		return false, constant.ErrDocumentNotFound
	}
	wsRole, err := u.checkWorkspaceMembership(ctx, workspaceID, userID)
	if err != nil {
		return false, err
	}
	access, err := u.resolveDocumentAccess(ctx, doc, wsRole, userID)
	if err != nil {
		return false, err
	}
	return policy.CanEditDocument(doc, access), nil
}
