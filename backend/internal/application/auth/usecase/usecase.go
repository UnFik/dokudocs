package usecase

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"backend/constant"
	"backend/internal/application/auth/dto"
	appjwt "backend/internal/application/jwt"
	"backend/internal/application/utils"
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

func (u *useCase) Login(ctx context.Context, req dto.LoginRequest) (dto.LoginResponse, error) {
	email := strings.TrimSpace(strings.ToLower(req.Email))
	if email == "" || strings.TrimSpace(req.Password) == "" {
		return dto.LoginResponse{}, constant.ErrMissingCredential
	}

	user, err := u.users.FindByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dto.LoginResponse{}, constant.ErrInvalidCredentials
		}
		return dto.LoginResponse{}, err
	}
	if !utils.ComparePasswordHash(user.PasswordHash, req.Password) {
		return dto.LoginResponse{}, constant.ErrInvalidCredentials
	}
	return u.tokens.Issue(user)
}

func (u *useCase) VerifyToken(tokenString string) (dto.ResponseUser, error) {
	return u.tokens.Verify(tokenString)
}
