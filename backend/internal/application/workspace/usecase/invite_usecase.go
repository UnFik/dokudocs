package usecase

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/mail"
	"strings"
	"time"
	"unicode"

	"backend/constant"
	"backend/internal/application/workspace/dto"
	contractmail "backend/internal/domain/contract/mail"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

const (
	inviteTTL      = 7 * 24 * time.Hour
	inviteCooldown = time.Minute
	maxEmailLen    = 255
	maxNameInMail  = 60
)

// InviteMember sends the address a link to join. The reply is the same whether
// or not the address has an account.
func (u *useCase) InviteMember(ctx context.Context, input dto.InviteMemberInput) (model.WorkspaceInvite, error) {
	email, role, err := u.checkInvite(ctx, input)
	if err != nil {
		return model.WorkspaceInvite{}, err
	}
	actor, err := u.userRepo.FindByID(ctx, input.ActorID)
	if err != nil {
		return model.WorkspaceInvite{}, err
	}
	if strings.EqualFold(actor.Email, email) {
		return model.WorkspaceInvite{}, constant.ErrInvalidInvite
	}
	token, hash, err := newInviteToken()
	if err != nil {
		return model.WorkspaceInvite{}, err
	}
	invite, err := u.invites.Issue(ctx, input.WorkspaceID, input.ActorID, email, role, hash, inviteTTL, inviteCooldown)
	if err != nil {
		return model.WorkspaceInvite{}, err
	}
	return invite, u.mailInvite(ctx, invite, actor.FullName, actor.Email, token, hash)
}

func (u *useCase) checkInvite(ctx context.Context, input dto.InviteMemberInput) (email, role string, err error) {
	if u.mailer == nil {
		return "", "", constant.ErrEmailNotConfigured
	}
	email = strings.ToLower(strings.TrimSpace(input.Email))
	parsed, parseErr := mail.ParseAddress(email)
	if parseErr != nil || parsed.Address != email || len(email) > maxEmailLen {
		return "", "", constant.ErrInvalidInvite
	}
	role = input.Role
	if role == "" {
		role = "member"
	}
	if role != "admin" && role != "member" {
		return "", "", constant.ErrInvalidInvite
	}
	actorRole, err := u.workspaceRepo.GetUserRole(ctx, input.WorkspaceID, input.ActorID)
	if err != nil {
		return "", "", err
	}
	if actorRole != "owner" && actorRole != "admin" {
		return "", "", constant.ErrForbidden
	}
	if role == "admin" && actorRole != "owner" {
		return "", "", constant.ErrForbidden
	}
	return email, role, nil
}

func (u *useCase) ListInvites(ctx context.Context, workspaceID, actorID uuid.UUID) ([]model.WorkspaceInvite, error) {
	return u.invites.ListPending(ctx, workspaceID, actorID)
}

func (u *useCase) ResendInvite(ctx context.Context, workspaceID, inviteID, actorID uuid.UUID) (model.WorkspaceInvite, error) {
	if u.mailer == nil {
		return model.WorkspaceInvite{}, constant.ErrEmailNotConfigured
	}
	actor, err := u.userRepo.FindByID(ctx, actorID)
	if err != nil {
		return model.WorkspaceInvite{}, err
	}
	token, hash, err := newInviteToken()
	if err != nil {
		return model.WorkspaceInvite{}, err
	}
	invite, err := u.invites.Reissue(ctx, workspaceID, actorID, inviteID, hash, inviteTTL, inviteCooldown)
	if err != nil {
		return model.WorkspaceInvite{}, err
	}
	return invite, u.mailInvite(ctx, invite, actor.FullName, actor.Email, token, hash)
}

func (u *useCase) RevokeInvite(ctx context.Context, workspaceID, inviteID, actorID uuid.UUID) error {
	return u.invites.Revoke(ctx, workspaceID, actorID, inviteID)
}

func (u *useCase) PreviewInvite(ctx context.Context, token string) (model.InvitePreview, error) {
	preview, err := u.invites.Preview(ctx, hashInviteToken(token))
	if err != nil {
		return model.InvitePreview{}, err
	}
	preview.Email = maskEmail(preview.Email)
	return preview, nil
}

// AcceptInvite joins the workspace. Only a User whose verified email is the
// invited address may use the link.
func (u *useCase) AcceptInvite(ctx context.Context, token string, userID uuid.UUID) (uuid.UUID, error) {
	profile, err := u.userRepo.FindByID(ctx, userID)
	if err != nil {
		return uuid.Nil, err
	}
	if !profile.EmailVerified {
		return uuid.Nil, constant.ErrEmailNotVerified
	}
	return u.invites.Accept(ctx, hashInviteToken(token), userID, strings.ToLower(profile.Email))
}

// mailInvite sends the link. When that fails the invitation is dropped so the
// person can try again without waiting out the cooldown.
func (u *useCase) mailInvite(ctx context.Context, invite model.WorkspaceInvite, inviterName, inviterEmail, token, hash string) error {
	workspace, err := u.workspaceRepo.GetByID(ctx, invite.WorkspaceID, invite.InvitedBy)
	if err != nil {
		_ = u.invites.Discard(ctx, hash)
		return err
	}
	inviter := mailName(inviterName, inviterEmail)
	space := mailName(workspace.Name, "a workspace")
	err = u.mailer.Send(ctx, contractmail.Message{
		To:      invite.Email,
		Subject: fmt.Sprintf("%s invited you to %s on Dokudocs", inviter, space),
		Text: fmt.Sprintf("%s invited you to join %s as %s.\n\nOpen this link to accept:\n\n%s/invite?token=%s\n\n"+
			"Sign in with %s. The link works once and expires in 7 days. If you were not expecting this, ignore this email.\n",
			inviter, space, invite.Role, u.appURL, token, invite.Email),
	})
	if err != nil {
		_ = u.invites.Discard(ctx, hash)
		return fmt.Errorf("%w: %v", constant.ErrEmailNotSent, err)
	}
	return nil
}

func newInviteToken() (token, hash string, err error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}
	token = base64.RawURLEncoding.EncodeToString(raw)
	return token, hashInviteToken(token), nil
}

func hashInviteToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// mailName makes a name safe for a subject line: one line, no controls, short.
func mailName(name, fallback string) string {
	clean := strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, strings.TrimSpace(name))
	clean = strings.Join(strings.Fields(clean), " ")
	if clean == "" {
		clean = fallback
	}
	if runes := []rune(clean); len(runes) > maxNameInMail {
		clean = string(runes[:maxNameInMail])
	}
	return clean
}

// maskEmail keeps the first letter of the name and the whole domain:
// "ana@example.com" becomes "a**@example.com".
func maskEmail(email string) string {
	at := strings.LastIndex(email, "@")
	if at <= 0 {
		return "***"
	}
	local := []rune(email[:at])
	return string(local[0]) + strings.Repeat("*", len(local)-1) + email[at:]
}
