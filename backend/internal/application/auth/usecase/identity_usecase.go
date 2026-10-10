package usecase

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"backend/constant"
	"backend/internal/application/auth/dto"
	"backend/internal/application/utils"
	repocontract "backend/internal/domain/contract/repository"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

const (
	transactionTTL = 10 * time.Minute
	exchangeTTL    = time.Minute
	defaultSignIn  = "/dashboard"
	defaultLink    = "/settings/account"
	identityScope  = "openid email profile"
	maxFullName    = 100
)

// errRetry marks a race that a second look at the database settles.
var errRetry = errors.New("retry identity resolution")

func (u *useCase) StartIdentity(ctx context.Context, req dto.IdentityStart) (dto.IdentityStarted, error) {
	provider := u.providers[req.Provider]
	if provider == nil {
		return dto.IdentityStarted{}, constant.ErrIdentityProviderNotSet
	}
	state, err := newSecret()
	if err != nil {
		return dto.IdentityStarted{}, err
	}
	nonce, err := newSecret()
	if err != nil {
		return dto.IdentityStarted{}, err
	}
	verifier, err := newSecret()
	if err != nil {
		return dto.IdentityStarted{}, err
	}
	binding, err := newSecret()
	if err != nil {
		return dto.IdentityStarted{}, err
	}
	purpose, fallback := repocontract.PurposeSignIn, defaultSignIn
	if req.LinkUserID != nil {
		purpose, fallback = repocontract.PurposeLink, defaultLink
	}
	transactions := u.transactions(u.db)
	_ = transactions.Purge(ctx)
	err = transactions.Create(ctx, repocontract.NewOAuthTransaction{
		Provider: req.Provider, Purpose: purpose,
		StateHash: hashSecret(state), BindingHash: hashSecret(binding),
		Nonce: nonce, CodeVerifier: verifier,
		RedirectPath: safeRedirectPath(req.Redirect, fallback),
		UserID:       req.LinkUserID,
	}, transactionTTL)
	if err != nil {
		return dto.IdentityStarted{}, err
	}
	return dto.IdentityStarted{AuthorizationURL: provider.AuthorizationURL(state, nonce, verifier), Binding: binding}, nil
}

func (u *useCase) FinishIdentity(ctx context.Context, req dto.IdentityCallback) dto.IdentityOutcome {
	if req.State == "" || req.Binding == "" {
		return dto.IdentityOutcome{Error: "expired"}
	}
	transactions := u.transactions(u.db)
	tx, err := transactions.Claim(ctx, hashSecret(req.State), hashSecret(req.Binding))
	if err != nil {
		if errors.Is(err, constant.ErrOAuthTransactionNotFound) {
			return dto.IdentityOutcome{Error: "expired"}
		}
		return dto.IdentityOutcome{Error: "failed"}
	}
	linking := tx.Purpose == repocontract.PurposeLink
	fail := func(code string) dto.IdentityOutcome {
		_ = transactions.Finish(ctx, tx.ID)
		return dto.IdentityOutcome{Linking: linking, Redirect: tx.RedirectPath, Error: code}
	}

	provider := u.providers[tx.Provider]
	switch {
	case provider == nil:
		return fail("failed")
	case req.ProviderError == "access_denied":
		return fail("denied")
	case req.ProviderError != "" || req.Code == "":
		return fail("failed")
	}
	identity, err := provider.Verify(ctx, req.Code, tx.CodeVerifier, tx.Nonce)
	if err != nil {
		return fail("failed")
	}
	var linkTo *uuid.UUID
	if linking {
		linkTo = tx.UserID
	}
	userID, err := u.resolveIdentity(ctx, tx.Provider, identity, linkTo)
	switch {
	case errors.Is(err, constant.ErrIdentityInUse):
		return fail("identity_in_use")
	case errors.Is(err, constant.ErrProviderAlreadyLinked):
		return fail("provider_linked")
	case err != nil:
		return fail("failed")
	}
	if linking {
		_ = transactions.Finish(ctx, tx.ID)
		return dto.IdentityOutcome{Linking: true, Redirect: tx.RedirectPath}
	}
	code, err := newSecret()
	if err != nil {
		return fail("failed")
	}
	if err := transactions.Complete(ctx, tx.ID, userID, hashSecret(code), exchangeTTL); err != nil {
		return fail("failed")
	}
	return dto.IdentityOutcome{ExchangeCode: code}
}

func (u *useCase) ExchangeIdentity(ctx context.Context, code, binding string) (dto.IdentityExchange, error) {
	if code == "" || binding == "" {
		return dto.IdentityExchange{}, constant.ErrOAuthTransactionNotFound
	}
	userID, redirect, err := u.transactions(u.db).Exchange(ctx, hashSecret(code), hashSecret(binding))
	if err != nil {
		return dto.IdentityExchange{}, err
	}
	login, err := u.issueFor(ctx, userID)
	if err != nil {
		return dto.IdentityExchange{}, err
	}
	return dto.IdentityExchange{Login: login, Redirect: redirect}, nil
}

// issueFor signs a token for a User from what the database says now.
func (u *useCase) issueFor(ctx context.Context, userID uuid.UUID) (dto.LoginResponse, error) {
	profile, err := u.users.FindByID(ctx, userID)
	if err != nil {
		return dto.LoginResponse{}, err
	}
	user, err := u.users.FindByEmail(ctx, profile.Email)
	if err != nil {
		return dto.LoginResponse{}, err
	}
	return u.tokens.Issue(user)
}

// resolveIdentity finds or makes the User an identity belongs to (ADR-0034).
func (u *useCase) resolveIdentity(ctx context.Context, provider string, identity model.ProviderIdentity, linkTo *uuid.UUID) (uuid.UUID, error) {
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		var userID uuid.UUID
		userID, err = u.resolveOnce(ctx, provider, identity, linkTo)
		if !errors.Is(err, errRetry) {
			return userID, err
		}
	}
	return uuid.Nil, err
}

func (u *useCase) resolveOnce(ctx context.Context, provider string, identity model.ProviderIdentity, linkTo *uuid.UUID) (uuid.UUID, error) {
	known, err := u.identities(u.db).FindUserID(ctx, provider, identity.Subject)
	switch {
	case err == nil:
		if linkTo != nil && known != *linkTo {
			return uuid.Nil, constant.ErrIdentityInUse
		}
		return known, nil
	case !errors.Is(err, constant.ErrIdentityNotFound):
		return uuid.Nil, err
	}
	if !identity.EmailVerified {
		return uuid.Nil, constant.ErrIdentityEmailNotVerified
	}
	email := strings.ToLower(strings.TrimSpace(identity.Email))

	if linkTo != nil {
		err := u.db.WithTransaction(ctx, func(tx database.Queryer) error {
			return u.linkAndFill(ctx, tx, *linkTo, provider, identity, email)
		})
		return *linkTo, retryOnRace(err)
	}

	existing, err := u.users.FindByEmail(ctx, email)
	switch {
	case err == nil:
		err := u.db.WithTransaction(ctx, func(tx database.Queryer) error {
			if !existing.EmailVerified {
				if err := u.identities(tx).TakeOver(ctx, existing.ID); err != nil {
					return err
				}
			}
			return u.linkAndFill(ctx, tx, existing.ID, provider, identity, email)
		})
		return existing.ID, retryOnRace(err)
	case !errors.Is(err, sql.ErrNoRows):
		return uuid.Nil, err
	}

	user := model.AuthUser{
		ID: uuid.New(), Email: email, Roles: []string{"member"}, EmailVerified: true,
		CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	for attempt := 0; attempt < 3; attempt++ {
		user.AccountNo = "ACC" + strings.ReplaceAll(uuid.NewString(), "-", "")
		err = u.db.WithTransaction(ctx, func(tx database.Queryer) error {
			if err := u.factory(tx).Create(ctx, user, profileName(identity.Name, email)); err != nil {
				return err
			}
			return u.linkAndFill(ctx, tx, user.ID, provider, identity, email)
		})
		if err == nil {
			return user.ID, nil
		}
		if isUniqueConstraint(err, "users_email_key") {
			return uuid.Nil, errRetry
		}
		if !isUniqueConstraint(err, "users_account_no_key") {
			return uuid.Nil, retryOnRace(err)
		}
	}
	return uuid.Nil, err
}

func (u *useCase) linkAndFill(ctx context.Context, tx database.Queryer, userID uuid.UUID, provider string, identity model.ProviderIdentity, email string) error {
	repo := u.identities(tx)
	if err := repo.Link(ctx, userID, provider, identity.Subject, email, identityScope); err != nil {
		return err
	}
	return repo.FillAvatar(ctx, userID, identity.AvatarURL)
}

// retryOnRace turns "someone linked this identity a moment ago" into a retry,
// which then finds the identity instead of failing.
func retryOnRace(err error) error {
	if errors.Is(err, constant.ErrIdentityInUse) {
		return errRetry
	}
	return err
}

// profileName fits a provider's name to what a User's full name allows.
func profileName(name, email string) string {
	name = strings.TrimSpace(name)
	if utf8.RuneCountInString(name) < 2 {
		name = email
	}
	if utf8.RuneCountInString(name) > maxFullName {
		name = string([]rune(name)[:maxFullName])
	}
	return name
}

func newSecret() (string, error) { return newVerificationToken() }

func (u *useCase) SignInMethods(ctx context.Context, userID uuid.UUID) (dto.SignInMethods, error) {
	repo := u.identities(u.db)
	hasPassword, err := repo.HasPassword(ctx, userID)
	if err != nil {
		return dto.SignInMethods{}, err
	}
	linked, err := repo.ListByUser(ctx, userID)
	if err != nil {
		return dto.SignInMethods{}, err
	}
	methods := dto.SignInMethods{HasPassword: hasPassword, Identities: make([]dto.LinkedIdentity, 0, len(linked))}
	for _, item := range linked {
		methods.Identities = append(methods.Identities, dto.LinkedIdentity{Provider: item.Provider, Email: item.Email, LinkedAt: item.LinkedAt})
	}
	return methods, nil
}

func (u *useCase) UnlinkIdentity(ctx context.Context, userID uuid.UUID, provider string) error {
	return u.db.WithTransaction(ctx, func(tx database.Queryer) error {
		repo := u.identities(tx)
		if err := repo.LockUser(ctx, userID); err != nil {
			return err
		}
		linked, err := repo.ListByUser(ctx, userID)
		if err != nil {
			return err
		}
		found := false
		for _, item := range linked {
			found = found || item.Provider == provider
		}
		if !found {
			return constant.ErrIdentityNotFound
		}
		hasPassword, err := repo.HasPassword(ctx, userID)
		if err != nil {
			return err
		}
		if !hasPassword && len(linked) <= 1 {
			return constant.ErrLastSignInMethod
		}
		return repo.Unlink(ctx, userID, provider)
	})
}

func (u *useCase) SetPassword(ctx context.Context, userID uuid.UUID, password string) error {
	if utf8.RuneCountInString(password) < 15 || len([]byte(password)) > 72 {
		return constant.ErrInvalidPassword
	}
	hash, err := utils.HashPassword(password)
	if err != nil {
		return err
	}
	return u.identities(u.db).SetPassword(ctx, userID, hash)
}
