package usecase

import "testing"

func TestProfileNameCleansWhatAProviderSends(t *testing.T) {
	for _, tc := range []struct{ name, email, want string }{
		{"Fikri Ilham", "f@x.id", "Fikri Ilham"},
		{"Fikri [Google] (HQ)", "f@x.id", "Fikri Google HQ"},
		{"Fikri\nIlham", "f@x.id", "Fikri Ilham"},
		{"", "fikri@x.id", "fikri x.id"},
	} {
		if got := profileName(tc.name, tc.email); got != tc.want {
			t.Errorf("profileName(%q, %q) = %q, want %q", tc.name, tc.email, got, tc.want)
		}
	}
}
