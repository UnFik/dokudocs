package config

import (
	"fmt"
	"strings"
	"time"

	"backend/internal/env"
)

type Config struct {
	Addr string
	// MetricsAddr is where Prometheus metrics are served, apart from the API;
	// empty turns them off.
	MetricsAddr string
	// OTLPEndpoint receives traces (e.g. http://alloy:4318); empty exports none.
	OTLPEndpoint       string
	DatabaseURL        string
	DBMaxOpenConns     int
	DBMaxIdleConns     int
	DBConnMaxLifetime  time.Duration
	AllowedOrigin      string
	GoogleClientID     string
	GoogleClientSecret string
	OpenAIAPIKey       string
	RAGEmbeddingModel  string
	RAGAnswerModel     string
	RAGRequestTimeout  time.Duration
	PublicAppURL       string
	JWTSecret          string
	// CollabServiceSecret is shared with the collaboration service; the internal
	// endpoints it calls are off while it is empty.
	CollabServiceSecret string
	// CollabServiceURL is where the API reaches the collaboration service to reload a
	// room; empty skips those calls.
	CollabServiceURL string
	// AssetDir is where uploaded files are kept; MaxUploadBytes is the most one may hold.
	AssetDir       string
	MaxUploadBytes int64
	AccessTokenTTL time.Duration
	// Requests a minute one client may make; zero turns that limit off.
	RateLimitCredentialsPerMin    int
	RateLimitGoogleStartPerMin    int
	RateLimitGoogleCallbackPerMin int
	// TrustProxyHeaders reads the client address from X-Real-IP; set it only
	// when a proxy that overwrites the header is the sole way to reach the API.
	TrustProxyHeaders bool
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
	ShutdownTimeout   time.Duration
}

func LoadConfig() (Config, error) {
	embeddingKey := strings.TrimSpace(env.GetString("OPENAI_API_KEY", ""))
	embeddingModel := strings.TrimSpace(env.GetString("RAG_EMBEDDING_MODEL", "text-embedding-3-small"))
	if embeddingModel == "" {
		embeddingModel = "text-embedding-3-small"
	}
	answerModel := strings.TrimSpace(env.GetString("RAG_ANSWER_MODEL", "gpt-5-mini"))
	if answerModel == "" {
		answerModel = "gpt-5-mini"
	}
	cfg := Config{
		Addr:                env.GetString("APP_ADDR", ":8080"),
		MetricsAddr:         env.GetString("METRICS_ADDR", ""),
		OTLPEndpoint:        strings.TrimRight(env.GetString("OTEL_EXPORTER_OTLP_ENDPOINT", ""), "/"),
		DatabaseURL:         env.GetString("DATABASE_URL", ""),
		DBMaxOpenConns:      env.GetInt("DB_MAX_OPEN_CONNS", 10),
		DBMaxIdleConns:      env.GetInt("DB_MAX_IDLE_CONNS", 10),
		DBConnMaxLifetime:   env.GetDuration("DB_CONN_MAX_LIFETIME", 30*time.Minute),
		AllowedOrigin:       env.GetString("ALLOWED_ORIGIN", "http://localhost:5173"),
		GoogleClientID:      env.GetString("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret:  env.GetString("GOOGLE_CLIENT_SECRET", ""),
		OpenAIAPIKey:        embeddingKey,
		RAGEmbeddingModel:   embeddingModel,
		RAGAnswerModel:      answerModel,
		RAGRequestTimeout:   env.GetDuration("RAG_REQUEST_TIMEOUT", 120*time.Second),
		PublicAppURL:        env.GetString("PUBLIC_APP_URL", "http://localhost:5173"),
		JWTSecret:           env.GetString("JWT_SECRET", ""),
		CollabServiceSecret: env.GetString("COLLAB_SERVICE_SECRET", ""),
		CollabServiceURL:    env.GetString("COLLAB_SERVICE_URL", ""),
		AssetDir:            env.GetString("ASSET_DIR", "./data/assets"),
		MaxUploadBytes:      int64(env.GetInt("MAX_UPLOAD_BYTES", 25<<20)),
		AccessTokenTTL:      env.GetDuration("ACCESS_TOKEN_TTL", 24*time.Hour),

		RateLimitCredentialsPerMin:    env.GetInt("RATE_LIMIT_LOGIN_PER_MIN", 10),
		RateLimitGoogleStartPerMin:    env.GetInt("RATE_LIMIT_GOOGLE_START_PER_MIN", 20),
		RateLimitGoogleCallbackPerMin: env.GetInt("RATE_LIMIT_GOOGLE_CALLBACK_PER_MIN", 30),
		TrustProxyHeaders:             env.GetBool("TRUST_PROXY_HEADERS", false),
		ReadTimeout:                   env.GetDuration("READ_TIMEOUT", 5*time.Second),
		WriteTimeout:                  env.GetDuration("WRITE_TIMEOUT", 10*time.Second),
		IdleTimeout:                   env.GetDuration("IDLE_TIMEOUT", 60*time.Second),
		ShutdownTimeout:               env.GetDuration("SHUTDOWN_TIMEOUT", 10*time.Second),
	}

	if cfg.DBMaxOpenConns < 1 {
		cfg.DBMaxOpenConns = 10
	}
	if cfg.DBMaxIdleConns < 0 || cfg.DBMaxIdleConns > cfg.DBMaxOpenConns {
		cfg.DBMaxIdleConns = cfg.DBMaxOpenConns
	}

	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required")
	}
	if cfg.JWTSecret == "" {
		return Config{}, fmt.Errorf("JWT_SECRET is required")
	}

	return cfg, nil
}
