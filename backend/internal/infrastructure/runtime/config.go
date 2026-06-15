package runtime

import (
	"fmt"
	"os"
	"time"
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
		Addr:          envDefault("APP_ADDR", ":8080"),
		DatabaseURL:   os.Getenv("DATABASE_URL"),
		AllowedOrigin: envDefault("ALLOWED_ORIGIN", "http://localhost:5173"),
		JWTSecret:     os.Getenv("JWT_SECRET"),
	}
	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required")
	}
	if cfg.JWTSecret == "" {
		return Config{}, fmt.Errorf("JWT_SECRET is required")
	}
	var err error
	if cfg.AccessTokenTTL, err = durationEnv("ACCESS_TOKEN_TTL", "24h"); err != nil {
		return Config{}, err
	}
	if cfg.ReadTimeout, err = durationEnv("READ_TIMEOUT", "5s"); err != nil {
		return Config{}, err
	}
	if cfg.WriteTimeout, err = durationEnv("WRITE_TIMEOUT", "10s"); err != nil {
		return Config{}, err
	}
	if cfg.IdleTimeout, err = durationEnv("IDLE_TIMEOUT", "60s"); err != nil {
		return Config{}, err
	}
	if cfg.ShutdownTimeout, err = durationEnv("SHUTDOWN_TIMEOUT", "10s"); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func envDefault(name, fallback string) string {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	return value
}

func durationEnv(name, fallback string) (time.Duration, error) {
	value := envDefault(name, fallback)
	duration, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("%s is invalid: %w", name, err)
	}
	return duration, nil
}
