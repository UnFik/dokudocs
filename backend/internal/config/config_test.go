package config

import (
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
	if cfg.RAGRequestTimeout != 2*time.Minute || cfg.RAGAnswerModel != "gpt-5-mini" || cfg.RAGEmbeddingModel != "text-embedding-3-small" {
		t.Fatalf("unexpected RAG defaults: %#v", cfg)
	}
}

func TestLoadConfigFallbackOnBadDuration(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("JWT_SECRET", "secret")
	t.Setenv("ACCESS_TOKEN_TTL", "nope")
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("expected fallback on bad duration, got error: %v", err)
	}
	if cfg.AccessTokenTTL != 24*time.Hour {
		t.Fatalf("expected fallback 24h, got %v", cfg.AccessTokenTTL)
	}
}

func TestLoadConfigDatabasePoolDefaultsKeepTodaysSizing(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("JWT_SECRET", "secret")
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if cfg.DBMaxOpenConns != 10 || cfg.DBMaxIdleConns != 10 || cfg.DBConnMaxLifetime != 30*time.Minute {
		t.Fatalf("pool defaults = %d/%d/%s, want 10/10/30m", cfg.DBMaxOpenConns, cfg.DBMaxIdleConns, cfg.DBConnMaxLifetime)
	}
}

func TestLoadConfigDatabasePoolIsTunableFromTheEnvironment(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("JWT_SECRET", "secret")
	t.Setenv("DB_MAX_OPEN_CONNS", "40")
	t.Setenv("DB_MAX_IDLE_CONNS", "20")
	t.Setenv("DB_CONN_MAX_LIFETIME", "5m")
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if cfg.DBMaxOpenConns != 40 || cfg.DBMaxIdleConns != 20 || cfg.DBConnMaxLifetime != 5*time.Minute {
		t.Fatalf("pool = %d/%d/%s, want 40/20/5m", cfg.DBMaxOpenConns, cfg.DBMaxIdleConns, cfg.DBConnMaxLifetime)
	}
}

func TestLoadConfigIdleConnsNeverExceedOpenConns(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("JWT_SECRET", "secret")
	t.Setenv("DB_MAX_OPEN_CONNS", "8")
	t.Setenv("DB_MAX_IDLE_CONNS", "30")
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if cfg.DBMaxIdleConns != 8 {
		t.Fatalf("idle = %d, want clamped to open = 8", cfg.DBMaxIdleConns)
	}
}

func TestLoadConfigReadsTheCollaborationServiceSecret(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("JWT_SECRET", "secret")
	if cfg, err := LoadConfig(); err != nil || cfg.CollabServiceSecret != "" {
		t.Fatalf("without the variable = (%q, %v), want the endpoints off (empty secret)", cfg.CollabServiceSecret, err)
	}
	t.Setenv("COLLAB_SERVICE_SECRET", "shared")
	cfg, err := LoadConfig()
	if err != nil || cfg.CollabServiceSecret != "shared" {
		t.Fatalf("with the variable = (%q, %v), want shared", cfg.CollabServiceSecret, err)
	}
}

func TestLoadConfigReadsTheCollaborationServiceURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("JWT_SECRET", "secret")
	if cfg, err := LoadConfig(); err != nil || cfg.CollabServiceURL != "" {
		t.Fatalf("without the variable = (%q, %v), want empty (no reload calls)", cfg.CollabServiceURL, err)
	}
	t.Setenv("COLLAB_SERVICE_URL", "http://collab:1234")
	if cfg, err := LoadConfig(); err != nil || cfg.CollabServiceURL != "http://collab:1234" {
		t.Fatalf("with the variable = (%q, %v), want the URL", cfg.CollabServiceURL, err)
	}
}

func TestLoadConfigServesMetricsOnlyWhenAnAddressIsSet(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("JWT_SECRET", "secret")
	cfg, err := LoadConfig()
	if err != nil || cfg.MetricsAddr != "" {
		t.Fatalf("MetricsAddr = %q, %v; want off by default", cfg.MetricsAddr, err)
	}
	t.Setenv("METRICS_ADDR", ":9091")
	cfg, err = LoadConfig()
	if err != nil || cfg.MetricsAddr != ":9091" {
		t.Fatalf("MetricsAddr = %q, %v; want :9091", cfg.MetricsAddr, err)
	}
}
