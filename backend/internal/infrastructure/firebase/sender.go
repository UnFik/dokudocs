// Package firebase sends web push through Firebase Cloud Messaging.
package firebase

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	notifycontract "backend/internal/domain/contract/notification"

	"github.com/google/uuid"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

const (
	messagingScope = "https://www.googleapis.com/auth/firebase.messaging"
	fcmEndpoint    = "https://fcm.googleapis.com"
	sendTimeout    = 15 * time.Second
)

// TokenStore holds the browsers people registered.
type TokenStore interface {
	Tokens(ctx context.Context, userID uuid.UUID) ([]string, error)
	// Drop forgets a token Firebase no longer knows.
	Drop(ctx context.Context, token string) error
}

// Sender sends to the FCM HTTP v1 API. It sends data only, so the page's service
// worker decides how the notification looks and where a click goes.
type Sender struct {
	client    *http.Client
	endpoint  string
	projectID string
	tokens    TokenStore
}

func newSender(client *http.Client, endpoint, projectID string, tokens TokenStore) *Sender {
	return &Sender{client: client, endpoint: strings.TrimRight(endpoint, "/"), projectID: projectID, tokens: tokens}
}

// Option changes how a Sender is built.
type Option func(*Sender)

// WithEndpoint sends to another FCM address, such as a proxy or a test double.
func WithEndpoint(endpoint string) Option {
	return func(s *Sender) { s.endpoint = strings.TrimRight(endpoint, "/") }
}

// NewFromCredentials signs in with a service account key. The project is the
// key's own unless projectID names another. It returns the project it uses.
func NewFromCredentials(ctx context.Context, serviceAccountJSON []byte, projectID string, tokens TokenStore, options ...Option) (*Sender, string, error) {
	credentials, err := google.CredentialsFromJSON(ctx, serviceAccountJSON, messagingScope)
	if err != nil {
		return nil, "", fmt.Errorf("firebase credentials: %w", err)
	}
	if projectID == "" {
		projectID = credentials.ProjectID
	}
	if projectID == "" {
		return nil, "", errors.New("firebase credentials name no project; set FIREBASE_PROJECT_ID")
	}
	sender := newSender(oauth2.NewClient(ctx, credentials.TokenSource), fcmEndpoint, projectID, tokens)
	for _, option := range options {
		option(sender)
	}
	return sender, projectID, nil
}

type fcmError struct {
	Error struct {
		Message string `json:"message"`
		Status  string `json:"status"`
		Details []struct {
			ErrorCode string `json:"errorCode"`
		} `json:"details"`
	} `json:"error"`
}

// gone says whether Firebase is telling us the token will never work again.
func (e fcmError) gone() bool {
	for _, detail := range e.Error.Details {
		if detail.ErrorCode == "UNREGISTERED" {
			return true
		}
	}
	return e.Error.Status == "INVALID_ARGUMENT" && strings.Contains(e.Error.Message, "registration token")
}

// SendToUser sends to every browser the person registered. A browser Firebase no
// longer knows is dropped; any other failure is returned after the rest were tried.
func (s *Sender) SendToUser(ctx context.Context, userID uuid.UUID, message notifycontract.PushMessage) error {
	tokens, err := s.tokens.Tokens(ctx, userID)
	if err != nil {
		return err
	}
	var failures []error
	for _, token := range tokens {
		if err := s.send(ctx, token, message); err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}

func (s *Sender) send(ctx context.Context, token string, message notifycontract.PushMessage) error {
	body, err := json.Marshal(map[string]any{"message": map[string]any{
		"token":   token,
		"data":    map[string]string{"title": message.Title, "body": message.Body, "url": message.URL},
		"webpush": map[string]any{"headers": map[string]string{"Urgency": "high", "TTL": "86400"}},
	}})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, sendTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/v1/projects/%s/messages:send", s.endpoint, s.projectID), bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := s.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	payload, _ := io.ReadAll(io.LimitReader(response.Body, 1<<16))
	if response.StatusCode < 300 {
		return nil
	}
	var failure fcmError
	_ = json.Unmarshal(payload, &failure)
	if failure.gone() {
		return s.tokens.Drop(ctx, token)
	}
	return fmt.Errorf("firebase send: %s %s", response.Status, failure.Error.Status)
}
