package usecase

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"backend/constant"
	"backend/internal/application/auth/dto"
	repocontract "backend/internal/domain/contract/repository"
	"backend/internal/infrastructure/database"
)

func TestRegisterSuccess(t *testing.T) {
	uc := NewUseCaseWithFactory(fakeDB{}, "secret", time.Hour, func(database.Queryer) repocontract.UserRepository {
		return fakeUserStore{err: sql.ErrNoRows} // no existing user
	})
	resp, err := uc.Register(context.Background(), dto.RegisterRequest{
		Email:    "newuser@example.com",
		Password: "password123",
		FullName: "New User",
	})
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}
	if resp.AccessToken == "" {
		t.Fatal("expected accessToken")
	}
	if resp.User.Email != "newuser@example.com" {
		t.Fatalf("expected newuser@example.com, got %s", resp.User.Email)
	}
}

func TestRegisterEmailExists(t *testing.T) {
	uc, user := testUseCase(t)
	_ = user
	_, err := uc.Register(context.Background(), dto.RegisterRequest{
		Email:    "admin@example.com",
		Password: "password123",
	})
	if !errors.Is(err, constant.ErrEmailAlreadyExists) {
		t.Fatalf("expected ErrEmailAlreadyExists, got %v", err)
	}
}
