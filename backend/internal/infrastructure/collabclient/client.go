// Package collabclient is the API's side of the service-to-service calls to the
// collaboration service.
package collabclient

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Client struct {
	baseURL string
	secret  string
	http    *http.Client
}

// New returns a client for the service at baseURL. With no URL every call does nothing.
func New(baseURL, secret string) *Client {
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), secret: secret, http: &http.Client{Timeout: 5 * time.Second}}
}

// ReloadRoom asks the service to tell the editors in a document's room that the
// document was replaced, and to close the room without storing it.
func (c *Client) ReloadRoom(ctx context.Context, workspaceID, documentID uuid.UUID) error {
	if c.baseURL == "" {
		return nil
	}
	room := url.QueryEscape(workspaceID.String() + "." + documentID.String())
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/internal/reload?room="+room, nil)
	if err != nil {
		return err
	}
	request.Header.Set("X-Collab-Secret", c.secret)
	response, err := c.http.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		return fmt.Errorf("collaboration service refused the reload: %d", response.StatusCode)
	}
	return nil
}
