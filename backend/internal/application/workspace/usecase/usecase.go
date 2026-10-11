package usecase

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"backend/internal/domain/contract/mail"
	"backend/internal/domain/contract/repository"
	usecasecontract "backend/internal/domain/contract/usecase"
	"backend/internal/infrastructure/database"
	userrepo "backend/internal/infrastructure/repository/user"
	workspacerepo "backend/internal/infrastructure/repository/workspace"
)

type useCase struct {
	workspaceRepo repository.WorkspaceRepository
	userRepo      repository.UserRepository
	invites       repository.WorkspaceInviteRepository
	mailer        mail.Mailer
	appURL        string
}

type Option func(*useCase)

// WithMailer lets the use case mail invitation links to the app at appURL.
func WithMailer(mailer mail.Mailer, appURL string) Option {
	return func(u *useCase) {
		u.mailer = mailer
		u.appURL = strings.TrimRight(appURL, "/")
	}
}

// WithInviteRepository replaces the invitation store; tests use it.
func WithInviteRepository(invites repository.WorkspaceInviteRepository) Option {
	return func(u *useCase) { u.invites = invites }
}

func NewUseCase(db database.DB, opts ...Option) usecasecontract.WorkspaceUseCase {
	return NewUseCaseWithRepos(workspacerepo.NewRepository(db), userrepo.NewRepository(db), opts...)
}

func NewUseCaseWithRepos(workspaceRepo repository.WorkspaceRepository, userRepo repository.UserRepository, opts ...Option) usecasecontract.WorkspaceUseCase {
	u := &useCase{
		workspaceRepo: workspaceRepo,
		userRepo:      userRepo,
	}
	if invites, ok := workspaceRepo.(repository.WorkspaceInviteRepository); ok {
		u.invites = invites
	}
	for _, opt := range opts {
		opt(u)
	}
	return u
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
