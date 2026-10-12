// Package searchscope narrows what one question may search. It rides on the
// context, like the usage attribution, so every path that searches documents
// (the answer model's search and the Agent's search tool) honors the same
// choice without each signature growing a parameter.
package searchscope

import (
	"context"

	"github.com/google/uuid"
)

type categoriesKey struct{}

// WithCategories limits document search to documents in any of the categories.
// An empty list changes nothing.
func WithCategories(ctx context.Context, ids []uuid.UUID) context.Context {
	if len(ids) == 0 {
		return ctx
	}
	return context.WithValue(ctx, categoriesKey{}, ids)
}

// Categories are the categories the search is limited to, or none.
func Categories(ctx context.Context) []uuid.UUID {
	ids, _ := ctx.Value(categoriesKey{}).([]uuid.UUID)
	return ids
}
