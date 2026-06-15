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
	"backend/internal/domain/model"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

type fakeDB struct{ database.Queryer }

type fakeUserStore struct {
	user model.AuthUser
	err  error
}

func (s fakeUserStore) FindByEmail(context.Context, string) (model.AuthUser, error) {
	return s.user, s.err
}

func (fakeDB) WithTransaction(context.Context, func(database.Queryer) error) error { return nil }
func (fakeDB) Raw() *sql.DB                                                        { return nil }
func (fakeDB) Close() error                                                        { return nil }

func testUseCase(t *testing.T) (*useCase, model.AuthUser) {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte("password123"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	user := model.AuthUser{
		ID:           uuid.MustParse("00000000-0000-0000-0000-000000000001"),
		AccountNo:    "ACC001",
		Email:        "admin@example.com",
		PasswordHash: string(hash),
		Roles:        []string{"admin"},
		CreatedAt:    time.Unix(1, 0),
		UpdatedAt:    time.Unix(1, 0),
	}
	uc := NewUseCaseWithFactory(fakeDB{}, "secret", time.Hour, func(database.Queryer) repocontract.UserRepository {
		return fakeUserStore{user: user}
	})
	uc.SetNow(func() time.Time { return time.Unix(1_700_000_000, 0) })
	return uc, user
}

func TestLoginSuccessIssuesTokenAndUser(t *testing.T) {
	uc, _ := testUseCase(t)
	resp, err := uc.Login(context.Background(), dto.LoginRequest{Email: " ADMIN@example.COM ", Password: "password123"})
	if err != nil {
		t.Fatalf("Login() error = %v", err)
	}
	if resp.AccessToken == "" {
		t.Fatal("AccessToken empty")
	}
	if resp.User.AccountNo != "ACC001" || resp.User.Email != "admin@example.com" || resp.User.Exp != 1_700_003_600 {
		t.Fatalf("unexpected user: %#v", resp.User)
	}
	verified, err := uc.VerifyToken(resp.AccessToken)
	if err != nil {
		t.Fatalf("VerifyToken() error = %v", err)
	}
	if verified.Email != resp.User.Email || verified.Exp != resp.User.Exp {
		t.Fatalf("verified = %#v; want %#v", verified, resp.User)
	}
}

func TestLoginWrongPassword(t *testing.T) {
	uc, _ := testUseCase(t)
	_, err := uc.Login(context.Background(), dto.LoginRequest{Email: "admin@example.com", Password: "wrongpass"})
	if !errors.Is(err, constant.ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials, got %v", err)
	}
}

func TestLoginUnknownEmail(t *testing.T) {
	uc := NewUseCaseWithFactory(fakeDB{}, "secret", time.Hour, func(database.Queryer) repocontract.UserRepository {
		return fakeUserStore{err: sql.ErrNoRows}
	})
	_, err := uc.Login(context.Background(), dto.LoginRequest{Email: "missing@example.com", Password: "password123"})
	if !errors.Is(err, constant.ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials, got %v", err)
	}
}

func TestLoginMissingCredential(t *testing.T) {
	uc, _ := testUseCase(t)
	_, err := uc.Login(context.Background(), dto.LoginRequest{})
	if !errors.Is(err, constant.ErrMissingCredential) {
		t.Fatalf("expected ErrMissingCredential, got %v", err)
	}
}

func TestVerifyTokenRejectsInvalidToken(t *testing.T) {
	uc, _ := testUseCase(t)
	_, err := uc.VerifyToken("not-a-token")
	if !errors.Is(err, constant.ErrInvalidToken) {
		t.Fatalf("expected ErrInvalidToken, got %v", err)
	}
}
