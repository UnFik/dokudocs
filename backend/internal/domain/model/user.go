package model

import (
	"time"

	"github.com/google/uuid"
)

type AuthUser struct {
	ID           uuid.UUID
	AccountNo    string
	Email        string
	PasswordHash string
	Roles        []string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}
