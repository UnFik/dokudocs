package usecase

import (
	"context"

	"backend/constant"
	"backend/internal/domain/contract/repository"
	usecasecontract "backend/internal/domain/contract/usecase"
	"backend/internal/domain/model"
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

func (u *useCase) canManageDoc(ctx context.Context, doc model.Document, workspaceID, userID uuid.UUID) (bool, error) {
	if doc.AuthorID == userID {
		return true, nil
	}
	wsRole, err := u.workspaceRepo.GetUserRole(ctx, workspaceID, userID)
	if err == nil && (wsRole == "owner" || wsRole == "admin") {
		return true, nil
	}
	if doc.ProjectID != nil {
		projRole, err := u.projectRepo.GetUserRole(ctx, *doc.ProjectID, userID)
		if err == nil && (projRole == "manager" || projRole == "editor") {
			return true, nil
		}
	}
	accessLevel, err := u.docRepo.GetUserAccessLevel(ctx, doc.ID, userID)
	if err == nil && (accessLevel == "owner" || accessLevel == "edit") {
		return true, nil
	}
	return false, nil
}
