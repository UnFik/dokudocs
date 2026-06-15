package api

import (
	"net/http"

	"backend/internal/infrastructure/api/routes"
)

type Route = routes.Route

func NewRouter(routes []Route) http.Handler {
	mux := http.NewServeMux()
	known := make(map[string]map[string]http.Handler, len(routes))
	for _, route := range routes {
		if known[route.Path] == nil {
			known[route.Path] = make(map[string]http.Handler)
		}
		known[route.Path][route.Method] = route.Handler
	}
	for path, methods := range known {
		path := path
		methods := methods
		mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			if handler, ok := methods[r.Method]; ok {
				handler.ServeHTTP(w, r)
				return
			}
			w.Header().Set("Allow", allowHeader(methods))
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		})
	}
	return mux
}

func allowHeader(methods map[string]http.Handler) string {
	allow := "OPTIONS"
	for method := range methods {
		allow += ", " + method
	}
	return allow
}

func Chain(handler http.Handler, middleware ...func(http.Handler) http.Handler) http.Handler {
	for i := len(middleware) - 1; i >= 0; i-- {
		handler = middleware[i](handler)
	}
	return handler
}
