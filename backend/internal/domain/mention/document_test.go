package mention

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
)

type documentCase struct {
	Name     string `json:"name"`
	Content  string `json:"content"`
	Visible  string `json:"visible"`
	Mentions []struct {
		DocumentID string `json:"documentID"`
		Label      string `json:"label"`
	} `json:"mentions"`
}

// The same file drives the TypeScript parser in the frontend, so the two agree.
func TestDocumentTokensFollowTheSharedFixture(t *testing.T) {
	raw, err := os.ReadFile("../../../../frontend/src/lib/document-mentions.fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Cases []documentCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	for _, tc := range file.Cases {
		found := ParseDocuments(tc.Content)
		if len(found) != len(tc.Mentions) {
			t.Errorf("%s: ParseDocuments() found %d, want %d", tc.Name, len(found), len(tc.Mentions))
			continue
		}
		for i, want := range tc.Mentions {
			if found[i].DocumentID != uuid.MustParse(want.DocumentID) || found[i].Label != want.Label {
				t.Errorf("%s: mention %d = %+v, want %+v", tc.Name, i, found[i], want)
			}
		}
		if got := VisibleDocuments(tc.Content); got != tc.Visible {
			t.Errorf("%s: VisibleDocuments() = %q, want %q", tc.Name, got, tc.Visible)
		}
	}
}

func TestRewriteDocumentsWritesTheLabelFromTheID(t *testing.T) {
	a, b := uuid.MustParse("11111111-1111-4111-8111-111111111111"), uuid.MustParse("22222222-2222-4222-8222-222222222222")
	got := RewriteDocuments("@[stale](doc:"+a.String()+") and @[Other](doc:"+b.String()+") @ [x](y)", func(id uuid.UUID) string {
		if id == a {
			return "Runbook"
		}
		return "Other"
	})
	want := "@[Runbook](doc:" + a.String() + ") and @[Other](doc:" + b.String() + ") @ [x](y)"
	if got != want {
		t.Errorf("RewriteDocuments() = %q, want %q", got, want)
	}
}

func TestDocumentLabelIsCleanedOfWhatWouldBreakAToken(t *testing.T) {
	for in, want := range map[string]string{
		"Plan [draft] (v2) @home": "Plan draft v2 home",
		"  spaced   out  ":        "spaced out",
		"line\nbreak":             "line break",
		"[]()":                    "Untitled",
		"":                        "Untitled",
		strings.Repeat("a", 150):  strings.Repeat("a", 100),
	} {
		if got := DocumentLabel(in); got != want {
			t.Errorf("DocumentLabel(%q) = %q, want %q", in, got, want)
		}
	}
}
