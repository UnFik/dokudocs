package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"backend/internal/application/auth/dto"
)

func gated(enabled bool, user dto.ResponseUser, signedIn bool) *httptest.ResponseRecorder {
	h := RequireVerifiedEmail(enabled)(okHandler())
	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil)
	if signedIn {
		req = req.WithContext(ContextWithUser(req.Context(), user))
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestUnverifiedEmailIsRefusedWhenTheGateIsOn(t *testing.T) {
	rec := gated(true, dto.ResponseUser{EmailVerified: false}, true)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", rec.Code)
	}
	var body struct {
		Title string `json:"title"`
		Code  string `json:"code"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body.Code != "email_not_verified" {
		t.Fatalf("clients need a stable code to show the verification page, got %s", rec.Body.String())
	}
}

func TestVerifiedEmailPassesTheGate(t *testing.T) {
	if got := gated(true, dto.ResponseUser{EmailVerified: true}, true).Code; got != http.StatusNoContent {
		t.Fatalf("want 204, got %d", got)
	}
}

func TestGateOffLetsUnverifiedEmailThrough(t *testing.T) {
	if got := gated(false, dto.ResponseUser{EmailVerified: false}, true).Code; got != http.StatusNoContent {
		t.Fatalf("want 204, got %d", got)
	}
}

func TestGateRefusesARequestWithNoUser(t *testing.T) {
	if got := gated(true, dto.ResponseUser{}, false).Code; got != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", got)
	}
}
