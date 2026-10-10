package usecase_test

import (
	"context"
	"errors"
	"testing"

	"backend/constant"
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

func TestUpdateProfileRefusesANameThatCouldBreakAMention(t *testing.T) {
	userID := uuid.New()
	mock := &mockUserRepo{profile: model.UserProfile{ID: userID, FullName: "Old Name"}}
	uc := usecase.NewUseCaseWithRepo(mock)
	for _, name := range []string{"New [Name]", "New (Name)", "@new", "New\nName", "N", ""} {
		_, err := uc.UpdateProfile(context.Background(), dto.UpdateProfileInput{UserID: userID, FullName: name})
		if !errors.Is(err, constant.ErrInvalidDisplayName) {
			t.Errorf("UpdateProfile(%q) = %v, want ErrInvalidDisplayName", name, err)
		}
	}
	if mock.profile.FullName != "Old Name" {
		t.Fatalf("a refused name was stored: %q", mock.profile.FullName)
	}
}
