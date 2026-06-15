package seeders

import (
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestAdminSeedUsesKnownLocalCredential(t *testing.T) {
	if AdminUser.Email != "admin@example.com" {
		t.Fatalf("admin seed email = %q", AdminUser.Email)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(AdminUser.PasswordHash), []byte("password123")); err != nil {
		t.Fatalf("admin seed password hash does not match password123: %v", err)
	}
}
