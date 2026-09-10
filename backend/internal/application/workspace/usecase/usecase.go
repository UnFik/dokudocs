package usecase

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"backend/internal/domain/contract/repository"
	usecasecontract "backend/internal/domain/contract/usecase"
	"backend/internal/infrastructure/database"
	userrepo "backend/internal/infrastructure/repository/user"
	workspacerepo "backend/internal/infrastructure/repository/workspace"
)

type useCase struct {
	workspaceRepo repository.WorkspaceRepository
	userRepo      repository.UserRepository
}

func NewUseCase(db database.DB) usecasecontract.WorkspaceUseCase {
	return NewUseCaseWithRepos(workspacerepo.NewRepository(db), userrepo.NewRepository(db))
}

func NewUseCaseWithRepos(workspaceRepo repository.WorkspaceRepository, userRepo repository.UserRepository) usecasecontract.WorkspaceUseCase {
	return &useCase{
		workspaceRepo: workspaceRepo,
		userRepo:      userRepo,
	}
}

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	reg := regexp.MustCompile("[^a-z0-9]+")
	s = reg.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		s = "workspace"
	}
	return fmt.Sprintf("%s-%d", s, time.Now().UnixNano()%100000)
}
