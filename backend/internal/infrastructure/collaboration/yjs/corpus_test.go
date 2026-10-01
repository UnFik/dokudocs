package yjs

import (
	"crypto/sha256"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"backend/internal/domain/documentbody"

	"github.com/google/uuid"
)

const corpusDir = "../../../../../frontend/src/features/docs/lib/muya/state/fixtures"

var corpusTrailingWhitespace = map[string]string{"body-import-source-gap.json": "\n"}

// The frontend fixtures are the shared AST corpus: every one must survive
// import -> validate -> Yjs encode -> Yjs project without changing the AST.
func TestASTYjsRoundTripCorpus(t *testing.T) {
	paths, err := filepath.Glob(filepath.Join(corpusDir, "body-import-*.json"))
	if err != nil || len(paths) == 0 {
		t.Fatalf("corpus fixtures not found: %v", err)
	}
	for _, path := range paths {
		name := filepath.Base(path)
		t.Run(name, func(t *testing.T) {
			source, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			documentID := uuid.MustParse("11111111-1111-4111-8111-111111111111")
			body, err := documentbody.ImportMuyaState(documentID, sha256.Sum256(source), 1, source, corpusTrailingWhitespace[name])
			if err != nil {
				t.Fatalf("ImportMuyaState() = %v", err)
			}
			assertRoundTrip(t, body)

			// A second generation must be stable too (encode of a projection).
			encoded, _ := EncodeBodyV1(body)
			projected, _ := ProjectV1(encoded, documentID)
			assertRoundTrip(t, projected)
		})
	}
}

func TestASTYjsRoundTripKeepsOpaqueSourceAfterEdit(t *testing.T) {
	documentID := uuid.MustParse("22222222-2222-4222-8222-222222222222")
	source, err := os.ReadFile(filepath.Join(corpusDir, "body-import-blocks.json"))
	if err != nil {
		t.Fatal(err)
	}
	body, err := documentbody.ImportMuyaState(documentID, sha256.Sum256(source), 1, source, "")
	if err != nil {
		t.Fatal(err)
	}
	edited := false
	for i := range body.Nodes {
		if body.Nodes[i].Type == "run" && !edited {
			body.Nodes[i].Content += " edited"
			edited = true
		}
	}
	if !edited {
		t.Fatal("corpus has no run to edit")
	}
	assertRoundTrip(t, body)
}

func assertRoundTrip(t *testing.T, body documentbody.Body) {
	t.Helper()
	if err := documentbody.Validate(body); err != nil {
		t.Fatalf("Validate() = %v", err)
	}
	encoded, err := EncodeBodyV1(body)
	if err != nil {
		t.Fatalf("EncodeBodyV1() = %v", err)
	}
	projected, err := ProjectV1(encoded, body.DocumentID)
	if err != nil {
		t.Fatalf("ProjectV1() = %v", err)
	}
	if !documentbody.SameContent(body, projected) {
		var types []string
		for _, n := range projected.Nodes {
			types = append(types, n.Type)
		}
		t.Fatalf("AST changed through Yjs; projected types: %s", strings.Join(types, ","))
	}
}
