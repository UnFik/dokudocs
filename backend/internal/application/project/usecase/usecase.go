package usecase

import (
	"context"

	"backend/constant"
	"backend/internal/domain/contract/repository"
	usecasecontract "backend/internal/domain/contract/usecase"
	"backend/internal/infrastructure/database"
	projectrepo "backend/internal/infrastructure/repository/project"
	userrepo "backend/internal/infrastructure/repository/user"
	workspacerepo "backend/internal/infrastructure/repository/workspace"

	"github.com/google/uuid"
)

type useCase struct {
	projectRepo   repository.ProjectRepository
	workspaceRepo repository.WorkspaceRepository
	userRepo      repository.UserRepository
}

func NewUseCase(db database.DB) usecasecontract.ProjectUseCase {
	return NewUseCaseWithRepos(
		projectrepo.NewRepository(db),
		workspacerepo.NewRepository(db),
		userrepo.NewRepository(db),
	)
}

func NewUseCaseWithRepos(
	projectRepo repository.ProjectRepository,
	workspaceRepo repository.WorkspaceRepository,
	userRepo repository.UserRepository,
) usecasecontract.ProjectUseCase {
	return &useCase{
		projectRepo:   projectRepo,
		workspaceRepo: workspaceRepo,
		userRepo:      userRepo,
	}
}

func (u *useCase) checkWorkspaceMembership(ctx context.Context, workspaceID, userID uuid.UUID) (string, error) {
	role, err := u.workspaceRepo.GetUserRole(ctx, workspaceID, userID)
	if err != nil {
		return "", constant.ErrForbidden
	}
	return role, nil
}

func (u *useCase) canManageProject(ctx context.Context, projectID, workspaceID, userID uuid.UUID) (bool, error) {
	wsRole, err := u.workspaceRepo.GetUserRole(ctx, workspaceID, userID)
	if err == nil && (wsRole == "owner" || wsRole == "admin") {
		return true, nil
	}
	projRole, err := u.projectRepo.GetUserRole(ctx, projectID, userID)
	if err == nil && projRole == "manager" {
		return true, nil
	}
	return false, nil
}

func (u *useCase) canEditProject(ctx context.Context, projectID, workspaceID, userID uuid.UUID) (bool, error) {
	wsRole, err := u.workspaceRepo.GetUserRole(ctx, workspaceID, userID)
	if err == nil && (wsRole == "owner" || wsRole == "admin") {
		return true, nil
	}
	projRole, err := u.projectRepo.GetUserRole(ctx, projectID, userID)
	if err == nil && (projRole == "manager" || projRole == "editor") {
		return true, nil
	}
	return false, nil
}
