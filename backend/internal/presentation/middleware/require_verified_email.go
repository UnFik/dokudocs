package middleware

import (
	"net/http"

	"backend/internal/presentation/response"
)

// EmailNotVerifiedCode is what clients look for to show the verification page.
const EmailNotVerifiedCode = "email_not_verified"

// RequireVerifiedEmail refuses a signed-in User whose email is not verified. It
// goes after ValidateToken; with enabled false it lets everyone through.
func RequireVerifiedEmail(enabled bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		if !enabled {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, ok := UserFromContext(r.Context())
			if !ok {
				response.Error(w, http.StatusUnauthorized, "missing bearer token")
				return
			}
			if !user.EmailVerified {
				response.ErrorWithCode(w, http.StatusForbidden, EmailNotVerifiedCode, "Verify your email to continue")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
