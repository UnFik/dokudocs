package usecase_test

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

type mockWorkspaceRepo struct {
	workspaces []model.Workspace
	members    map[uuid.UUID][]model.WorkspaceMember
	roles      map[string]string // key: workspaceID:userID
}

func (m *mockWorkspaceRepo) ListByUser(ctx context.Context, userID uuid.UUID) ([]model.Workspace, error) {
	return m.workspaces, nil
}
func (m *mockWorkspaceRepo) GetByID(ctx context.Context, id, userID uuid.UUID) (model.Workspace, error) {
	for _, w := range m.workspaces {
		if w.ID == id {
			return w, nil
		}
	}
	return model.Workspace{}, nil
}
func (m *mockWorkspaceRepo) Create(ctx context.Context, ws model.Workspace) (model.Workspace, error) {
	m.workspaces = append(m.workspaces, ws)
	m.roles[ws.ID.String()+":"+ws.CreatedBy.String()] = "owner"
	return ws, nil
}
func (m *mockWorkspaceRepo) Update(ctx context.Context, ws model.Workspace) error {
	return nil
}
func (m *mockWorkspaceRepo) Delete(ctx context.Context, id uuid.UUID) error {
	return nil
}
func (m *mockWorkspaceRepo) GetMembers(ctx context.Context, workspaceID uuid.UUID) ([]model.WorkspaceMember, error) {
	return m.members[workspaceID], nil
}
func (m *mockWorkspaceRepo) AddMember(ctx context.Context, workspaceID, userID uuid.UUID, role string) error {
	m.roles[workspaceID.String()+":"+userID.String()] = role
	return nil
}
func (m *mockWorkspaceRepo) RemoveMember(ctx context.Context, workspaceID, userID uuid.UUID) error {
	delete(m.roles, workspaceID.String()+":"+userID.String())
	return nil
}
func (m *mockWorkspaceRepo) GetUserRole(ctx context.Context, workspaceID, userID uuid.UUID) (string, error) {
	return m.roles[workspaceID.String()+":"+userID.String()], nil
}

type mockUserRepo struct{}

func (m *mockUserRepo) FindByEmail(ctx context.Context, email string) (model.AuthUser, error) {
	return model.AuthUser{ID: uuid.New(), Email: email}, nil
}
func (m *mockUserRepo) FindByID(ctx context.Context, id uuid.UUID) (model.UserProfile, error) {
	return model.UserProfile{}, nil
}
func (m *mockUserRepo) Create(ctx context.Context, user model.AuthUser, fullName string) error {
	return nil
}
func (m *mockUserRepo) UpdateProfile(ctx context.Context, id uuid.UUID, fullName, phone, bio, avatarURL string) error {
	return nil
}
func (m *mockUserRepo) GetSettings(ctx context.Context, userID uuid.UUID) (model.UserSettings, error) {
	return model.UserSettings{}, nil
}
func (m *mockUserRepo) UpdateSettings(ctx context.Context, settings model.UserSettings) error {
	return nil
}
func (m *mockUserRepo) Search(ctx context.Context, query string, limit int) ([]model.UserSummary, error) {
	return nil, nil
}
