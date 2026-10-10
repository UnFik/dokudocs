package mention

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/google/uuid"
)

type fixtureCase struct {
	Name     string `json:"name"`
	Content  string `json:"content"`
	Visible  string `json:"visible"`
	Mentions []struct {
		UserID string `json:"userID"`
		Label  string `json:"label"`
	} `json:"mentions"`
}

// The same file drives the TypeScript parser in the frontend, so the two agree.
func loadFixture(t *testing.T) []fixtureCase {
	t.Helper()
	raw, err := os.ReadFile("../../../../fixtures/comment-mentions.json")
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Cases []fixtureCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	return file.Cases
}

func TestParseAndVisibleFollowTheSharedFixture(t *testing.T) {
	for _, tc := range loadFixture(t) {
		tokens := Parse(tc.Content)
		if len(tokens) != len(tc.Mentions) {
			t.Errorf("%s: Parse() found %d mentions, want %d", tc.Name, len(tokens), len(tc.Mentions))
			continue
		}
		for i, want := range tc.Mentions {
			if tokens[i].UserID != uuid.MustParse(want.UserID) || tokens[i].Label != want.Label {
				t.Errorf("%s: mention %d = %+v, want %+v", tc.Name, i, tokens[i], want)
			}
		}
		if got := Visible(tc.Content); got != tc.Visible {
			t.Errorf("%s: Visible() = %q, want %q", tc.Name, got, tc.Visible)
		}
	}
}

func TestRewriteLabelsFromTheirIDs(t *testing.T) {
	ana, bo := uuid.MustParse("11111111-1111-4111-8111-111111111111"), uuid.MustParse("22222222-2222-4222-8222-222222222222")
	got := Rewrite("hi @[old name](user:"+ana.String()+") and @[Bo](user:"+bo.String()+") @ and [x](y)", func(id uuid.UUID) string {
		if id == ana {
			return "Ana Bo"
		}
		return "Bo Ca"
	})
	want := "hi @[Ana Bo](user:" + ana.String() + ") and @[Bo Ca](user:" + bo.String() + ") @ and [x](y)"
	if got != want {
		t.Fatalf("Rewrite() = %q, want %q", got, want)
	}
}

func TestTokenIsTheFormTheEditorWrites(t *testing.T) {
	id := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	if got, want := Token(id, "Ana Bo"), "@[Ana Bo](user:11111111-1111-4111-8111-111111111111)"; got != want {
		t.Fatalf("Token() = %q, want %q", got, want)
	}
}
