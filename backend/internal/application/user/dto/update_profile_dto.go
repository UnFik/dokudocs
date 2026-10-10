package dto

import "github.com/google/uuid"

type UpdateProfileInput struct {
	UserID      uuid.UUID
	FullName    string
	PhoneNumber string
	Bio         string
}
