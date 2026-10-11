//go:build integration

package routes

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"testing"
	"time"

	"backend/internal/config"
	"backend/internal/infrastructure/database"
	"backend/internal/infrastructure/logger"
	"backend/internal/infrastructure/runtime/container"
	"backend/internal/infrastructure/validator"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

var inviteLink = regexp.MustCompile(`https://app\.example\.test/invite\?token=([A-Za-z0-9_-]+)`)

// lastInviteToken is the token in the newest invitation email to address.
func lastInviteToken(t *testing.T, mailer *recordingMailer, address string) string {
	t.Helper()
	mailer.mu.Lock()
	defer mailer.mu.Unlock()
	for i := len(mailer.sent) - 1; i >= 0; i-- {
		if mailer.sent[i].To != address {
			continue
		}
		if match := inviteLink.FindStringSubmatch(mailer.sent[i].Text); match != nil {
			return match[1]
		}
	}
	t.Fatalf("no invitation email for %s", address)
	return ""
}

type envelope struct {
	Data  json.RawMessage `json:"data"`
	Title string          `json:"title"`
	Code  string          `json:"code"`
}

func TestWorkspaceInvitationsOverHTTP(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	ensureMemberRole(t, db)
	mailer := &recordingMailer{}
	app := container.New(database.NewSQLDB(db), logger.New(), validator.New())
	app.Mailer = mailer
	api := InitRoutes(app, config.Config{
		JWTSecret: "invite-test-secret-that-is-long-enough", AccessTokenTTL: time.Hour,
		PublicAppURL: "https://app.example.test",
	})

	call := func(method, path string, body any, token string) (*httptest.ResponseRecorder, envelope) {
		t.Helper()
		var reader bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&reader).Encode(body)
		}
		req := httptest.NewRequest(method, path, &reader)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		rec := httptest.NewRecorder()
		api.ServeHTTP(rec, req)
		var out envelope
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return rec, out
	}
	expect := func(rec *httptest.ResponseRecorder, status int, what string) {
		t.Helper()
		if rec.Code != status {
			t.Fatalf("%s = %d %s, want %d", what, rec.Code, rec.Body.String(), status)
		}
	}
	register := func(label string, verified bool) (email, token, id string) {
		t.Helper()
		email = fmt.Sprintf("invite-%s-%s@example.invalid", label, uuid.NewString())
		rec, _ := call(http.MethodPost, "/api/v1/auth/register", map[string]string{"email": email, "password": "a long enough password", "fullName": label}, "")
		expect(rec, http.StatusCreated, "register "+label)
		var body authBody
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		t.Cleanup(func() { _, _ = db.Exec(`DELETE FROM users WHERE email = $1`, email) })
		if verified {
			if _, err := db.Exec(`UPDATE users SET email_verified_at = now() WHERE email = $1`, email); err != nil {
				t.Fatal(err)
			}
		}
		return email, body.Data.AccessToken, body.Data.User.ID
	}

	_, owner, _ := register("owner", true)
	rec, created := call(http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "Invite Flow"}, owner)
	expect(rec, http.StatusCreated, "create workspace")
	var workspace struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(created.Data, &workspace)
	t.Cleanup(func() { _, _ = db.Exec(`DELETE FROM workspaces WHERE id = $1`, workspace.ID) })
	invitesPath := "/api/v1/workspaces/" + workspace.ID + "/invites"

	// The address has no account yet; the reply does not say so.
	benEmail := fmt.Sprintf("invite-ben-%s@example.invalid", uuid.NewString())
	rec, _ = call(http.MethodPost, invitesPath, map[string]string{"email": benEmail, "role": "member"}, owner)
	expect(rec, http.StatusCreated, "invite an address without an account")
	token := lastInviteToken(t, mailer, benEmail)

	rec, _ = call(http.MethodPost, "/api/v1/invites/preview", map[string]string{"token": "not-a-real-token"}, "")
	expect(rec, http.StatusNotFound, "preview of an unknown link")
	rec, preview := call(http.MethodPost, "/api/v1/invites/preview", map[string]string{"token": token}, "")
	expect(rec, http.StatusOK, "preview")
	var shown struct {
		WorkspaceName, InviterName, Role, Email string
	}
	_ = json.Unmarshal(preview.Data, &shown)
	if shown.WorkspaceName != "Invite Flow" || shown.Role != "member" || shown.Email[0] != benEmail[0] || shown.Email == benEmail {
		t.Fatalf("preview = %+v, want the workspace, the role and a masked email", shown)
	}

	// Signing up with the invited address is not enough: the address must be verified.
	rec, _ = call(http.MethodPost, "/api/v1/auth/register", map[string]string{"email": benEmail, "password": "a long enough password", "fullName": "Ben"}, "")
	expect(rec, http.StatusCreated, "register the invitee")
	var benAuth authBody
	_ = json.Unmarshal(rec.Body.Bytes(), &benAuth)
	t.Cleanup(func() { _, _ = db.Exec(`DELETE FROM users WHERE email = $1`, benEmail) })
	ben := benAuth.Data.AccessToken

	rec, refused := call(http.MethodPost, "/api/v1/invites/accept", map[string]string{"token": token}, ben)
	expect(rec, http.StatusForbidden, "accept with an unverified email")
	if refused.Code != "email_not_verified" {
		t.Fatalf("code = %q, want email_not_verified", refused.Code)
	}
	if _, err := db.Exec(`UPDATE users SET email_verified_at = now() WHERE email = $1`, benEmail); err != nil {
		t.Fatal(err)
	}

	// A leaked link is useless to someone else.
	_, carol, _ := register("carol", true)
	rec, refused = call(http.MethodPost, "/api/v1/invites/accept", map[string]string{"token": token}, carol)
	expect(rec, http.StatusForbidden, "accept as another user")
	if refused.Code != "invite_email_mismatch" {
		t.Fatalf("code = %q, want invite_email_mismatch", refused.Code)
	}
	rec, _ = call(http.MethodPost, "/api/v1/invites/accept", map[string]string{"token": token}, "")
	expect(rec, http.StatusUnauthorized, "accept without signing in")

	rec, accepted := call(http.MethodPost, "/api/v1/invites/accept", map[string]string{"token": token}, ben)
	expect(rec, http.StatusOK, "accept")
	var joined struct {
		WorkspaceID string `json:"workspaceId"`
	}
	_ = json.Unmarshal(accepted.Data, &joined)
	if joined.WorkspaceID != workspace.ID {
		t.Fatalf("joined %q, want %q", joined.WorkspaceID, workspace.ID)
	}
	rec, _ = call(http.MethodPost, "/api/v1/invites/accept", map[string]string{"token": token}, ben)
	expect(rec, http.StatusNotFound, "accept the same link twice")
	rec, _ = call(http.MethodGet, "/api/v1/workspaces/"+workspace.ID+"/members", nil, ben)
	expect(rec, http.StatusOK, "member list as the new member")

	// A member may not invite, list or revoke.
	rec, _ = call(http.MethodPost, invitesPath, map[string]string{"email": "x@example.invalid"}, ben)
	expect(rec, http.StatusForbidden, "member invites")
	rec, _ = call(http.MethodGet, invitesPath, nil, ben)
	expect(rec, http.StatusForbidden, "member lists invitations")
	rec, _ = call(http.MethodPost, invitesPath, map[string]string{"email": benEmail}, owner)
	expect(rec, http.StatusConflict, "invite a current member")

	rec, _ = call(http.MethodPost, invitesPath, map[string]string{"email": "not an email"}, owner)
	expect(rec, http.StatusBadRequest, "invite a malformed address")
	rec, _ = call(http.MethodPost, invitesPath, map[string]string{"email": "boss@example.invalid", "role": "owner"}, owner)
	expect(rec, http.StatusBadRequest, "invite as owner")

	// Resend: one link at a time, and not twice within the cooldown.
	daveEmail := fmt.Sprintf("invite-dave-%s@example.invalid", uuid.NewString())
	rec, _ = call(http.MethodPost, invitesPath, map[string]string{"email": daveEmail}, owner)
	expect(rec, http.StatusCreated, "invite dave")
	first := lastInviteToken(t, mailer, daveEmail)
	rec, listed := call(http.MethodGet, invitesPath, nil, owner)
	expect(rec, http.StatusOK, "list invitations")
	var pending []struct {
		ID, Email string
	}
	_ = json.Unmarshal(listed.Data, &pending)
	if len(pending) != 1 || pending[0].Email != daveEmail {
		t.Fatalf("pending = %+v, want only dave", pending)
	}
	if bytes.Contains(listed.Data, []byte(first)) || bytes.Contains(listed.Data, []byte("token")) {
		t.Fatalf("the list exposes a token: %s", listed.Data)
	}
	resend := invitesPath + "/" + pending[0].ID + "/resend"
	rec, _ = call(http.MethodPost, resend, nil, owner)
	expect(rec, http.StatusTooManyRequests, "resend inside the cooldown")
	if rec.Header().Get("Retry-After") == "" {
		t.Fatal("no Retry-After on the cooldown reply")
	}
	if _, err := db.Exec(`UPDATE workspace_invites SET last_sent_at = now() - interval '2 minutes' WHERE id = $1`, pending[0].ID); err != nil {
		t.Fatal(err)
	}
	rec, _ = call(http.MethodPost, resend, nil, owner)
	expect(rec, http.StatusNoContent, "resend")
	second := lastInviteToken(t, mailer, daveEmail)
	if second == first {
		t.Fatal("resend mailed the same link")
	}
	rec, _ = call(http.MethodPost, "/api/v1/invites/preview", map[string]string{"token": first}, "")
	expect(rec, http.StatusNotFound, "the replaced link")
	rec, _ = call(http.MethodPost, "/api/v1/invites/preview", map[string]string{"token": second}, "")
	expect(rec, http.StatusOK, "the new link")

	rec, _ = call(http.MethodDelete, invitesPath+"/"+pending[0].ID, nil, owner)
	expect(rec, http.StatusNoContent, "revoke")
	rec, _ = call(http.MethodPost, "/api/v1/invites/preview", map[string]string{"token": second}, "")
	expect(rec, http.StatusNotFound, "a revoked link")

	// When the email cannot go out, no invitation is left behind to block a retry.
	mailer.fail = errors.New("smtp down")
	rec, _ = call(http.MethodPost, invitesPath, map[string]string{"email": daveEmail}, owner)
	expect(rec, http.StatusBadGateway, "invite while mail is down")
	mailer.fail = nil
	rec, left := call(http.MethodGet, invitesPath, nil, owner)
	expect(rec, http.StatusOK, "list after a failed send")
	if string(left.Data) != "null" && string(left.Data) != "[]" {
		t.Fatalf("pending after a failed send = %s, want none", left.Data)
	}
}
