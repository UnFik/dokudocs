package usecase

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"time"

	"backend/constant"
	"backend/internal/application/auth/dto"
	"backend/internal/domain/contract/mail"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

const (
	verificationTTL      = 24 * time.Hour
	verificationCooldown = time.Minute
)

func (u *useCase) SendVerificationEmail(ctx context.Context, userID uuid.UUID) error {
	if u.mailer == nil {
		return constant.ErrEmailNotConfigured
	}
	profile, err := u.users.FindByID(ctx, userID)
	if err != nil {
		return err
	}
	if profile.EmailVerified {
		return nil
	}
	token, err := newVerificationToken()
	if err != nil {
		return err
	}
	hash := hashSecret(token)
	err = u.db.WithTransaction(ctx, func(tx database.Queryer) error {
		return u.verifications(tx).Issue(ctx, userID, hash, verificationTTL, verificationCooldown)
	})
	if err != nil {
		return err
	}
	err = u.mailer.Send(ctx, mail.Message{
		To:      profile.Email,
		Subject: "Confirm your email for Dokudocs",
		Text: fmt.Sprintf("Open this link to confirm %s:\n\n%s/verify-email?token=%s\n\n"+
			"The link works once and expires in 24 hours. If you did not create a Dokudocs account, ignore this email.\n",
			profile.Email, u.appURL, token),
	})
	if err != nil {
		// Drop the link so the User can ask again without waiting out the cooldown.
		_ = u.verifications(u.db).Discard(ctx, hash)
		return fmt.Errorf("%w: %v", constant.ErrEmailNotSent, err)
	}
	return nil
}

func (u *useCase) VerifyEmail(ctx context.Context, token string) (data dto.LoginResponse, err error) {
	hash := hashSecret(token)
	var userID uuid.UUID
	err = u.db.WithTransaction(ctx, func(tx database.Queryer) error {
		id, err := u.verifications(tx).Consume(ctx, hash)
		if err != nil {
			return err
		}
		userID = id
		return u.factory(tx).MarkEmailVerified(ctx, id)
	})
	if err != nil {
		return data, err
	}
	profile, err := u.users.FindByID(ctx, userID)
	if err != nil {
		return data, err
	}
	user, err := u.users.FindByEmail(ctx, profile.Email)
	if err != nil {
		return data, err
	}
	return u.tokens.Issue(user)
}

// sendVerificationAfterRegister never fails the registration: the User can ask
// for another link from the verification page.
func (u *useCase) sendVerificationAfterRegister(ctx context.Context, userID uuid.UUID) {
	if u.mailer == nil {
		return
	}
	_ = u.SendVerificationEmail(ctx, userID)
}

func newVerificationToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func hashSecret(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
