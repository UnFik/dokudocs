package usecase_test

import (
	"context"
	"testing"

	"backend/internal/application/user/usecase"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func TestUserSettings(t *testing.T) {
	userID := uuid.New()
	mock := &mockUserRepo{
		settings: model.UserSettings{
			UserID: userID,
			Theme:  "light",
		},
		users: []model.UserSummary{
			{ID: userID, Email: "test@example.com", FullName: "Old Name"},
		},
	}
	uc := usecase.NewUseCaseWithRepo(mock)

	// Test GetSettings
	s, err := uc.GetSettings(context.Background(), userID)
	if err != nil || s.Theme != "light" {
		t.Fatalf("unexpected settings: %#v, err: %v", s, err)
	}

	// Test UpdateSettings
	s.Theme = "dark"
	updatedSettings, err := uc.UpdateSettings(context.Background(), s)
	if err != nil || updatedSettings.Theme != "dark" {
		t.Fatalf("unexpected updated settings: %#v, err: %v", updatedSettings, err)
	}

	// Test SearchUsers
	users, err := uc.SearchUsers(context.Background(), "test", 10)
	if err != nil || len(users) != 1 {
		t.Fatalf("unexpected search users: %v, err: %v", users, err)
	}
}
