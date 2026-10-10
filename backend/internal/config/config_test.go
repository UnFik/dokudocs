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

func TestLoadConfigExportsTracesOnlyWhenAnEndpointIsSet(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("JWT_SECRET", "secret")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://alloy:4318")
	cfg, err := LoadConfig()
	if err != nil || cfg.OTLPEndpoint != "http://alloy:4318" {
		t.Fatalf("OTLPEndpoint = %q, %v", cfg.OTLPEndpoint, err)
	}
}

func TestLoadConfigRateLimitDefaultsAndOverrides(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("JWT_SECRET", "secret")
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.RateLimitCredentialsPerMin != 10 || cfg.RateLimitGoogleStartPerMin != 20 || cfg.RateLimitGoogleCallbackPerMin != 30 || cfg.TrustProxyHeaders {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}

	t.Setenv("RATE_LIMIT_LOGIN_PER_MIN", "3")
	t.Setenv("RATE_LIMIT_GOOGLE_START_PER_MIN", "0")
	t.Setenv("TRUST_PROXY_HEADERS", "true")
	cfg, err = LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.RateLimitCredentialsPerMin != 3 || cfg.RateLimitGoogleStartPerMin != 0 || !cfg.TrustProxyHeaders {
		t.Fatalf("overrides not applied: %+v", cfg)
	}
}

func TestLoadConfigReadsSMTPSettings(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("JWT_SECRET", "secret")
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.SMTPHost != "" || cfg.SMTPPort != 587 || cfg.MailerConfigured() {
		t.Fatalf("SMTP should be off by default on port 587: %+v", cfg)
	}

	t.Setenv("SMTP_HOST", "smtp.example.test")
	t.Setenv("SMTP_PORT", "2525")
	t.Setenv("SMTP_USER", "user")
	t.Setenv("SMTP_PASSWORD", "pass")
	t.Setenv("SMTP_FROM", "Dokudocs <no-reply@example.test>")
	cfg, err = LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.SMTPHost != "smtp.example.test" || cfg.SMTPPort != 2525 || cfg.SMTPUser != "user" || cfg.SMTPPassword != "pass" || !cfg.MailerConfigured() {
		t.Fatalf("SMTP settings not read: %+v", cfg)
	}
}

func TestEmailVerificationNeedsAMailServer(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("JWT_SECRET", "secret")
	t.Setenv("REQUIRE_EMAIL_VERIFICATION", "true")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("turning the gate on with no way to send email would lock every User out; want an error")
	}
	t.Setenv("SMTP_HOST", "smtp.example.test")
	t.Setenv("SMTP_FROM", "no-reply@example.test")
	if _, err := LoadConfig(); err != nil {
		t.Fatalf("gate with SMTP configured: %v", err)
	}
}

func TestLoadConfigReadsGoogleEndpointOverrides(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("JWT_SECRET", "secret")
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.GoogleAuthURL != "" || cfg.GoogleTokenURL != "" || cfg.GoogleJWKSURL != "" {
		t.Fatalf("the Google endpoints must default to Google's own (empty here): %+v", cfg)
	}
	t.Setenv("GOOGLE_AUTH_URL", "http://127.0.0.1:4399/auth")
	t.Setenv("GOOGLE_TOKEN_URL", "http://127.0.0.1:4399/token")
	t.Setenv("GOOGLE_JWKS_URL", "http://127.0.0.1:4399/certs")
	cfg, err = LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.GoogleAuthURL != "http://127.0.0.1:4399/auth" || cfg.GoogleTokenURL != "http://127.0.0.1:4399/token" || cfg.GoogleJWKSURL != "http://127.0.0.1:4399/certs" {
		t.Fatalf("overrides not read: %+v", cfg)
	}
}

func TestPushNeedsEveryFirebaseSetting(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("JWT_SECRET", "secret")

	cfg, err := LoadConfig()
	if err != nil || cfg.PushConfigured() {
		t.Fatalf("with nothing set: configured = %v, err = %v, want push off and no error", cfg.PushConfigured(), err)
	}

	t.Setenv("FIREBASE_CREDENTIALS_JSON", `{"project_id":"p"}`)
	if _, err := LoadConfig(); err == nil {
		t.Fatal("LoadConfig() accepted a service account without the web settings")
	}

	t.Setenv("FIREBASE_WEB_API_KEY", "key")
	t.Setenv("FIREBASE_WEB_APP_ID", "app")
	t.Setenv("FIREBASE_WEB_SENDER_ID", "123")
	t.Setenv("FIREBASE_WEB_VAPID_KEY", "vapid")
	cfg, err = LoadConfig()
	if err != nil || !cfg.PushConfigured() {
		t.Fatalf("with everything set: configured = %v, err = %v, want push on", cfg.PushConfigured(), err)
	}

	t.Setenv("FIREBASE_CREDENTIALS_JSON", "")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("LoadConfig() accepted the web settings without a service account")
	}
}
