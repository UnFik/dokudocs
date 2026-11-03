package routes

import (
	"net/http"
	"testing"

	"backend/internal/config"
)

const pdfPath = "/api/v1/documents/6b1f6b0e-3a8d-4a63-9a53-0d3a4b5c6d7e/export/pdf"

func TestPDFExportNeedsASignInAndHasItsOwnRateLimitPerClient(t *testing.T) {
	h := authRoutes(config.Config{RateLimitExportPDFPerMin: 2})
	if got := post(h, pdfPath, "203.0.113.5:1"); got != http.StatusUnauthorized {
		t.Fatalf("first request with no sign-in: want 401, got %d", got)
	}
	if got := post(h, pdfPath, "203.0.113.5:2"); got != http.StatusUnauthorized {
		t.Fatalf("second request: want 401, got %d", got)
	}
	if got := post(h, pdfPath, "203.0.113.5:3"); got != http.StatusTooManyRequests {
		t.Fatalf("third request: want 429, got %d", got)
	}
	if got := post(h, pdfPath, "198.51.100.9:1"); got != http.StatusUnauthorized {
		t.Fatalf("another client is unaffected: want 401, got %d", got)
	}
}

func TestPDFExportLimitDoesNotTouchOtherDocumentRoutes(t *testing.T) {
	h := authRoutes(config.Config{RateLimitExportPDFPerMin: 1})
	post(h, pdfPath, "203.0.113.5:1")
	post(h, pdfPath, "203.0.113.5:2")
	if got := post(h, "/api/v1/documents/6b1f6b0e-3a8d-4a63-9a53-0d3a4b5c6d7e/page", "203.0.113.5:3"); got == http.StatusTooManyRequests {
		t.Fatal("the PDF limit limited another route")
	}
}

func TestZeroPDFLimitTurnsItOff(t *testing.T) {
	h := authRoutes(config.Config{})
	for i := 0; i < 30; i++ {
		if got := post(h, pdfPath, "203.0.113.5:1"); got == http.StatusTooManyRequests {
			t.Fatalf("request %d was limited with no limit configured", i+1)
		}
	}
}
