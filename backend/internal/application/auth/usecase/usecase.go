package usecase

import (
	"strings"
	"time"

	appjwt "backend/internal/application/jwt"
	"backend/internal/domain/contract/mail"
	repocontract "backend/internal/domain/contract/repository"
	usecasecontract "backend/internal/domain/contract/usecase"
	"backend/internal/infrastructure/database"
	emailverificationrepo "backend/internal/infrastructure/repository/emailverification"
	userrepo "backend/internal/infrastructure/repository/user"
)

type RepositoryFactory func(database.Queryer) repocontract.UserRepository

type useCase struct {
	db      database.DB
	users   repocontract.UserRepository
	factory RepositoryFactory
	tokens  *appjwt.Manager

	verifications func(database.Queryer) repocontract.EmailVerificationRepository
	mailer        mail.Mailer
	appURL        string
}

// Option configures what the use case reaches beyond the database.
type Option func(*useCase)

// WithMailer lets the use case send verification links to the app at appURL.
func WithMailer(mailer mail.Mailer, appURL string) Option {
	return func(u *useCase) {
		u.mailer = mailer
		u.appURL = strings.TrimRight(appURL, "/")
	}
}

func NewUseCase(db database.DB, jwtSecret string, accessTokenTTL time.Duration, options ...Option) usecasecontract.AccountUseCase {
	return NewUseCaseWithFactory(db, jwtSecret, accessTokenTTL, func(q database.Queryer) repocontract.UserRepository {
		return userrepo.NewRepository(q)
	}, options...)
}

func NewUseCaseWithFactory(db database.DB, jwtSecret string, accessTokenTTL time.Duration, factory RepositoryFactory, options ...Option) *useCase {
	u := &useCase{
		db:      db,
		users:   factory(db),
		factory: factory,
		tokens:  appjwt.NewManager(jwtSecret, accessTokenTTL),
		verifications: func(q database.Queryer) repocontract.EmailVerificationRepository {
			return emailverificationrepo.NewRepository(q)
		},
	}
	for _, option := range options {
		option(u)
	}
	return u
}

func (u *useCase) SetNow(now func() time.Time) {
	u.tokens.SetNow(now)
}
