package tracing_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"backend/internal/infrastructure/logger"
	"backend/internal/infrastructure/middleware"
	"backend/internal/infrastructure/tracing"

	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

const incoming = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"

func recordSpans(t *testing.T) *tracetest.SpanRecorder {
	t.Helper()
	recorder := tracetest.NewSpanRecorder()
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder)))
	tracing.UsePropagation()
	t.Cleanup(func() { otel.SetTracerProvider(previous) })
	return recorder
}

func api(out *bytes.Buffer) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/documents/{id}", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("GET /api/v1/health", func(w http.ResponseWriter, _ *http.Request) {})
	return tracing.Middleware(middleware.Logger(logger.NewJSON(out))(mux))
}

func TestARequestContinuesTheCallersTraceAndReturnsItsID(t *testing.T) {
	spans := recordSpans(t)
	var out bytes.Buffer
	req := httptest.NewRequest(http.MethodGet, "/api/v1/documents/doc-1", nil)
	req.Header.Set("traceparent", incoming)
	rec := httptest.NewRecorder()
	api(&out).ServeHTTP(rec, req)

	const traceID = "4bf92f3577b34da6a3ce929d0e0e4736"
	if got := rec.Header().Get("X-Request-ID"); got != traceID {
		t.Errorf("X-Request-ID = %q, want the trace ID %q", got, traceID)
	}
	var line map[string]any
	if err := json.Unmarshal(out.Bytes(), &line); err != nil {
		t.Fatalf("log line: %v", err)
	}
	if line["trace_id"] != traceID {
		t.Errorf("log trace_id = %v, want %s", line["trace_id"], traceID)
	}
	ended := spans.Ended()
	if len(ended) != 1 {
		t.Fatalf("got %d spans, want 1", len(ended))
	}
	if ended[0].Name() != "GET /api/v1/documents/{id}" {
		t.Errorf("span name = %q, want the route pattern", ended[0].Name())
	}
	if ended[0].SpanContext().TraceID().String() != traceID {
		t.Errorf("span is not in the caller's trace")
	}
}

func TestARequestWithoutATraceStartsOne(t *testing.T) {
	recordSpans(t)
	rec := httptest.NewRecorder()
	api(&bytes.Buffer{}).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/documents/doc-1", nil))
	if id := rec.Header().Get("X-Request-ID"); len(id) != 32 || strings.Trim(id, "0") == "" {
		t.Errorf("X-Request-ID = %q, want a new trace ID", id)
	}
}

func TestHealthChecksAreNotTraced(t *testing.T) {
	spans := recordSpans(t)
	api(&bytes.Buffer{}).ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/v1/health", nil))
	if n := len(spans.Ended()); n != 0 {
		t.Errorf("got %d spans for a health check, want 0", n)
	}
}
