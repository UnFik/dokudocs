package usecase

import (
	"net/url"
	"strings"
	"unicode"
)

const maxRedirectLen = 512

// safeRedirectPath keeps a path inside the app: it must start with one slash and
// hold nothing that a browser or proxy could read as another host or as a
// scheme. Pages that are part of signing in are refused so a redirect cannot
// loop. Anything else is replaced by fallback.
func safeRedirectPath(value, fallback string) string {
	if value == "" || len(value) > maxRedirectLen || !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") {
		return fallback
	}
	for _, r := range value {
		if r == '\\' || r == '%' || unicode.IsSpace(r) || unicode.IsControl(r) {
			return fallback
		}
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "" || parsed.Host != "" {
		return fallback
	}
	for _, prefix := range []string{"/auth", "/sign-in", "/sign-up", "/api", "/forgot-password", "/otp", "/verify-email"} {
		if parsed.Path == prefix || strings.HasPrefix(parsed.Path, prefix+"/") {
			return fallback
		}
	}
	return value
}
