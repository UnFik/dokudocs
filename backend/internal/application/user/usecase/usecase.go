package usecase

import (
	"backend/internal/domain/contract/repository"
	usecasecontract "backend/internal/domain/contract/usecase"
	"backend/internal/infrastructure/database"
	userrepo "backend/internal/infrastructure/repository/user"
)

type useCase struct {
	repo    repository.UserRepository
	avatars repository.AvatarRepository
	store   repository.AvatarStore
}

// Option configures what the use case reaches beyond the database.
type Option func(*useCase)

// WithAvatarStore is where uploaded avatars are kept.
func WithAvatarStore(store repository.AvatarStore) Option {
	return func(u *useCase) { u.store = store }
}

func NewUseCase(db database.DB, options ...Option) usecasecontract.UserUseCase {
	return NewUseCaseWithRepo(userrepo.NewRepository(db), options...)
}

func NewUseCaseWithRepo(repo repository.UserRepository, options ...Option) usecasecontract.UserUseCase {
	u := &useCase{repo: repo}
	u.avatars, _ = repo.(repository.AvatarRepository)
	for _, option := range options {
		option(u)
	}
	return u
}
