package usecase

import (
	"backend/internal/application/auth/dto"
)

func (u *useCase) VerifyToken(tokenString string) (data dto.ResponseUser, err error) {
	data, err = u.tokens.Verify(tokenString)
	if err != nil {
		return data, err
	}
	return data, nil
}
