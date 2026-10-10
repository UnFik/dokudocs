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
	// EmailVerified is whether the address has been proven to belong to the User.
	EmailVerified bool
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type UserProfile struct {
	ID          uuid.UUID `json:"id"`
	AccountNo   string    `json:"accountNo"`
	Email       string    `json:"email"`
	FullName    string    `json:"fullName"`
	PhoneNumber string    `json:"phoneNumber"`
	Bio         string    `json:"bio"`
	AvatarURL   string    `json:"avatarUrl"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
	// EmailVerified is read from the database, unlike the flag in the access token.
	EmailVerified bool `json:"emailVerified"`
}

type UserSettings struct {
	UserID            uuid.UUID `json:"userId"`
	Theme             string    `json:"theme"`
	FontFamily        string    `json:"fontFamily"`
	Direction         string    `json:"direction"`
	Language          string    `json:"language"`
	NotificationPrefs string    `json:"notificationPrefs"` // JSON string
	EditorPrefs       string    `json:"editorPrefs"`       // JSON string
	UpdatedAt         time.Time `json:"updatedAt"`
}

type UserSummary struct {
	ID        uuid.UUID `json:"id"`
	Email     string    `json:"email"`
	FullName  string    `json:"fullName"`
	AvatarURL string    `json:"avatarUrl"`
}
