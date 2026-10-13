package openai

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"backend/internal/infrastructure/netguard"
	"backend/internal/infrastructure/tracing"

	"go.opentelemetry.io/otel/attribute"
)

const (
	DefaultBaseURL          = "https://api.openai.com/v1"
	ProtocolResponses       = "openai_responses"
	ProtocolChatCompletions = "openai_chat_completions"
)

// Config says where a model lives and how to talk to it.
type Config struct {
	BaseURL  string
	APIKey   string
	Model    string
	Protocol string
	// AllowPrivate lets the client reach loopback and private networks (an operator choice).
	AllowPrivate bool
	// OnUsage, when set, hears the tokens of every call, how long it took and whether it worked.
	OnUsage func(ctx context.Context, inputTokens, outputTokens int, took time.Duration, ok bool)
}

func (c Config) report(ctx context.Context, started time.Time, in, out int, ok bool) {
	if c.OnUsage != nil {
		c.OnUsage(ctx, in, out, time.Since(started), ok)
	}
}

func (c Config) baseURL() string {
	if strings.TrimSpace(c.BaseURL) == "" {
		return DefaultBaseURL
	}
	return strings.TrimRight(strings.TrimSpace(c.BaseURL), "/")
}

func (c Config) client(timeout time.Duration) *http.Client {
	client := netguard.NewClient(timeout, c.AllowPrivate)
	client.Transport = tracing.WrapTransport(client.Transport, attribute.String("gen_ai.request.model", c.Model))
	return client
}

// ProviderName is "openai" for the OpenAI API, otherwise the host, so stored embeddings
// say which service made them.
func ProviderName(baseURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if strings.TrimSpace(baseURL) == "" || err != nil || parsed.Host == "" || parsed.Host == "api.openai.com" {
		return "openai"
	}
	return parsed.Host
}

// reason is why a request could not be made, without the URL (which may carry a host the
// operator typed) or any header.
func reason(err error) string {
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		err = urlErr.Err
	}
	return err.Error()
}
