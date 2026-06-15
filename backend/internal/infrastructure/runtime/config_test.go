package runtime

import (
	"strings"
	"testing"
	"time"
)

func TestLoadConfigRequiresDatabaseURL(t *testing.T) {
	t.Setenv("JWT_SECRET", "secret")
	_, err := LoadConfig()
	if err == nil || err.Error() != "DATABASE_URL is required" {
		t.Fatalf("expected DATABASE_URL error, got %v", err)
	}
}

func TestLoadConfigRequiresJWTSecret(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	_, err := LoadConfig()
	if err == nil || err.Error() != "JWT_SECRET is required" {
		t.Fatalf("expected JWT_SECRET error, got %v", err)
	}
}

func TestLoadConfigDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("JWT_SECRET", "secret")
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if cfg.Addr != ":8080" || cfg.AllowedOrigin != "http://localhost:5173" {
		t.Fatalf("unexpected defaults: %#v", cfg)
	}
	if cfg.AccessTokenTTL != 24*time.Hour || cfg.ReadTimeout != 5*time.Second || cfg.WriteTimeout != 10*time.Second || cfg.IdleTimeout != time.Minute || cfg.ShutdownTimeout != 10*time.Second {
		t.Fatalf("unexpected duration defaults: %#v", cfg)
	}
}

func TestLoadConfigRejectsBadDuration(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("JWT_SECRET", "secret")
	t.Setenv("ACCESS_TOKEN_TTL", "nope")
	_, err := LoadConfig()
	if err == nil || !strings.HasPrefix(err.Error(), "ACCESS_TOKEN_TTL") {
		t.Fatalf("expected ACCESS_TOKEN_TTL error, got %v", err)
	}
}
