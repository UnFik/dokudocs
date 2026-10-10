package usecase

import (
	"context"
	"database/sql"
	"errors"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"backend/constant"
	"backend/internal/application/auth/dto"
	"backend/internal/application/utils"
	"backend/internal/domain/model"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

func (u *useCase) Register(ctx context.Context, req dto.RegisterRequest) (data dto.LoginResponse, err error) {
	email := strings.TrimSpace(strings.ToLower(req.Email))
	fullName := strings.TrimSpace(req.FullName)
	if !validEmail(email) || !policy.ValidDisplayName(fullName) ||
		utf8.RuneCountInString(req.Password) < 15 || len([]byte(req.Password)) > 72 {
		return data, constant.ErrInvalidRegistration
	}

	_, err = u.users.FindByEmail(ctx, email)
	if err == nil {
		return data, constant.ErrEmailAlreadyExists
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return data, err
	}

	hash, err := utils.HashPassword(req.Password)
	if err != nil {
		return data, err
	}
	user := model.AuthUser{
		ID:           uuid.New(),
		Email:        email,
		PasswordHash: hash,
		Roles:        []string{"member"},
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}
	for attempt := 0; attempt < 3; attempt++ {
		user.AccountNo = "ACC" + strings.ReplaceAll(uuid.NewString(), "-", "")
		err = u.db.WithTransaction(ctx, func(tx database.Queryer) error {
			return u.factory(tx).Create(ctx, user, fullName)
		})
		if err == nil {
			u.sendVerificationAfterRegister(ctx, user.ID)
			return u.tokens.Issue(user)
		}
		if isUniqueConstraint(err, "users_email_key") {
			return data, constant.ErrEmailAlreadyExists
		}
		if !isUniqueConstraint(err, "users_account_no_key") {
			return data, err
		}
	}
	return data, err
}

func validEmail(email string) bool {
	if len([]byte(email)) == 0 || len([]byte(email)) > 255 {
		return false
	}
	parsed, err := mail.ParseAddress(email)
	return err == nil && parsed.Address == email
}

func isUniqueConstraint(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == constraint
}
