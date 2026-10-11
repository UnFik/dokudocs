package agent

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

type memPermissions map[uuid.UUID][]string

func (m memPermissions) AIPermissions(_ context.Context, userID uuid.UUID) ([]string, bool, error) {
	caps, ok := m[userID]
	return caps, ok, nil
}

func (m memPermissions) SetAIPermissions(_ context.Context, userID uuid.UUID, caps []string) error {
	m[userID] = caps
	return nil
}

func TestANewUserMayOnlyRead(t *testing.T) {
	svc := NewPermissionService(memPermissions{})
	got, err := svc.Permissions(context.Background(), uuid.New())
	if err != nil || len(got) != 1 || got[0] != CapRead {
		t.Fatalf("Permissions() = %v, %v; want only read", got, err)
	}
}

func TestPermissionsAreSavedInCatalogOrderWithoutDuplicates(t *testing.T) {
	store := memPermissions{}
	svc := NewPermissionService(store)
	user := uuid.New()
	got, err := svc.SetPermissions(context.Background(), user, []string{CapProjects, CapRead, CapProjects, CapContent})
	if err != nil {
		t.Fatalf("SetPermissions(): %v", err)
	}
	want := []string{CapRead, CapContent, CapProjects}
	if len(got) != len(want) {
		t.Fatalf("SetPermissions() = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("SetPermissions() = %v, want %v", got, want)
		}
	}
	if again, _ := svc.Permissions(context.Background(), user); len(again) != 3 {
		t.Fatalf("Permissions() after saving = %v", again)
	}
}

func TestUnknownOrForbiddenCapabilitiesAreRefused(t *testing.T) {
	svc := NewPermissionService(memPermissions{})
	for _, bad := range []string{"delete_project", "workspace", "public_link", "", "READ"} {
		if _, err := svc.SetPermissions(context.Background(), uuid.New(), []string{bad}); !errors.Is(err, ErrUnknownCapability) {
			t.Errorf("SetPermissions(%q) error = %v, want ErrUnknownCapability", bad, err)
		}
	}
}

func TestAUserMayTurnEverythingOff(t *testing.T) {
	store := memPermissions{}
	svc := NewPermissionService(store)
	user := uuid.New()
	if _, err := svc.SetPermissions(context.Background(), user, nil); err != nil {
		t.Fatal(err)
	}
	if got, _ := svc.Permissions(context.Background(), user); len(got) != 0 {
		t.Fatalf("Permissions() = %v, want none", got)
	}
}

func TestTheCatalogNamesEveryCapabilityOnce(t *testing.T) {
	seen := map[string]bool{}
	for _, c := range Catalog {
		if seen[c.Key] || c.Label == "" || c.Description == "" {
			t.Fatalf("catalog entry %+v is a duplicate or incomplete", c)
		}
		seen[c.Key] = true
	}
	for _, key := range []string{CapRead, CapDocuments, CapContent, CapComments, CapProjects} {
		if !seen[key] {
			t.Fatalf("%s is missing from the catalog", key)
		}
	}
}
