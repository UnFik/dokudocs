package main

import (
	"strings"
	"testing"
)

func TestTestDatabaseURLRequiresDisposableDatabase(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		wantErr string
	}{
		{name: "missing", wantErr: "TEST_DATABASE_URL is required"},
		{
			name:    "development database",
			value:   "postgres://postgres:postgres@localhost:5432/dokudocs?sslmode=disable",
			wantErr: "expected dokudocs_test",
		},
		{
			name:    "non postgres scheme",
			value:   "http://localhost/dokudocs_test",
			wantErr: "must use postgres",
		},
		{
			name:  "test database",
			value: "postgres://postgres:postgres@localhost:5432/dokudocs_test?sslmode=disable",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("TEST_DATABASE_URL", test.value)
			got, err := testDatabaseURL()
			if test.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), test.wantErr) {
					t.Fatalf("testDatabaseURL() error = %v, want substring %q", err, test.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("testDatabaseURL() error = %v", err)
			}
			if got != test.value {
				t.Fatalf("testDatabaseURL() = %q, want %q", got, test.value)
			}
		})
	}
}
