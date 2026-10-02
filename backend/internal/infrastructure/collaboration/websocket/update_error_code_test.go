package websocket

import (
	"context"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"net"
	"testing"

	"backend/internal/application/collaboration"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestUpdateErrorCodeSeparatesInfrastructureOutagesFromRejections(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"stale epoch", collaboration.ErrStaleBodyEpoch, "stale_epoch"},
		{"schema mismatch", collaboration.ErrBodySchemaMismatch, "schema_mismatch"},
		{"body not initialized", collaboration.ErrBodyNotInitialized, "body_not_initialized"},
		{"refused connection", &net.OpError{Op: "dial", Err: errors.New("connection refused")}, "unavailable"},
		{"wrapped refused connection", fmt.Errorf("commit: %w", &net.OpError{Op: "read", Err: io.ErrUnexpectedEOF}), "unavailable"},
		{"connection dropped", io.ErrUnexpectedEOF, "unavailable"},
		{"driver bad connection", driver.ErrBadConn, "unavailable"},
		{"deadline", context.DeadlineExceeded, "unavailable"},
		{"failover shutdown", &pgconn.PgError{Code: "57P01"}, "unavailable"},
		{"read-only standby", &pgconn.PgError{Code: "25006"}, "unavailable"},
		{"too many connections", &pgconn.PgError{Code: "53300"}, "unavailable"},
		{"serialization failure", &pgconn.PgError{Code: "40001"}, "unavailable"},
		{"constraint violation", &pgconn.PgError{Code: "23505"}, "update_rejected"},
		{"validation failure", errors.New("opaque node moved"), "update_rejected"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := updateErrorCode(c.err); got != c.want {
				t.Fatalf("updateErrorCode(%v) = %q, want %q", c.err, got, c.want)
			}
		})
	}
}
