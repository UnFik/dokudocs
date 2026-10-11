package openai

import (
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
