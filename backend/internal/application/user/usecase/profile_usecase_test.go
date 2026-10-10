package usecase_test

import (
	"context"
	"testing"

	"backend/internal/application/user/dto"
	"backend/internal/application/user/usecase"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func TestUserProfile(t *testing.T) {
	userID := uuid.New()
	mock := &mockUserRepo{
		profile: model.UserProfile{
			ID:       userID,
			Email:    "test@example.com",
			FullName: "Old Name",
		},
	}
	uc := usecase.NewUseCaseWithRepo(mock)

	// Test GetProfile
	p, err := uc.GetProfile(context.Background(), userID)
	if err != nil || p.FullName != "Old Name" {
		t.Fatalf("unexpected profile: %#v, err: %v", p, err)
	}

	// Test UpdateProfile
	updated, err := uc.UpdateProfile(context.Background(), dto.UpdateProfileInput{
		UserID:      userID,
		FullName:    "New Name",
		PhoneNumber: "123456",
		Bio:         "Bio",
	})
	if err != nil || updated.FullName != "New Name" {
		t.Fatalf("unexpected updated profile: %#v, err: %v", updated, err)
	}
}
