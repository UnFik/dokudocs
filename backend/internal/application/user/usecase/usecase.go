package usecase

import (
	"backend/internal/domain/contract/repository"
	usecasecontract "backend/internal/domain/contract/usecase"
	"backend/internal/infrastructure/database"
	userrepo "backend/internal/infrastructure/repository/user"
)

type useCase struct {
	repo repository.UserRepository
}

func NewUseCase(db database.DB) usecasecontract.UserUseCase {
	return NewUseCaseWithRepo(userrepo.NewRepository(db))
}

func NewUseCaseWithRepo(repo repository.UserRepository) usecasecontract.UserUseCase {
	return &useCase{repo: repo}
}
