package openai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"unicode/utf16"
	"unicode/utf8"

	"backend/internal/application/airuns"
	appchat "backend/internal/application/rag/usecase"
)

var streamFinished = errors.New("provider stream completed")

type reportKey struct{}

// StreamReport says what a provider did with the last streaming request made
// under its context: sent an event stream, or ignored the flag and answered whole.
type StreamReport struct {
	mu       sync.Mutex
	streamed bool
	whole    bool
}

// WithStreamReport lets a caller learn whether the provider streams.
func WithStreamReport(ctx context.Context) (context.Context, *StreamReport) {
	report := &StreamReport{}
	return context.WithValue(ctx, reportKey{}, report), report
}

// Supported is "supported" after an event stream, "unsupported" after a whole
// answer to a streaming request, and "unverified" when no request told either.
func (r *StreamReport) Supported() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	switch {
	case r.streamed:
		return "supported"
	case r.whole:
		return "unsupported"
	}
	return "unverified"
}

func noteStream(ctx context.Context, streamed bool) {
	if report, ok := ctx.Value(reportKey{}).(*StreamReport); ok {
		report.mu.Lock()
		defer report.mu.Unlock()
		if streamed {
			report.streamed = true
		} else {
			report.whole = true
		}
	}
}

// streamPost asks for an event stream. Some compatible providers refuse the
// stream_options that ask for token usage; none has shown any output by then, so
// the request is repeated once without it and usage stays unknown.
func streamPost(ctx context.Context, client *http.Client, url, key string, payload map[string]any, answer bool) ([]byte, int, error) {
	body, status, err := streamPostOnce(ctx, client, url, key, payload, answer, true)
	if err == nil && (status == http.StatusBadRequest || status == http.StatusUnprocessableEntity) && !strings.HasSuffix(url, "/responses") {
		return streamPostOnce(ctx, client, url, key, payload, answer, false)
	}
	return body, status, err
}

func streamPostOnce(ctx context.Context, client *http.Client, url, key string, payload map[string]any, answer, withUsage bool) ([]byte, int, error) {
	payload["stream"] = true
	responses := strings.HasSuffix(url, "/responses")
	delete(payload, "stream_options")
	if !responses && withUsage {
		payload["stream_options"] = map[string]bool{"include_usage": true}
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("%w: provider unavailable", appchat.ErrRAGProviderUnavailable)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK || !strings.Contains(res.Header.Get("Content-Type"), "text/event-stream") {
		if res.StatusCode == http.StatusOK {
			noteStream(ctx, false)
		}
		body, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
		return body, res.StatusCode, err
	}
	noteStream(ctx, true)
	text, emitted := "", ""
	var usage tokenUsage
	complete := false
	ended := false
	var responseBody []byte
	// cut is set when the model stopped at its output limit; only the Agent accepts
	// that, so it can tell the model its tool call was cut off.
	cut := false
	type functionCall struct {
		ID       string `json:"id"`
		Type     string `json:"type"`
		Function struct {
			Name      string `json:"name"`
			Arguments string `json:"arguments"`
		} `json:"function"`
	}
	calls := map[int]*functionCall{}
	emit := func() error {
		visible := text
		if answer {
			var err error
			visible, err = partialAnswer(text)
			if err != nil {
				return err
			}
		}
		if !strings.HasPrefix(visible, emitted) {
			return errors.New("provider changed previously streamed text")
		}
		if delta := strings.TrimPrefix(visible, emitted); delta != "" {
			if err := airuns.Emit(ctx, "text_delta", map[string]string{"text": delta}); err != nil {
				return err
			}
			emitted = visible
		}
		return nil
	}
	process := func(data string) error {
		if responses {
			var event struct {
				Type     string          `json:"type"`
				Delta    string          `json:"delta"`
				Response json.RawMessage `json:"response"`
			}
			if json.Unmarshal([]byte(data), &event) != nil {
				return errors.New("invalid Responses event")
			}
			switch event.Type {
			case "response.output_text.delta":
				if complete {
					return errors.New("text after Responses completion")
				}
				text += event.Delta
				if len(text) > 4<<20 {
					return airuns.ErrLimit
				}
				return emit()
			case "response.completed":
				var response struct {
					Status string     `json:"status"`
					Usage  tokenUsage `json:"usage"`
				}
				if json.Unmarshal(event.Response, &response) != nil || response.Status != "completed" {
					return errors.New("invalid Responses completion")
				}
				usage = response.Usage
				responseBody = event.Response
				complete = true
				ended = true
				return streamFinished
			case "response.incomplete":
				var response struct {
					IncompleteDetails struct {
						Reason string `json:"reason"`
					} `json:"incomplete_details"`
					Usage tokenUsage `json:"usage"`
				}
				if answer || json.Unmarshal(event.Response, &response) != nil || response.IncompleteDetails.Reason != "max_output_tokens" {
					return errors.New("Responses generation failed")
				}
				usage = response.Usage
				responseBody = event.Response
				complete = true
				ended = true
				return streamFinished
			case "error", "response.failed", "response.refusal.delta", "response.refusal.done":
				return errors.New("Responses generation failed")
			}
			return nil
		}
		if data == "[DONE]" {
			if !complete {
				return errors.New("provider stream ended before completion")
			}
			ended = true
			return streamFinished
		}
		var chunk struct {
			Usage   tokenUsage `json:"usage"`
			Choices []struct {
				Index int `json:"index"`
				Delta struct {
					Content   string `json:"content"`
					Refusal   string `json:"refusal"`
					ToolCalls []struct {
						Index    int    `json:"index"`
						ID       string `json:"id"`
						Function struct {
							Name      string `json:"name"`
							Arguments string `json:"arguments"`
						} `json:"function"`
					} `json:"tool_calls"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
			Error json.RawMessage `json:"error"`
		}
		if json.Unmarshal([]byte(data), &chunk) != nil || len(chunk.Error) > 0 {
			return errors.New("provider returned an invalid stream")
		}
		if chunk.Usage.in() != 0 || chunk.Usage.out() != 0 {
			usage = chunk.Usage
		}
		for _, choice := range chunk.Choices {
			if choice.Index != 0 {
				continue
			}
			if choice.Delta.Refusal != "" {
				return errors.New("provider refused the request")
			}
			text += choice.Delta.Content
			if len(text) > 4<<20 {
				return airuns.ErrLimit
			}
			if choice.FinishReason != nil {
				if *choice.FinishReason == "length" && !answer {
					cut = true
				} else if *choice.FinishReason != "stop" && !(!answer && *choice.FinishReason == "tool_calls") {
					return errors.New("provider stream was incomplete")
				}
				complete = true
			}
			for _, delta := range choice.Delta.ToolCalls {
				if answer || delta.Index < 0 || delta.Index >= 32 {
					return errors.New("invalid tool call delta")
				}
				call := calls[delta.Index]
				if call == nil {
					call = &functionCall{Type: "function"}
					calls[delta.Index] = call
				}
				call.ID += delta.ID
				call.Function.Name += delta.Function.Name
				call.Function.Arguments += delta.Function.Arguments
				if len(call.Function.Arguments) > 192<<10 || len(call.ID) > 200 || len(call.Function.Name) > 200 {
					return airuns.ErrLimit
				}
			}
			if err := emit(); err != nil {
				return err
			}
		}
		return nil
	}
	if err := readSSE(res.Body, process); err != nil && !errors.Is(err, streamFinished) {
		return nil, res.StatusCode, fmt.Errorf("%w: invalid provider stream", appchat.ErrRAGProviderUnavailable)
	}
	if !complete || !ended {
		return nil, res.StatusCode, fmt.Errorf("%w: provider stream ended before completion", appchat.ErrRAGProviderUnavailable)
	}
	if responses {
		return responseBody, res.StatusCode, nil
	}
	indices := make([]int, 0, len(calls))
	for index := range calls {
		indices = append(indices, index)
	}
	sort.Ints(indices)
	toolCalls := make([]*functionCall, 0, len(indices))
	for _, index := range indices {
		call := calls[index]
		// Arguments that are not valid JSON go on to the Agent, which tells the model.
		if call.ID == "" || call.Function.Name == "" {
			return nil, res.StatusCode, fmt.Errorf("%w: invalid streamed tool call", appchat.ErrRAGProviderUnavailable)
		}
		toolCalls = append(toolCalls, call)
	}
	finish := "stop"
	if cut {
		finish = "length"
	} else if len(toolCalls) > 0 {
		finish = "tool_calls"
	}
	body, err := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "content": text, "tool_calls": toolCalls}, "finish_reason": finish}}, "usage": usage})
	return body, res.StatusCode, err
}

func readSSE(reader io.Reader, process func(string) error) error {
	scanner := bufio.NewScanner(io.LimitReader(reader, 8<<20+1))
	scanner.Buffer(make([]byte, 4096), 1<<20)
	var lines []string
	size := 0
	dispatch := func() error {
		if len(lines) == 0 {
			return nil
		}
		data := strings.Join(lines, "\n")
		lines = nil
		return process(data)
	}
	for scanner.Scan() {
		line := scanner.Text()
		size += len(line)
		if size > 8<<20 {
			return airuns.ErrLimit
		}
		if line == "" {
			if err := dispatch(); err != nil {
				return err
			}
			continue
		}
		if strings.HasPrefix(line, "data:") {
			value := strings.TrimPrefix(line, "data:")
			value = strings.TrimPrefix(value, " ")
			lines = append(lines, value)
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	return dispatch()
}

func partialAnswer(raw string) (string, error) {
	raw = strings.TrimLeft(raw, " \t\r\n")
	if strings.HasPrefix(raw, "```") {
		newline := strings.IndexByte(raw, '\n')
		if newline < 0 {
			return "", nil
		}
		raw = raw[newline+1:]
	}
	decoder := json.NewDecoder(strings.NewReader(raw))
	first, err := decoder.Token()
	if err != nil {
		return "", nil
	}
	if first != json.Delim('{') {
		return "", errors.New("invalid answer object")
	}
	for decoder.More() {
		key, err := decoder.Token()
		if err != nil {
			return "", nil
		}
		if key == "answer" {
			rest := strings.TrimLeft(raw[decoder.InputOffset():], " \t\r\n")
			if len(rest) == 0 {
				return "", nil
			}
			if rest[0] != ':' {
				return "", errors.New("invalid answer field")
			}
			rest = strings.TrimLeft(rest[1:], " \t\r\n")
			if len(rest) == 0 {
				return "", nil
			}
			if rest[0] != '"' {
				return "", errors.New("invalid answer text")
			}
			return partialJSONString(rest[1:])
		}
		var skipped json.RawMessage
		if decoder.Decode(&skipped) != nil {
			return "", nil
		}
	}
	return "", nil
}

func partialJSONString(raw string) (string, error) {
	var out strings.Builder
	for i := 0; i < len(raw); {
		if raw[i] == '"' {
			return out.String(), nil
		}
		if raw[i] != '\\' {
			if raw[i] < 0x20 {
				return "", errors.New("invalid answer string")
			}
			if !utf8.FullRuneInString(raw[i:]) {
				break
			}
			rune, size := utf8.DecodeRuneInString(raw[i:])
			if rune == utf8.RuneError && size == 1 {
				return "", errors.New("invalid UTF-8")
			}
			out.WriteRune(rune)
			i += size
			continue
		}
		if i+1 >= len(raw) {
			break
		}
		switch raw[i+1] {
		case '"', '\\', '/':
			out.WriteByte(raw[i+1])
			i += 2
		case 'b':
			out.WriteByte('\b')
			i += 2
		case 'f':
			out.WriteByte('\f')
			i += 2
		case 'n':
			out.WriteByte('\n')
			i += 2
		case 'r':
			out.WriteByte('\r')
			i += 2
		case 't':
			out.WriteByte('\t')
			i += 2
		case 'u':
			if i+6 > len(raw) {
				return out.String(), nil
			}
			value, err := strconv.ParseUint(raw[i+2:i+6], 16, 16)
			if err != nil {
				return "", err
			}
			decoded := rune(value)
			if utf16.IsSurrogate(decoded) {
				if i+12 > len(raw) {
					return out.String(), nil
				}
				if raw[i+6:i+8] != "\\u" {
					return "", errors.New("invalid Unicode surrogate")
				}
				second, err := strconv.ParseUint(raw[i+8:i+12], 16, 16)
				if err != nil {
					return "", err
				}
				decoded = utf16.DecodeRune(decoded, rune(second))
				if decoded == utf8.RuneError {
					return "", errors.New("invalid Unicode surrogate")
				}
				i += 6
			}
			out.WriteRune(decoded)
			i += 6
		default:
			return "", errors.New("invalid answer escape")
		}
	}
	return out.String(), nil
}
