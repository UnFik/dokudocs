package usecase

import (
	"context"
	"strings"

	"backend/constant"
	"backend/internal/application/user/dto"
	"backend/internal/domain/model"
	"backend/internal/domain/policy"
)

func (u *useCase) UpdateProfile(ctx context.Context, input dto.UpdateProfileInput) (data model.UserProfile, err error) {
	fullName := strings.TrimSpace(input.FullName)
	if !policy.ValidDisplayName(fullName) {
		return data, constant.ErrInvalidDisplayName
	}
	if err = u.repo.UpdateProfile(ctx, input.UserID, fullName, input.PhoneNumber, input.Bio); err != nil {
		return data, err
	}
	data, err = u.repo.FindByID(ctx, input.UserID)
	if err != nil {
		return data, err
	}
	return data, nil
}
