package usecase

import (
	"context"
	"fmt"
	"time"
	"unicode/utf8"

	"backend/constant"
	"backend/internal/application/utils"
	"backend/internal/domain/contract/mail"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

const (
	passwordLinkTTL      = time.Hour
	passwordLinkCooldown = time.Minute
)

func (u *useCase) SendPasswordLink(ctx context.Context, userID uuid.UUID) error {
	if u.mailer == nil {
		return constant.ErrEmailNotConfigured
	}
	profile, err := u.users.FindByID(ctx, userID)
	if err != nil {
		return err
	}
	token, err := newVerificationToken()
	if err != nil {
		return err
	}
	hash := hashSecret(token)
	err = u.db.WithTransaction(ctx, func(tx database.Queryer) error {
		return u.passwordTokens(tx).Issue(ctx, userID, hash, passwordLinkTTL, passwordLinkCooldown)
	})
	if err != nil {
		return err
	}
	err = u.mailer.Send(ctx, mail.Message{
		To:      profile.Email,
		Subject: "Set or change your Dokudocs password",
		Text: fmt.Sprintf("Open this link to set a new password for %s:\n\n%s/settings/account/set-password?token=%s\n\n"+
			"The link works once and expires in 1 hour. If you did not ask for it, ignore this email: your password stays as it is.\n",
			profile.Email, u.appURL, token),
	})
	if err != nil {
		// Drop the link so the User can ask again without waiting out the cooldown.
		_ = u.passwordTokens(u.db).Discard(ctx, hash)
		return fmt.Errorf("%w: %v", constant.ErrEmailNotSent, err)
	}
	return nil
}

func (u *useCase) CheckPasswordLink(ctx context.Context, userID uuid.UUID, token string) error {
	return u.passwordTokens(u.db).Check(ctx, userID, hashSecret(token))
}

func (u *useCase) ResetPassword(ctx context.Context, userID uuid.UUID, token, password string) error {
	// A password that breaks the rules must not use the link up.
	if utf8.RuneCountInString(password) < 15 || len([]byte(password)) > 72 {
		return constant.ErrInvalidPassword
	}
	hash, err := utils.HashPassword(password)
	if err != nil {
		return err
	}
	err = u.db.WithTransaction(ctx, func(tx database.Queryer) error {
		repo := u.identities(tx)
		if err := repo.LockUser(ctx, userID); err != nil {
			return err
		}
		if err := u.passwordTokens(tx).Consume(ctx, userID, hashSecret(token)); err != nil {
			return err
		}
		return repo.SetPassword(ctx, userID, hash)
	})
	if err != nil {
		return err
	}
	u.notifyPasswordChanged(ctx, userID)
	return nil
}

// notifyPasswordChanged never fails the change: it is the only sign the owner
// gets when someone else changed the password.
func (u *useCase) notifyPasswordChanged(ctx context.Context, userID uuid.UUID) {
	if u.mailer == nil {
		return
	}
	profile, err := u.users.FindByID(ctx, userID)
	if err != nil {
		return
	}
	_ = u.mailer.Send(ctx, mail.Message{
		To:      profile.Email,
		Subject: "Your Dokudocs password was changed",
		Text: fmt.Sprintf("The password for %s was just changed.\n\n"+
			"If this was you, nothing more to do. If it was not, ask for a new password link at %s/settings/account right away.\n",
			profile.Email, u.appURL),
	})
}
