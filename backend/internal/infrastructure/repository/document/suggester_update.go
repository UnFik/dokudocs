package document

import (
	"errors"

	"backend/internal/application/collaboration"
	"backend/internal/domain/documentbody"
	"backend/internal/infrastructure/collaboration/yjs"

	"github.com/google/uuid"
)

// validateSuggesterUpdate judges an update from a user who has comment access but
// not edit access (ADR 0027). Two things must hold:
//
//  1. the canonical body is exactly what it was: no real text or block changed,
//     and nothing real was turned into a suggestion;
//  2. everything in the shared state except this user's own suggestions is
//     exactly what it was: another user's suggestion is untouched, and no
//     suggestion carries someone else's name.
//
// before and after are the canonical bodies; persisted and merged are the encoded
// states without and with the update.
func validateSuggesterUpdate(before, after documentbody.Body, persisted, merged []byte, sender uuid.UUID) error {
	if !sameBody(before, after) {
		return collaboration.ErrSuggesterUpdate
	}
	if err := yjs.ValidateSuggesterChange(persisted, merged, sender); err != nil {
		if errors.Is(err, yjs.ErrSuggestionLimit) {
			return collaboration.ErrSuggestionLimit
		}
		return collaboration.ErrSuggesterUpdate
	}
	return nil
}
