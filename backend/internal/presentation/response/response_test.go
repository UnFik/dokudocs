package response

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestErrorUsesTitleContract(t *testing.T) {
	recorder := httptest.NewRecorder()
	Error(recorder, http.StatusUnauthorized, "invalid bearer token")
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", recorder.Code)
	}
	if recorder.Body.String() != "{\"title\":\"invalid bearer token\"}\n" {
		t.Fatalf("body = %q", recorder.Body.String())
	}
}

func TestDecodeJSONRejectsUnknownFields(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"email":"a@b.com","extra":true}`))
	var dst struct {
		Email string `json:"email"`
	}
	if err := DecodeJSON(request, &dst); err == nil {
		t.Fatal("expected unknown field error")
	}
}

func TestDecodeJSONRejectsEmptyBody(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(""))
	var dst struct{}
	if err := DecodeJSON(request, &dst); err == nil {
		t.Fatal("expected empty body error")
	}
}
