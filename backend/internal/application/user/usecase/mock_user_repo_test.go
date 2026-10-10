package usecase_test

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

type mockUserRepo struct {
	profile  model.UserProfile
	settings model.UserSettings
	users    []model.UserSummary
}

func (m *mockUserRepo) FindByEmail(ctx context.Context, email string) (model.AuthUser, error) {
	return model.AuthUser{}, nil
}
func (m *mockUserRepo) FindByID(ctx context.Context, id uuid.UUID) (model.UserProfile, error) {
	return m.profile, nil
}
func (m *mockUserRepo) Create(ctx context.Context, user model.AuthUser, fullName string) error {
	return nil
}
func (m *mockUserRepo) UpdateProfile(ctx context.Context, id uuid.UUID, fullName, phone, bio string) error {
	m.profile.FullName = fullName
	m.profile.PhoneNumber = phone
	m.profile.Bio = bio
	return nil
}
func (m *mockUserRepo) GetSettings(ctx context.Context, userID uuid.UUID) (model.UserSettings, error) {
	return m.settings, nil
}
func (m *mockUserRepo) UpdateSettings(ctx context.Context, settings model.UserSettings) error {
	m.settings = settings
	return nil
}
func (m *mockUserRepo) Search(ctx context.Context, query string, limit int) ([]model.UserSummary, error) {
	return m.users, nil
}

func (m *mockUserRepo) MarkEmailVerified(ctx context.Context, id uuid.UUID) error { return nil }
