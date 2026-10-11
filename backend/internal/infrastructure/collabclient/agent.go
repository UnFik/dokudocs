package collabclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"backend/internal/application/agent"
)

// errNoService is returned when no collaboration service is configured.
var errNoService = errors.New("the collaboration service is not configured")

// agentTimeout bounds a read or an edit, which may have to load the room first.
const agentTimeout = 20 * time.Second

func (c *Client) agentCall(ctx context.Context, method, path string, body any) (int, []byte, error) {
	if c.baseURL == "" {
		return 0, nil, errNoService
	}
	ctx, cancel := context.WithTimeout(ctx, agentTimeout)
	defer cancel()
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return 0, nil, err
		}
		reader = bytes.NewReader(raw)
	}
	request, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return 0, nil, err
	}
	request.Header.Set("X-Collab-Secret", c.secret)
	request.Header.Set("Content-Type", "application/json")
	client := *c.http
	client.Timeout = agentTimeout
	response, err := client.Do(request)
	if err != nil {
		return 0, nil, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	return response.StatusCode, raw, err
}

// Read implements agent.LiveRooms: the room's live text and its version.
func (c *Client) Read(ctx context.Context, room, docType string) (agent.LiveText, error) {
	status, raw, err := c.agentCall(ctx, http.MethodGet, "/internal/agent-read?room="+url.QueryEscape(room)+"&type="+url.QueryEscape(docType), nil)
	if err != nil {
		return agent.LiveText{}, err
	}
	if status != http.StatusOK {
		return agent.LiveText{}, refusal(status, raw)
	}
	var out agent.LiveText
	var body struct {
		Text    string `json:"text"`
		Version string `json:"version"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return out, err
	}
	return agent.LiveText{Text: body.Text, Version: body.Version}, nil
}

// Edit implements agent.LiveRooms: applies targeted operations in the room.
func (c *Client) Edit(ctx context.Context, edit agent.LiveEdit) (agent.LiveEditResult, error) {
	status, raw, err := c.agentCall(ctx, http.MethodPost, "/internal/agent-edit", map[string]any{
		"room": edit.Room, "type": edit.Type, "userID": edit.UserID, "mode": edit.Mode,
		"baseVersion": edit.BaseVersion, "operations": edit.Operations,
	})
	if err != nil {
		return agent.LiveEditResult{}, err
	}
	if status != http.StatusOK {
		return agent.LiveEditResult{}, refusal(status, raw)
	}
	var body struct {
		Version       string   `json:"version"`
		SuggestionIDs []string `json:"suggestionIDs"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return agent.LiveEditResult{}, err
	}
	return agent.LiveEditResult{Version: body.Version, SuggestionIDs: body.SuggestionIDs}, nil
}

func refusal(status int, raw []byte) error {
	var body struct {
		Error   string `json:"error"`
		Version string `json:"version"`
	}
	_ = json.Unmarshal(raw, &body)
	switch status {
	case http.StatusConflict:
		return &agent.ConflictError{Version: body.Version}
	case http.StatusUnprocessableEntity:
		return &agent.ToolError{Message: body.Error}
	}
	return fmt.Errorf("collaboration service answered %d", status)
}
