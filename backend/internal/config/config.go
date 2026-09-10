package config

import (
	"fmt"
	"time"

	"backend/internal/env"
)

type Config struct {
	Addr            string
	DatabaseURL     string
	AllowedOrigin   string
	JWTSecret       string
	AccessTokenTTL  time.Duration
	ReadTimeout     time.Duration
	WriteTimeout    time.Duration
	IdleTimeout     time.Duration
	ShutdownTimeout time.Duration
}

func LoadConfig() (Config, error) {
	cfg := Config{
		Addr:            env.GetString("APP_ADDR", ":8080"),
		DatabaseURL:     env.GetString("DATABASE_URL", ""),
		AllowedOrigin:   env.GetString("ALLOWED_ORIGIN", "http://localhost:5173"),
		JWTSecret:       env.GetString("JWT_SECRET", ""),
		AccessTokenTTL:  env.GetDuration("ACCESS_TOKEN_TTL", 24*time.Hour),
		ReadTimeout:     env.GetDuration("READ_TIMEOUT", 5*time.Second),
		WriteTimeout:    env.GetDuration("WRITE_TIMEOUT", 10*time.Second),
		IdleTimeout:     env.GetDuration("IDLE_TIMEOUT", 60*time.Second),
		ShutdownTimeout: env.GetDuration("SHUTDOWN_TIMEOUT", 10*time.Second),
	}

	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required")
	}
	if cfg.JWTSecret == "" {
		return Config{}, fmt.Errorf("JWT_SECRET is required")
	}

	return cfg, nil
}
