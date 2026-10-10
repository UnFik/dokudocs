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
	identityrepo "backend/internal/infrastructure/repository/identity"
	oauthtransactionrepo "backend/internal/infrastructure/repository/oauthtransaction"
	passwordtokenrepo "backend/internal/infrastructure/repository/passwordtoken"
	userrepo "backend/internal/infrastructure/repository/user"
)

type RepositoryFactory func(database.Queryer) repocontract.UserRepository

type useCase struct {
	db      database.DB
	users   repocontract.UserRepository
	factory RepositoryFactory
	tokens  *appjwt.Manager

	passwordTokens func(database.Queryer) repocontract.PasswordTokenRepository
	verifications  func(database.Queryer) repocontract.EmailVerificationRepository
	transactions   func(database.Queryer) repocontract.OAuthTransactionRepository
	identities     func(database.Queryer) repocontract.IdentityRepository
	providers      map[string]repocontract.IdentityProvider
	mailer         mail.Mailer
	appURL         string
}

// WithIdentityProvider lets Users sign in, and link accounts, with a provider.
func WithIdentityProvider(name string, provider repocontract.IdentityProvider) Option {
	return func(u *useCase) {
		if provider != nil {
			u.providers[name] = provider
		}
	}
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
		passwordTokens: func(q database.Queryer) repocontract.PasswordTokenRepository {
			return passwordtokenrepo.NewRepository(q)
		},
		transactions: func(q database.Queryer) repocontract.OAuthTransactionRepository {
			return oauthtransactionrepo.NewRepository(q)
		},
		identities: func(q database.Queryer) repocontract.IdentityRepository {
			return identityrepo.NewRepository(q)
		},
		providers: map[string]repocontract.IdentityProvider{},
	}
	for _, option := range options {
		option(u)
	}
	return u
}

func (u *useCase) SetNow(now func() time.Time) {
	u.tokens.SetNow(now)
}
