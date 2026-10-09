package logger

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
)

// Logger writes one JSON object per line, so a log collector can read the fields.
type Logger struct {
	slog *slog.Logger
}

func New() *Logger {
	return NewJSON(os.Stdout)
}

func NewJSON(w io.Writer) *Logger {
	return &Logger{slog: slog.New(slog.NewJSONHandler(w, nil))}
}

func (l *Logger) Printf(format string, args ...any) {
	l.slog.Info(fmt.Sprintf(format, args...))
}

func (l *Logger) Errorf(format string, args ...any) {
	l.slog.Error(fmt.Sprintf(format, args...))
}

func (l *Logger) Fatalf(format string, args ...any) {
	l.slog.Error(fmt.Sprintf(format, args...))
	os.Exit(1)
}

// Log writes one line with the given fields.
func (l *Logger) Log(ctx context.Context, level slog.Level, msg string, attrs ...slog.Attr) {
	l.slog.LogAttrs(ctx, level, msg, attrs...)
}

type requestKey struct{}

// Request holds what is learned about a request while handling it, for its log line.
type Request struct {
	UserID string
}

// WithRequest starts collecting fields for the request's log line.
func WithRequest(ctx context.Context) (context.Context, *Request) {
	request := &Request{}
	return context.WithValue(ctx, requestKey{}, request), request
}

// SetUserID records the signed-in User on the request's log line.
func SetUserID(ctx context.Context, userID string) {
	if request, ok := ctx.Value(requestKey{}).(*Request); ok {
		request.UserID = userID
	}
}
