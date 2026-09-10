package routes

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRouterGroup(t *testing.T) {
	mux := http.NewServeMux()
	root := NewGroup(mux, "/api/v1")

	var executionOrder []string

	globalMdw := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			executionOrder = append(executionOrder, "global")
			next.ServeHTTP(w, r)
		})
	}

	authMdw := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			executionOrder = append(executionOrder, "auth")
			next.ServeHTTP(w, r)
		})
	}

	routeMdw := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			executionOrder = append(executionOrder, "route")
			next.ServeHTTP(w, r)
		})
	}

	root.Use(globalMdw)
	root.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		executionOrder = append(executionOrder, "health")
		w.WriteHeader(http.StatusOK)
	})

	users := root.Group("/users", authMdw)
	users.Get("", func(w http.ResponseWriter, r *http.Request) {
		executionOrder = append(executionOrder, "users-list")
		w.WriteHeader(http.StatusOK)
	})
	users.Get("/me/profile", func(w http.ResponseWriter, r *http.Request) {
		executionOrder = append(executionOrder, "user-profile")
		w.WriteHeader(http.StatusOK)
	}, routeMdw)

	// Test GET /api/v1/health
	t.Run("root route with global middleware", func(t *testing.T) {
		executionOrder = nil
		req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
		if len(executionOrder) != 2 || executionOrder[0] != "global" || executionOrder[1] != "health" {
			t.Fatalf("unexpected execution order: %v", executionOrder)
		}
	})

	// Test GET /api/v1/users
	t.Run("subgroup route with inherited middlewares", func(t *testing.T) {
		executionOrder = nil
		req := httptest.NewRequest(http.MethodGet, "/api/v1/users", nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
		if len(executionOrder) != 3 || executionOrder[0] != "global" || executionOrder[1] != "auth" || executionOrder[2] != "users-list" {
			t.Fatalf("unexpected execution order: %v", executionOrder)
		}
	})

	// Test GET /api/v1/users/me/profile
	t.Run("subgroup route with route-specific middleware", func(t *testing.T) {
		executionOrder = nil
		req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me/profile", nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
		if len(executionOrder) != 4 || executionOrder[0] != "global" || executionOrder[1] != "auth" || executionOrder[2] != "route" || executionOrder[3] != "user-profile" {
			t.Fatalf("unexpected execution order: %v", executionOrder)
		}
	})
}
