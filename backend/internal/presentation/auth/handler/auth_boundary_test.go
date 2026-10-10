package handler

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	appauth "backend/internal/application/auth/usecase"
	repocontract "backend/internal/domain/contract/repository"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/database"
	"backend/internal/infrastructure/validator"
	"backend/internal/presentation/middleware"

	jwt "github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type authBoundaryDB struct{ database.Queryer }

func (authBoundaryDB) WithTransaction(context.Context, func(database.Queryer) error) error {
	return nil
}
func (authBoundaryDB) Raw() *sql.DB { return nil }
func (authBoundaryDB) Close() error { return nil }

type authBoundaryUsers struct{}

func (authBoundaryUsers) FindByEmail(context.Context, string) (model.AuthUser, error) {
	return model.AuthUser{}, sql.ErrNoRows
}
func (authBoundaryUsers) FindByID(context.Context, uuid.UUID) (model.UserProfile, error) {
	return model.UserProfile{}, sql.ErrNoRows
}
func (authBoundaryUsers) Create(context.Context, model.AuthUser, string) error { return nil }
func (authBoundaryUsers) UpdateProfile(context.Context, uuid.UUID, string, string, string) error {
	return nil
}
func (authBoundaryUsers) GetSettings(context.Context, uuid.UUID) (model.UserSettings, error) {
	return model.UserSettings{}, nil
}
func (authBoundaryUsers) UpdateSettings(context.Context, model.UserSettings) error { return nil }
func (authBoundaryUsers) Search(context.Context, string, int) ([]model.UserSummary, error) {
	return nil, nil
}

func (authBoundaryUsers) MarkEmailVerified(context.Context, uuid.UUID) error { return nil }

func newAuthBoundaryHandler() *Handler {
	var _ repocontract.UserRepository = authBoundaryUsers{}
	uc := appauth.NewUseCaseWithFactory(authBoundaryDB{}, "test-secret", time.Hour, func(database.Queryer) repocontract.UserRepository {
		return authBoundaryUsers{}
	})
	uc.SetNow(func() time.Time { return time.Unix(1_700_000_000, 0) })
	return NewHandler(uc, validator.New())
}

func TestRegisterHandlerRejectsRegistrationRules(t *testing.T) {
	for name, body := range map[string]string{
		"invalid email":  `{"email":"not-an-email","password":"password123456789","fullName":"Valid Name"}`,
		"short name":     `{"email":"user@example.com","password":"password123456789","fullName":"A"}`,
		"short password": `{"email":"user@example.com","password":"short","fullName":"Valid Name"}`,
	} {
		t.Run(name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			newAuthBoundaryHandler().Register(recorder, httptest.NewRequest(http.MethodPost, "/auth/register", strings.NewReader(body)))
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
			}
		})
	}
}

func TestMeRejectsJWTWithoutExpiryAtHTTPSeam(t *testing.T) {
	malformed := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":       uuid.NewString(),
		"accountNo": "ACC123",
		"email":     "user@example.com",
		"role":      []string{"member"},
	})
	token, err := malformed.SignedString([]byte("test-secret"))
	if err != nil {
		t.Fatal(err)
	}

	h := newAuthBoundaryHandler()
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	middleware.ValidateToken(h.service)(http.HandlerFunc(h.Me)).ServeHTTP(recorder, req)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
}
