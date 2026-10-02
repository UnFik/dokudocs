package seeders

import (
	"encoding/json"
	"testing"
)

func TestBackupStateJSONValid(t *testing.T) {
	if len(backupStateJSON) == 0 {
		t.Fatalf("embedded backupStateJSON is empty")
	}

	var wrapper backupStateWrapper
	if err := json.Unmarshal(backupStateJSON, &wrapper); err != nil {
		t.Fatalf("failed to unmarshal embedded backupStateJSON: %v", err)
	}

	if len(wrapper.State.Organizations) == 0 {
		t.Fatalf("expected organizations in backup state, got 0")
	}
	if len(wrapper.State.Projects) == 0 {
		t.Fatalf("expected projects in backup state, got 0")
	}
	if len(wrapper.State.Documents) == 0 {
		t.Fatalf("expected documents in backup state, got 0")
	}

	t.Logf("Embedded backup contains %d orgs, %d projects, %d documents",
		len(wrapper.State.Organizations),
		len(wrapper.State.Projects),
		len(wrapper.State.Documents),
	)
}

func TestToDeterministicUUID(t *testing.T) {
	u1 := toDeterministicUUID("user", "usr-1")
	u2 := toDeterministicUUID("user", "usr-1")
	if u1 != u2 {
		t.Fatalf("expected deterministic UUID, got %s != %s", u1, u2)
	}
	if u1 != "00000000-0000-0000-0000-000000000002" {
		t.Fatalf("expected special usr-1 UUID, got %s", u1)
	}
}

func TestBackupDocumentOwnerID(t *testing.T) {
	doc := backupDoc{Author: &backupUser{ID: "author"}}
	accesses := []backupAcc{{UserID: "current-owner", AccessLevel: "owner"}}
	if got := backupDocumentOwnerID(doc, accesses, "fallback"); got != toDeterministicUUID("user", "current-owner") {
		t.Fatalf("explicit owner = %q, want current owner", got)
	}
	if got := backupDocumentOwnerID(doc, nil, "fallback"); got != toDeterministicUUID("user", "author") {
		t.Fatalf("legacy author fallback = %q, want author", got)
	}
	if got := backupDocumentOwnerID(backupDoc{}, nil, "fallback"); got != "fallback" {
		t.Fatalf("missing author fallback = %q, want fallback", got)
	}
}
