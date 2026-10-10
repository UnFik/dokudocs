package usecase

import (
	"context"

	"backend/internal/application/auth/dto"

	"github.com/google/uuid"
)

// IdentityUseCase signs Users in, and links accounts, through outside providers.
type IdentityUseCase interface {
	// StartIdentity begins a sign-in or link. It gives constant.ErrIdentityProviderNotSet
	// when the provider has no credentials.
	StartIdentity(ctx context.Context, req dto.IdentityStart) (dto.IdentityStarted, error)
	// FinishIdentity handles the provider's callback and never returns an error:
	// every failure is a code in the outcome.
	FinishIdentity(ctx context.Context, req dto.IdentityCallback) dto.IdentityOutcome
	// ExchangeIdentity trades the one-time code for a token, once, for the browser
	// that started; otherwise it gives constant.ErrOAuthTransactionNotFound.
	ExchangeIdentity(ctx context.Context, code, binding string) (dto.IdentityExchange, error)
	// SignInMethods lists how a User can sign in.
	SignInMethods(ctx context.Context, userID uuid.UUID) (dto.SignInMethods, error)
	// UnlinkIdentity gives constant.ErrIdentityNotFound for a provider that is not
	// linked and constant.ErrLastSignInMethod when it is the only way to sign in.
	UnlinkIdentity(ctx context.Context, userID uuid.UUID, provider string) error
	// SendPasswordLink mails the User a one-time link to set or change the
	// password. It gives constant.ErrPasswordLinkTooSoon inside the cooldown,
	// constant.ErrEmailNotConfigured without a mailer and constant.ErrEmailNotSent
	// when the mail could not be sent.
	SendPasswordLink(ctx context.Context, userID uuid.UUID) error
	// CheckPasswordLink says whether the link is usable by the User, without using
	// it up; otherwise constant.ErrInvalidPasswordLink.
	CheckPasswordLink(ctx context.Context, userID uuid.UUID, token string) error
	// ResetPassword uses the link up and replaces the password: constant.ErrInvalidPassword
	// for one that breaks the rules (the link stays usable), constant.ErrInvalidPasswordLink
	// for a link that is unknown, used, expired or someone else's.
	ResetPassword(ctx context.Context, userID uuid.UUID, token, password string) error
}

// AccountUseCase is what the auth routes need on top of checking a token.
type AccountUseCase interface {
	AuthUseCase
	IdentityUseCase
	// SendVerificationEmail mails the User a link to prove the address; it does
	// nothing when the address is already verified.
	SendVerificationEmail(ctx context.Context, userID uuid.UUID) error
	// VerifyEmail uses a link up and returns a token that carries the verified flag.
	VerifyEmail(ctx context.Context, token string) (dto.LoginResponse, error)
}

type AuthUseCase interface {
	Login(ctx context.Context, req dto.LoginRequest) (data dto.LoginResponse, err error)
	Register(ctx context.Context, req dto.RegisterRequest) (data dto.LoginResponse, err error)
	VerifyToken(tokenString string) (data dto.ResponseUser, err error)
}
