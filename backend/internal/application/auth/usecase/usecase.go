package usecase

import (
	"time"

	appjwt "backend/internal/application/jwt"
	repocontract "backend/internal/domain/contract/repository"
	usecasecontract "backend/internal/domain/contract/usecase"
	"backend/internal/infrastructure/database"
	userrepo "backend/internal/infrastructure/repository/user"
)

type RepositoryFactory func(database.Queryer) repocontract.UserRepository

type useCase struct {
	users  repocontract.UserRepository
	tokens *appjwt.Manager
}

func NewUseCase(db database.DB, jwtSecret string, accessTokenTTL time.Duration) usecasecontract.AuthUseCase {
	return NewUseCaseWithFactory(db, jwtSecret, accessTokenTTL, func(q database.Queryer) repocontract.UserRepository {
		return userrepo.NewRepository(q)
	})
}

func NewUseCaseWithFactory(db database.DB, jwtSecret string, accessTokenTTL time.Duration, factory RepositoryFactory) *useCase {
	return &useCase{
		users:  factory(db),
		tokens: appjwt.NewManager(jwtSecret, accessTokenTTL),
	}
}

func (u *useCase) SetNow(now func() time.Time) {
	u.tokens.SetNow(now)
}
