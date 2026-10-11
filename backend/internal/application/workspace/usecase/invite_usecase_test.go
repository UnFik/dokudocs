package usecase_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"backend/constant"
	"backend/internal/application/workspace/dto"
	"backend/internal/application/workspace/usecase"
	"backend/internal/domain/contract/mail"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

type fakeMailer struct {
	sent []mail.Message
	err  error
}

func (f *fakeMailer) Send(_ context.Context, msg mail.Message) error {
	if f.err != nil {
		return f.err
	}
	f.sent = append(f.sent, msg)
	return nil
}

type fakeInvites struct {
	issued      []model.WorkspaceInvite
	issueErr    error
	discarded   []string
	hashes      []string
	acceptEmail string
	acceptErr   error
}

func (f *fakeInvites) Issue(_ context.Context, workspaceID, actorID uuid.UUID, email, role, tokenHash string, _, _ time.Duration) (model.WorkspaceInvite, error) {
	if f.issueErr != nil {
		return model.WorkspaceInvite{}, f.issueErr
	}
	invite := model.WorkspaceInvite{ID: uuid.New(), WorkspaceID: workspaceID, Email: email, Role: role, InvitedBy: actorID}
	f.issued = append(f.issued, invite)
	f.hashes = append(f.hashes, tokenHash)
	return invite, nil
}
func (f *fakeInvites) Reissue(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string, time.Duration, time.Duration) (model.WorkspaceInvite, error) {
	return model.WorkspaceInvite{}, constant.ErrInviteNotFound
}
func (f *fakeInvites) Discard(_ context.Context, tokenHash string) error {
	f.discarded = append(f.discarded, tokenHash)
	return nil
}
func (f *fakeInvites) ListPending(context.Context, uuid.UUID, uuid.UUID) ([]model.WorkspaceInvite, error) {
	return f.issued, nil
}
func (f *fakeInvites) Revoke(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error { return nil }
func (f *fakeInvites) Preview(context.Context, string) (model.InvitePreview, error) {
	return model.InvitePreview{WorkspaceName: "Acme", InviterName: "Ana", Role: "member", Email: "ben@example.com"}, nil
}
func (f *fakeInvites) Accept(_ context.Context, _ string, _ uuid.UUID, email string) (uuid.UUID, error) {
	f.acceptEmail = email
	return uuid.New(), f.acceptErr
}

type profileRepo struct {
	mockUserRepo
	profile model.UserProfile
}

func (p *profileRepo) FindByID(context.Context, uuid.UUID) (model.UserProfile, error) {
	return p.profile, nil
}

type inviteFixture struct {
	uc interface {
		InviteMember(context.Context, dto.InviteMemberInput) (model.WorkspaceInvite, error)
		PreviewInvite(context.Context, string) (model.InvitePreview, error)
		AcceptInvite(context.Context, string, uuid.UUID) (uuid.UUID, error)
	}
	invites     *fakeInvites
	mailer      *fakeMailer
	workspaceID uuid.UUID
	ownerID     uuid.UUID
	adminID     uuid.UUID
	memberID    uuid.UUID
	user        *profileRepo
}

func newInviteFixture(t *testing.T, withMailer bool) inviteFixture {
	t.Helper()
	f := inviteFixture{
		invites:     &fakeInvites{},
		mailer:      &fakeMailer{},
		workspaceID: uuid.New(),
		ownerID:     uuid.New(),
		adminID:     uuid.New(),
		memberID:    uuid.New(),
	}
	f.user = &profileRepo{profile: model.UserProfile{Email: "owner@example.com", FullName: "Olivia", EmailVerified: true}}
	repo := &mockWorkspaceRepo{
		workspaces: []model.Workspace{{ID: f.workspaceID, Name: "Acme"}},
		members:    map[uuid.UUID][]model.WorkspaceMember{},
		roles: map[string]string{
			f.workspaceID.String() + ":" + f.ownerID.String():  "owner",
			f.workspaceID.String() + ":" + f.adminID.String():  "admin",
			f.workspaceID.String() + ":" + f.memberID.String(): "member",
		},
	}
	opts := []usecase.Option{usecase.WithInviteRepository(f.invites)}
	if withMailer {
		opts = append(opts, usecase.WithMailer(f.mailer, "https://app.test/"))
	}
	f.uc = usecase.NewUseCaseWithRepos(repo, f.user, opts...)
	return f
}

func (f inviteFixture) invite(actor uuid.UUID, email, role string) (model.WorkspaceInvite, error) {
	return f.uc.InviteMember(context.Background(), dto.InviteMemberInput{
		WorkspaceID: f.workspaceID, Email: email, Role: role, ActorID: actor,
	})
}

func TestInviteMemberMailsALinkAndKeepsOnlyItsHash(t *testing.T) {
	f := newInviteFixture(t, true)

	invite, err := f.invite(f.ownerID, "  Ben@Example.com ", "")
	if err != nil {
		t.Fatalf("InviteMember: %v", err)
	}
	if invite.Email != "ben@example.com" || invite.Role != "member" {
		t.Fatalf("invite = %+v, want lowercase email and the member role", invite)
	}
	if len(f.mailer.sent) != 1 {
		t.Fatalf("sent %d emails, want 1", len(f.mailer.sent))
	}
	msg := f.mailer.sent[0]
	if msg.To != "ben@example.com" || !strings.Contains(msg.Subject, "Olivia") || !strings.Contains(msg.Subject, "Acme") {
		t.Fatalf("message = %+v", msg)
	}
	_, link, found := strings.Cut(msg.Text, "https://app.test/invite?token=")
	if !found {
		t.Fatalf("no invite link in %q", msg.Text)
	}
	token, _, _ := strings.Cut(link, "\n")
	if token == "" || f.invites.hashes[0] == token || len(f.invites.hashes[0]) != 64 {
		t.Fatalf("stored %q for token %q: want a 64 character hash, not the token", f.invites.hashes[0], token)
	}
}

func TestInviteMemberRoleRules(t *testing.T) {
	f := newInviteFixture(t, true)
	tests := []struct {
		name  string
		actor uuid.UUID
		role  string
		want  error
	}{
		{"owner invites an admin", f.ownerID, "admin", nil},
		{"admin invites a member", f.adminID, "member", nil},
		{"admin cannot invite an admin", f.adminID, "admin", constant.ErrForbidden},
		{"member cannot invite", f.memberID, "member", constant.ErrForbidden},
		{"stranger cannot invite", uuid.New(), "member", constant.ErrForbidden},
		{"owner is never invited", f.ownerID, "owner", constant.ErrInvalidInvite},
		{"guest is not offered yet", f.ownerID, "guest", constant.ErrInvalidInvite},
	}
	for i, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := f.invite(tt.actor, "person"+string(rune('a'+i))+"@example.com", tt.role)
			if !errors.Is(err, tt.want) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
		})
	}
}

func TestInviteMemberRejectsBadAddresses(t *testing.T) {
	f := newInviteFixture(t, true)
	for _, email := range []string{"", "not-an-email", "Ben <ben@example.com>", "owner@example.com", strings.Repeat("a", 250) + "@example.com"} {
		if _, err := f.invite(f.ownerID, email, "member"); !errors.Is(err, constant.ErrInvalidInvite) {
			t.Errorf("InviteMember(%q) = %v, want ErrInvalidInvite", email, err)
		}
	}
	if len(f.mailer.sent) != 0 {
		t.Fatalf("sent %d emails for bad addresses", len(f.mailer.sent))
	}
}

func TestInviteMemberWithoutMailerWritesNothing(t *testing.T) {
	f := newInviteFixture(t, false)
	if _, err := f.invite(f.ownerID, "ben@example.com", "member"); !errors.Is(err, constant.ErrEmailNotConfigured) {
		t.Fatalf("err = %v, want ErrEmailNotConfigured", err)
	}
	if len(f.invites.issued) != 0 {
		t.Fatal("an invitation was stored although no email can go out")
	}
}

func TestInviteMemberDropsTheInvitationWhenMailFails(t *testing.T) {
	f := newInviteFixture(t, true)
	f.mailer.err = errors.New("smtp down")
	if _, err := f.invite(f.ownerID, "ben@example.com", "member"); !errors.Is(err, constant.ErrEmailNotSent) {
		t.Fatalf("err = %v, want ErrEmailNotSent", err)
	}
	if len(f.invites.discarded) != 1 || f.invites.discarded[0] != f.invites.hashes[0] {
		t.Fatalf("discarded %v, want the hash %v", f.invites.discarded, f.invites.hashes)
	}
}

func TestInviteSubjectCannotCarryALineBreak(t *testing.T) {
	f := newInviteFixture(t, true)
	f.user.profile.FullName = "Olivia\r\nBcc: victim@example.com"
	if _, err := f.invite(f.ownerID, "ben@example.com", "member"); err != nil {
		t.Fatalf("InviteMember: %v", err)
	}
	if strings.ContainsAny(f.mailer.sent[0].Subject, "\r\n") {
		t.Fatalf("subject = %q", f.mailer.sent[0].Subject)
	}
}

func TestPreviewMasksTheEmail(t *testing.T) {
	f := newInviteFixture(t, true)
	preview, err := f.uc.PreviewInvite(context.Background(), "token")
	if err != nil {
		t.Fatal(err)
	}
	if preview.Email != "b**@example.com" {
		t.Fatalf("email = %q", preview.Email)
	}
}

func TestAcceptNeedsAVerifiedEmailAndPassesItLowercase(t *testing.T) {
	f := newInviteFixture(t, true)
	f.user.profile = model.UserProfile{Email: "Ben@Example.com", EmailVerified: false}
	if _, err := f.uc.AcceptInvite(context.Background(), "token", uuid.New()); !errors.Is(err, constant.ErrEmailNotVerified) {
		t.Fatalf("unverified: err = %v, want ErrEmailNotVerified", err)
	}
	f.user.profile.EmailVerified = true
	if _, err := f.uc.AcceptInvite(context.Background(), "token", uuid.New()); err != nil {
		t.Fatalf("verified: %v", err)
	}
	if f.invites.acceptEmail != "ben@example.com" {
		t.Fatalf("email passed on = %q", f.invites.acceptEmail)
	}
}
