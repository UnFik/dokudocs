package config

import (
	"fmt"
	"strings"
	"time"

	"backend/internal/env"
)

type Config struct {
	Addr               string
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
	AccessTokenTTL   time.Duration
	ReadTimeout      time.Duration
	WriteTimeout     time.Duration
	IdleTimeout      time.Duration
	ShutdownTimeout  time.Duration
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
		AccessTokenTTL:      env.GetDuration("ACCESS_TOKEN_TTL", 24*time.Hour),
		ReadTimeout:         env.GetDuration("READ_TIMEOUT", 5*time.Second),
		WriteTimeout:        env.GetDuration("WRITE_TIMEOUT", 10*time.Second),
		IdleTimeout:         env.GetDuration("IDLE_TIMEOUT", 60*time.Second),
		ShutdownTimeout:     env.GetDuration("SHUTDOWN_TIMEOUT", 10*time.Second),
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
