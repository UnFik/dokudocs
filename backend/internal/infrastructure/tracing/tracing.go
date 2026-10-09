// Package tracing gives every API request a trace: it continues the caller's
// trace from the W3C traceparent header, or starts one, and exports spans over
// OTLP when an endpoint is configured.
package tracing

import (
	"context"
	"net/http"

	"github.com/exaring/otelpgx"
	"github.com/jackc/pgx/v5"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"
	"go.opentelemetry.io/otel/trace"
)

// Setup installs the tracer provider for the service. Without an endpoint
// nothing is exported, but requests still get a trace ID for their logs and
// X-Request-ID. The OTLP exporter reads OTEL_EXPORTER_OTLP_* from the environment.
func Setup(ctx context.Context, service, endpoint string) (shutdown func(context.Context) error, err error) {
	options := []sdktrace.TracerProviderOption{
		sdktrace.WithResource(resource.NewSchemaless(semconv.ServiceName(service))),
	}
	if endpoint != "" {
		exporter, err := otlptracehttp.New(ctx, otlptracehttp.WithEndpointURL(endpoint+"/v1/traces"))
		if err != nil {
			return nil, err
		}
		options = append(options, sdktrace.WithBatcher(exporter))
	}
	provider := sdktrace.NewTracerProvider(options...)
	otel.SetTracerProvider(provider)
	UsePropagation()
	return provider.Shutdown, nil
}

// UsePropagation reads and writes the W3C traceparent header.
func UsePropagation() {
	otel.SetTextMapPropagator(propagation.TraceContext{})
}

// Middleware starts the request's span and returns its trace ID as X-Request-ID.
// The span is named after the route pattern once the ServeMux has matched it
// (see middleware.Logger). Health checks are not traced.
func Middleware(next http.Handler) http.Handler {
	withID := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if span := trace.SpanContextFromContext(r.Context()); span.IsValid() {
			w.Header().Set("X-Request-ID", span.TraceID().String())
		}
		next.ServeHTTP(w, r)
	})
	return otelhttp.NewHandler(withID, "request",
		otelhttp.WithFilter(func(r *http.Request) bool { return r.URL.Path != "/api/v1/health" }),
		otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string { return r.Method }),
	)
}

// Transport traces outgoing requests, with attrs on each span, and passes the
// trace on in traceparent. Spans hold the method, URL and status, never a body.
func Transport(attrs ...attribute.KeyValue) http.RoundTripper {
	return otelhttp.NewTransport(http.DefaultTransport, otelhttp.WithSpanOptions(trace.WithAttributes(attrs...)))
}

// QueryTracer traces database queries. Spans hold the SQL text with its
// placeholders, never the parameter values.
func QueryTracer() pgx.QueryTracer {
	return otelpgx.NewTracer()
}
