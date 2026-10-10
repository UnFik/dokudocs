package jwt

import (
	"testing"
	"time"

	"backend/internal/domain/model"

	gojwt "github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func user(verified bool) model.AuthUser {
	return model.AuthUser{ID: uuid.New(), AccountNo: "ACC1", Email: "a@example.com", Roles: []string{"member"}, EmailVerified: verified}
}

func TestTokenCarriesWhetherTheEmailIsVerified(t *testing.T) {
	m := NewManager("test-secret", time.Hour)
	for _, verified := range []bool{true, false} {
		issued, err := m.Issue(user(verified))
		if err != nil {
			t.Fatal(err)
		}
		if issued.User.EmailVerified != verified {
			t.Fatalf("issued user: want verified=%v", verified)
		}
		got, err := m.Verify(issued.AccessToken)
		if err != nil {
			t.Fatal(err)
		}
		if got.EmailVerified != verified {
			t.Fatalf("verified token: want verified=%v, got %v", verified, got.EmailVerified)
		}
	}
}

func TestTokenWithoutTheClaimCountsAsUnverified(t *testing.T) {
	m := NewManager("test-secret", time.Hour)
	now := time.Now()
	old := gojwt.NewWithClaims(gojwt.SigningMethodHS256, gojwt.MapClaims{
		"accountNo": "ACC1", "email": "a@example.com", "role": []string{"member"},
		"sub": uuid.NewString(), "iat": now.Add(-time.Minute).Unix(), "exp": now.Add(time.Hour).Unix(),
	})
	signed, err := old.SignedString([]byte("test-secret"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := m.Verify(signed)
	if err != nil {
		t.Fatal(err)
	}
	if got.EmailVerified {
		t.Fatal("a token issued before the claim existed must count as unverified")
	}
}
