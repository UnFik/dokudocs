package usecase

import (
	"context"
	"errors"
	"strings"

	"backend/constant"

	"github.com/google/uuid"
)

func (u *useCase) AddOrUpdateAccess(ctx context.Context, docID, workspaceID, actorID uuid.UUID, email, level string) (err error) {
	doc, err := u.GetDocument(ctx, docID, workspaceID, actorID)
	if err != nil {
		return err
	}
	canManage, err := u.canManageDoc(ctx, doc, workspaceID, actorID)
	if err != nil || !canManage {
		return constant.ErrForbidden
	}

	targetUser, err := u.userRepo.FindByEmail(ctx, strings.TrimSpace(strings.ToLower(email)))
	if err != nil {
		return constant.ErrUserNotFound
	}

	if _, err := u.workspaceRepo.GetUserRole(ctx, workspaceID, targetUser.ID); err != nil {
		return errors.New("user must be a member of the workspace before sharing document")
	}

	if level == "" {
		level = "view"
	}
	switch level {
	case "owner", "edit", "comment", "view":
	default:
		return errors.New("invalid document access level")
	}

	return u.docRepo.AddOrUpdateAccess(ctx, docID, workspaceID, actorID, targetUser.ID, level)
}
