package openai

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

	"backend/internal/application/agent"
	"backend/internal/application/airuns"
	appchat "backend/internal/application/rag/usecase"
)

// AgentModel is the Agent's model: it answers or asks for Dokudocs tools, over
// Chat Completions or Responses function calling.
type AgentModel struct {
	cfg      Config
	baseURL  string
	protocol string
	client   *http.Client
}

func NewAgent(cfg Config) *AgentModel {
	protocol := cfg.Protocol
	if protocol == "" {
		protocol = ProtocolChatCompletions
	}
	return &AgentModel{cfg: cfg, baseURL: cfg.baseURL(), protocol: protocol, client: cfg.client(90 * time.Second)}
}

func (m *AgentModel) Model() string    { return m.cfg.Model }
func (m *AgentModel) Provider() string { return ProviderName(m.baseURL) }

// Step sends the Conversation so far and returns the model's next turn.
func (m *AgentModel) Step(ctx context.Context, messages []agent.Message, tools []agent.ToolSpec) (reply agent.Message, err error) {
	if strings.TrimSpace(m.cfg.APIKey) == "" || strings.TrimSpace(m.cfg.Model) == "" {
		return agent.Message{}, errors.New("agent request is invalid")
	}
	var usage tokenUsage
	started := time.Now()
	defer func() { m.cfg.report(ctx, started, usage.in(), usage.out(), err == nil) }()
	if m.protocol == ProtocolResponses {
		return m.responsesStep(ctx, messages, tools, &usage)
	}
	return m.chatStep(ctx, messages, tools, &usage)
}

func (m *AgentModel) post(ctx context.Context, path string, payload any) ([]byte, error) {
	if airuns.HasOutput(ctx) {
		data, ok := payload.(map[string]any)
		if !ok {
			return nil, errors.New("invalid agent request")
		}
		body, status, err := streamPost(ctx, m.client, m.baseURL+path, m.cfg.APIKey, data, false)
		if err != nil {
			return nil, err
		}
		if status != http.StatusOK {
			return nil, fmt.Errorf("%w: agent provider returned HTTP %d", appchat.ErrRAGProviderUnavailable, status)
		}
		return body, nil
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, errors.New("agent request failed")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, m.baseURL+path, bytes.NewReader(raw))
	if err != nil {
		return nil, errors.New("agent request failed")
	}
	req.Header.Set("Authorization", "Bearer "+m.cfg.APIKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := m.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: agent provider unavailable: %s", appchat.ErrRAGProviderUnavailable, reason(err))
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return nil, fmt.Errorf("%w: agent provider unavailable", appchat.ErrRAGProviderUnavailable)
	}
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%w: agent provider returned HTTP %d", appchat.ErrRAGProviderUnavailable, res.StatusCode)
	}
	return body, nil
}

func (m *AgentModel) chatStep(ctx context.Context, messages []agent.Message, tools []agent.ToolSpec, usage *tokenUsage) (agent.Message, error) {
	type function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	}
	type call struct {
		ID       string   `json:"id"`
		Type     string   `json:"type"`
		Function function `json:"function"`
	}
	type message struct {
		Role       string `json:"role"`
		Content    string `json:"content"`
		ToolCalls  []call `json:"tool_calls,omitempty"`
		ToolCallID string `json:"tool_call_id,omitempty"`
	}
	out := make([]message, 0, len(messages))
	for _, msg := range messages {
		item := message{Role: msg.Role, Content: msg.Content, ToolCallID: msg.ToolCallID}
		for _, c := range msg.ToolCalls {
			item.ToolCalls = append(item.ToolCalls, call{ID: c.ID, Type: "function", Function: function{Name: c.Name, Arguments: string(c.Arguments)}})
		}
		out = append(out, item)
	}
	payload := map[string]any{"model": m.cfg.Model, "messages": out, "max_completion_tokens": agent.OutputBudget(ctx)}
	if len(tools) > 0 {
		specs := make([]map[string]any, len(tools))
		for i, t := range tools {
			specs[i] = map[string]any{"type": "function", "function": map[string]any{"name": t.Name, "description": t.Description, "parameters": t.Parameters}}
		}
		payload["tools"] = specs
	}
	body, err := m.post(ctx, "/chat/completions", payload)
	if err != nil {
		return agent.Message{}, err
	}
	var response struct {
		Usage   tokenUsage `json:"usage"`
		Choices []struct {
			Message      message `json:"message"`
			FinishReason string  `json:"finish_reason"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &response); err != nil || len(response.Choices) == 0 {
		return agent.Message{}, fmt.Errorf("%w: agent provider returned an invalid response", appchat.ErrRAGProviderUnavailable)
	}
	*usage = response.Usage
	got := response.Choices[0].Message
	reply := agent.Message{Role: "assistant", Content: got.Content, Truncated: response.Choices[0].FinishReason == "length"}
	for _, c := range got.ToolCalls {
		reply.ToolCalls = append(reply.ToolCalls, toolCall(c.ID, c.Function.Name, c.Function.Arguments))
	}
	return reply, nil
}

func (m *AgentModel) responsesStep(ctx context.Context, messages []agent.Message, tools []agent.ToolSpec, usage *tokenUsage) (agent.Message, error) {
	var instructions []string
	input := []map[string]any{}
	for _, msg := range messages {
		switch msg.Role {
		case "system":
			instructions = append(instructions, msg.Content)
		case "tool":
			input = append(input, map[string]any{"type": "function_call_output", "call_id": msg.ToolCallID, "output": msg.Content})
		case "assistant":
			if msg.Content != "" {
				input = append(input, map[string]any{"role": "assistant", "content": msg.Content})
			}
			for _, c := range msg.ToolCalls {
				input = append(input, map[string]any{"type": "function_call", "call_id": c.ID, "name": c.Name, "arguments": string(c.Arguments)})
			}
		default:
			input = append(input, map[string]any{"role": "user", "content": msg.Content})
		}
	}
	payload := map[string]any{"model": m.cfg.Model, "store": false, "max_output_tokens": agent.OutputBudget(ctx), "instructions": strings.Join(instructions, "\n\n"), "input": input}
	if len(tools) > 0 {
		specs := make([]map[string]any, len(tools))
		for i, t := range tools {
			specs[i] = map[string]any{"type": "function", "name": t.Name, "description": t.Description, "parameters": t.Parameters}
		}
		payload["tools"] = specs
	}
	body, err := m.post(ctx, "/responses", payload)
	if err != nil {
		return agent.Message{}, err
	}
	var response struct {
		Usage  tokenUsage `json:"usage"`
		Status string     `json:"status"`
		// IncompleteDetails says why a response stopped before it was done.
		IncompleteDetails struct {
			Reason string `json:"reason"`
		} `json:"incomplete_details"`
		Output []struct {
			Type      string `json:"type"`
			CallID    string `json:"call_id"`
			Name      string `json:"name"`
			Arguments string `json:"arguments"`
			Content   []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		} `json:"output"`
	}
	err = json.Unmarshal(body, &response)
	truncated := response.Status == "incomplete" && response.IncompleteDetails.Reason == "max_output_tokens"
	if err != nil || (response.Status != "" && response.Status != "completed" && !truncated) {
		return agent.Message{}, fmt.Errorf("%w: agent provider returned an invalid response", appchat.ErrRAGProviderUnavailable)
	}
	*usage = response.Usage
	reply := agent.Message{Role: "assistant", Truncated: truncated}
	for _, item := range response.Output {
		switch item.Type {
		case "message":
			for _, c := range item.Content {
				if c.Type == "output_text" {
					reply.Content += c.Text
				}
			}
		case "function_call":
			reply.ToolCalls = append(reply.ToolCalls, toolCall(item.CallID, item.Name, item.Arguments))
		}
	}
	return reply, nil
}

// toolCall keeps valid arguments as they are. Arguments that are not valid JSON were
// cut off or garbled; they are flagged, not run as if the model had sent nothing.
func toolCall(id, name, arguments string) agent.ToolCall {
	args := json.RawMessage(arguments)
	if json.Valid(args) {
		return agent.ToolCall{ID: id, Name: name, Arguments: args}
	}
	return agent.ToolCall{ID: id, Name: name, Arguments: json.RawMessage(`{}`), Invalid: true}
}
