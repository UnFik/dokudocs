package policy

import (
	"strings"
	"testing"
)

func TestValidDisplayName(t *testing.T) {
	for name, valid := range map[string]bool{
		"Fikri Ilham":              true,
		"Siti Nur-Aini":            true,
		"O'Brien Jr.":              true,
		"Ñandú Pérez":              true,
		"田中 太郎":                    true,
		"Al":                       true,
		"A":                        false,
		"":                         false,
		"   ":                      false,
		strings.Repeat("a", 100):   true,
		strings.Repeat("a", 101):   false,
		"Fikri [admin]":            false,
		"Fikri (admin)":            false,
		"fikri@example.com":        false,
		"@fikri":                   false,
		"Fikri\nIlham":             false,
		"Fikri\tIlham":             false,
		"Fikri Ilham":              false,
		"Fikri\x00Ilham":           false,
		"Fikri](user:abc) @[Admin": false,
	} {
		if got := ValidDisplayName(name); got != valid {
			t.Errorf("ValidDisplayName(%q) = %v, want %v", name, got, valid)
		}
	}
}

func TestCleanDisplayName(t *testing.T) {
	for _, tc := range []struct{ in, email, want string }{
		{"Fikri Ilham", "f@x.id", "Fikri Ilham"},
		{"  Fikri   Ilham ", "f@x.id", "Fikri Ilham"},
		{"Fikri [Admin] (HQ)", "f@x.id", "Fikri Admin HQ"},
		{"Fikri\nIlham", "f@x.id", "Fikri Ilham"},
		{"fikri@example.com", "f@x.id", "fikri example.com"},
		{"[]()", "f@x.id", "f x.id"},
		{"", "fikri.ilham@x.id", "fikri.ilham x.id"},
		{"A", "fikri@x.id", "fikri x.id"},
		{strings.Repeat("é", 150), "f@x.id", strings.Repeat("é", 100)},
	} {
		got := CleanDisplayName(tc.in, tc.email)
		if got != tc.want {
			t.Errorf("CleanDisplayName(%q, %q) = %q, want %q", tc.in, tc.email, got, tc.want)
		}
		if !ValidDisplayName(got) {
			t.Errorf("CleanDisplayName(%q, %q) = %q, which is not a valid name", tc.in, tc.email, got)
		}
	}
}
