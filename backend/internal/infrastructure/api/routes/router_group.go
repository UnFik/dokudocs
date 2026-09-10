package routes

import (
	"net/http"
	"strings"
)

// Middleware is a standard http middleware function.
type Middleware = func(http.Handler) http.Handler

// Router provides route grouping and method registration matching modern Go routing conventions.
type Router interface {
	Group(prefix string, middlewares ...Middleware) Router
	Use(middlewares ...Middleware)
	Handle(method, path string, handler http.Handler, middlewares ...Middleware)
	HandleFunc(method, path string, handler http.HandlerFunc, middlewares ...Middleware)
	Get(path string, handler http.HandlerFunc, middlewares ...Middleware)
	Post(path string, handler http.HandlerFunc, middlewares ...Middleware)
	Put(path string, handler http.HandlerFunc, middlewares ...Middleware)
	Delete(path string, handler http.HandlerFunc, middlewares ...Middleware)
	Patch(path string, handler http.HandlerFunc, middlewares ...Middleware)
}

// Group implements Router for http.ServeMux with prefix concatenation and middleware chaining.
type Group struct {
	mux         *http.ServeMux
	prefix      string
	middlewares []Middleware
}

// NewGroup creates a root route group attached to the provided ServeMux.
func NewGroup(mux *http.ServeMux, prefix string, middlewares ...Middleware) *Group {
	return &Group{
		mux:         mux,
		prefix:      cleanPath(prefix),
		middlewares: middlewares,
	}
}

// Group creates a sub-group with an extended prefix and inherits parent middlewares.
func (g *Group) Group(prefix string, middlewares ...Middleware) Router {
	combined := make([]Middleware, 0, len(g.middlewares)+len(middlewares))
	combined = append(combined, g.middlewares...)
	combined = append(combined, middlewares...)

	return &Group{
		mux:         g.mux,
		prefix:      joinPaths(g.prefix, prefix),
		middlewares: combined,
	}
}

// Use appends middlewares to the current group.
func (g *Group) Use(middlewares ...Middleware) {
	g.middlewares = append(g.middlewares, middlewares...)
}

// Handle registers a route with method, path, and middleware chaining.
func (g *Group) Handle(method, path string, handler http.Handler, middlewares ...Middleware) {
	fullPath := joinPaths(g.prefix, path)
	pattern := strings.TrimSpace(method) + " " + fullPath

	allMiddlewares := make([]Middleware, 0, len(g.middlewares)+len(middlewares))
	allMiddlewares = append(allMiddlewares, g.middlewares...)
	allMiddlewares = append(allMiddlewares, middlewares...)

	g.mux.Handle(pattern, chain(handler, allMiddlewares...))
}

// HandleFunc registers a route with method, path, and http.HandlerFunc.
func (g *Group) HandleFunc(method, path string, handler http.HandlerFunc, middlewares ...Middleware) {
	g.Handle(method, path, handler, middlewares...)
}

// Get registers a GET route.
func (g *Group) Get(path string, handler http.HandlerFunc, middlewares ...Middleware) {
	g.HandleFunc(http.MethodGet, path, handler, middlewares...)
}

// Post registers a POST route.
func (g *Group) Post(path string, handler http.HandlerFunc, middlewares ...Middleware) {
	g.HandleFunc(http.MethodPost, path, handler, middlewares...)
}

// Put registers a PUT route.
func (g *Group) Put(path string, handler http.HandlerFunc, middlewares ...Middleware) {
	g.HandleFunc(http.MethodPut, path, handler, middlewares...)
}

// Delete registers a DELETE route.
func (g *Group) Delete(path string, handler http.HandlerFunc, middlewares ...Middleware) {
	g.HandleFunc(http.MethodDelete, path, handler, middlewares...)
}

// Patch registers a PATCH route.
func (g *Group) Patch(path string, handler http.HandlerFunc, middlewares ...Middleware) {
	g.HandleFunc(http.MethodPatch, path, handler, middlewares...)
}

func cleanPath(p string) string {
	p = strings.TrimSpace(p)
	if p == "" || p == "/" {
		return ""
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return strings.TrimSuffix(p, "/")
}

func joinPaths(base, path string) string {
	base = strings.TrimSuffix(strings.TrimSpace(base), "/")
	path = strings.TrimSpace(path)

	if path == "" || path == "/" {
		if base == "" {
			return "/"
		}
		return base
	}

	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}

	return base + path
}

func chain(handler http.Handler, middlewares ...Middleware) http.Handler {
	for i := len(middlewares) - 1; i >= 0; i-- {
		handler = middlewares[i](handler)
	}
	return handler
}
