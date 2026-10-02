package documentbody

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
)

func TestImportMuyaState(t *testing.T) {
	documentID := uuid.New()
	fingerprint := sha256.Sum256([]byte("# Plan\n\n- [x] ship"))
	source := []byte(`[
		{"name":"atx-heading","meta":{"level":1},"text":"Plan"},
		{"name":"task-list","meta":{"marker":"-","loose":false},"children":[
			{"name":"task-list-item","meta":{"checked":true},"children":[
				{"name":"paragraph","text":"ship"}
			]}
		]}
	]`)

	first, err := ImportMuyaState(documentID, fingerprint, 1, source, "")
	if err != nil {
		t.Fatalf("ImportMuyaState() error = %v", err)
	}
	if err := Validate(first); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
	if len(first.Nodes) != 5 || first.Nodes[1].Content != "Plan" || string(first.Nodes[1].Attributes) != `{"level":1}` {
		t.Fatalf("unexpected imported nodes: %#v", first.Nodes)
	}
	if first.Nodes[3].Type != "task-list-item" || string(first.Nodes[3].Attributes) != `{"checked":true}` {
		t.Fatalf("task-list metadata was not preserved: %#v", first.Nodes[3])
	}

	second, err := ImportMuyaState(documentID, fingerprint, 1, source, "")
	if err != nil {
		t.Fatalf("second ImportMuyaState() error = %v", err)
	}
	for i := range first.Nodes {
		if first.Nodes[i].NodeID != second.Nodes[i].NodeID {
			t.Fatalf("node %d ID changed for identical import", i)
		}
	}

	changedFingerprint := sha256.Sum256([]byte("different source"))
	changed, err := ImportMuyaState(documentID, changedFingerprint, 1, source, "")
	if err != nil {
		t.Fatalf("changed ImportMuyaState() error = %v", err)
	}
	if first.Nodes[1].NodeID == changed.Nodes[1].NodeID {
		t.Fatal("source fingerprint change must change imported node IDs")
	}
}

func TestImportMuyaStateAcceptsSharedBlockFixture(t *testing.T) {
	documentID := uuid.New()
	fingerprint := sha256.Sum256([]byte("full block AST metadata"))
	source, err := os.ReadFile("../../../../frontend/src/features/docs/lib/muya/state/fixtures/body-import-blocks.json")
	if err != nil {
		t.Fatalf("read shared frontend fixture: %v", err)
	}
	if _, err := ImportMuyaState(documentID, fingerprint, 1, source, ""); err != nil {
		t.Fatalf("ImportMuyaState() rejected shared frontend state: %v", err)
	}
}

func TestImportMuyaStatePreservesSourceGap(t *testing.T) {
	documentID := uuid.MustParse("149a8d07-8490-43ed-98fa-ebaa91b05e90")
	markdown := "first\n\n\nsecond\n"
	fingerprint := sha256.Sum256([]byte(markdown))
	state, err := os.ReadFile("../../../../frontend/src/features/docs/lib/muya/state/fixtures/body-import-source-gap.json")
	if err != nil {
		t.Fatalf("read shared source gap fixture: %v", err)
	}
	body, err := ImportMuyaState(documentID, fingerprint, 1, state, "\n")
	if err != nil {
		t.Fatalf("ImportMuyaState() error = %v", err)
	}
	var rootAttributes struct {
		SourceGaps map[string]string `json:"sourceGaps"`
	}
	if err := json.Unmarshal(body.Nodes[0].Attributes, &rootAttributes); err != nil {
		t.Fatalf("decode root attributes: %v", err)
	}
	if len(body.Nodes) != 5 {
		t.Fatalf("imported %d nodes, want root + 2 paragraphs + 2 runs", len(body.Nodes))
	}
	if body.Nodes[3].NodeID != uuid.MustParse("5292761d-67da-50fb-aae1-d90ef0b55fde") {
		t.Fatalf("gap paragraph node ID = %s, want frontend ID", body.Nodes[3].NodeID)
	}
	if got := rootAttributes.SourceGaps[body.Nodes[3].NodeID.String()]; got != "\n\n\n" {
		t.Fatalf("source gap = %q, want three newlines", got)
	}
}

func TestImportMuyaStatePreservesTightSourceGap(t *testing.T) {
	documentID := uuid.MustParse("149a8d07-8490-43ed-98fa-ebaa91b05e90")
	markdown := "# heading\n- item"
	fingerprint := sha256.Sum256([]byte(markdown))
	state, err := os.ReadFile("../../../../frontend/src/features/docs/lib/muya/state/fixtures/body-import-tight-gap.json")
	if err != nil {
		t.Fatalf("read shared tight source gap fixture: %v", err)
	}
	body, err := ImportMuyaState(documentID, fingerprint, 1, state, "")
	if err != nil {
		t.Fatalf("ImportMuyaState() error = %v", err)
	}
	var rootAttributes struct {
		SourceGaps map[string]string `json:"sourceGaps"`
	}
	if err := json.Unmarshal(body.Nodes[0].Attributes, &rootAttributes); err != nil {
		t.Fatalf("decode root attributes: %v", err)
	}
	var listID string
	for _, node := range body.Nodes {
		if node.Type == "bullet-list" {
			listID = node.NodeID.String()
			break
		}
	}
	if gap, ok := rootAttributes.SourceGaps[listID]; !ok || gap != "" {
		t.Fatalf("tight source gap = %q, present = %t; want empty value", gap, ok)
	}
}

func TestImportMuyaStatePreservesSourceTable(t *testing.T) {
	documentID := uuid.MustParse("149a8d07-8490-43ed-98fa-ebaa91b05e90")
	markdown := "|a|b|\n|---|---|\n|x|y|"
	fingerprint := sha256.Sum256([]byte(markdown))
	state, err := os.ReadFile("../../../../frontend/src/features/docs/lib/muya/state/fixtures/body-import-source-table.json")
	if err != nil {
		t.Fatalf("read shared source table fixture: %v", err)
	}
	body, err := ImportMuyaState(documentID, fingerprint, 1, state, "")
	if err != nil {
		t.Fatalf("ImportMuyaState() error = %v", err)
	}
	var rootAttributes struct {
		SourceTables map[string]string `json:"sourceTables"`
	}
	if err := json.Unmarshal(body.Nodes[0].Attributes, &rootAttributes); err != nil {
		t.Fatalf("decode root attributes: %v", err)
	}
	for _, node := range body.Nodes {
		if node.Type == "table" && rootAttributes.SourceTables[node.NodeID.String()] == markdown {
			return
		}
	}
	t.Fatalf("source table metadata not attached to imported table: %#v", rootAttributes.SourceTables)
}

func TestImportMuyaStateProjectsEnrichedInlineNodes(t *testing.T) {
	documentID := uuid.New()
	fingerprint := sha256.Sum256([]byte("**Ship** ~later~"))
	source, err := os.ReadFile("../../../../frontend/src/features/docs/lib/muya/state/fixtures/body-import-inline.json")
	if err != nil {
		t.Fatalf("read shared frontend fixture: %v", err)
	}

	first, err := ImportMuyaState(documentID, fingerprint, 1, source, "")
	if err != nil {
		t.Fatalf("ImportMuyaState() error = %v", err)
	}
	if len(first.Nodes) != 5 || first.Nodes[1].Content != "" {
		t.Fatalf("unexpected imported body: %#v", first.Nodes)
	}
	if first.Nodes[2].Type != "run" || first.Nodes[2].Content != "Ship" || first.Nodes[2].ParentID == nil || *first.Nodes[2].ParentID != first.Nodes[1].NodeID {
		t.Fatalf("run node was not attached to its paragraph: %#v", first.Nodes[2])
	}
	if first.Nodes[4].Type != "opaque-inline" || first.Nodes[4].Content != "~later~" {
		t.Fatalf("opaque syntax was not preserved: %#v", first.Nodes[4])
	}
	if err := Validate(first); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}

	second, err := ImportMuyaState(documentID, fingerprint, 1, source, "")
	if err != nil {
		t.Fatalf("second ImportMuyaState() error = %v", err)
	}
	for i := range first.Nodes {
		if first.Nodes[i].NodeID != second.Nodes[i].NodeID {
			t.Fatalf("node %d ID changed for identical enriched import", i)
		}
	}
}

func TestImportMuyaStatePreservesReferenceLinkDefinition(t *testing.T) {
	documentID := uuid.New()
	fingerprint := sha256.Sum256([]byte("Read [guide][docs].\n\n[docs]: https://example.com \"Docs\""))
	source, err := os.ReadFile("../../../../frontend/src/features/docs/lib/muya/state/fixtures/body-import-reference-link.json")
	if err != nil {
		t.Fatalf("read shared frontend fixture: %v", err)
	}

	body, err := ImportMuyaState(documentID, fingerprint, 1, source, "")
	if err != nil {
		t.Fatalf("ImportMuyaState() error = %v", err)
	}
	if len(body.Nodes) != 6 {
		t.Fatalf("imported %d nodes, want root + paragraph + 3 runs + reference definition", len(body.Nodes))
	}
	if body.Nodes[2].Type != "run" || body.Nodes[2].Content != "Read " {
		t.Fatalf("first text run = %#v", body.Nodes[2])
	}
	if body.Nodes[3].Type != "run" || body.Nodes[3].Content != "guide" {
		t.Fatalf("reference text run = %#v", body.Nodes[3])
	}
	var linkAttributes map[string]any
	if err := json.Unmarshal(body.Nodes[3].Attributes, &linkAttributes); err != nil {
		t.Fatalf("decode reference link attributes: %v", err)
	}
	if linkAttributes["href"] != "https://example.com" || linkAttributes["linkTitle"] != "Docs" {
		t.Fatalf("reference link wasn't resolved: %#v", linkAttributes)
	}
	if body.Nodes[5].Type != "link-reference-definition" || body.Nodes[5].Content != `[docs]: https://example.com "Docs"` {
		t.Fatalf("reference definition was dropped or mis-typed: %#v", body.Nodes[5])
	}
	if err := Validate(body); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
}

func TestImportMuyaStateRejectsInvalidInput(t *testing.T) {
	fingerprint := sha256.Sum256([]byte("source"))
	tests := []struct {
		name               string
		docID              uuid.UUID
		version            int
		source             string
		trailingWhitespace string
	}{
		{name: "nil document", docID: uuid.Nil, version: 1, source: `[]`},
		{name: "unsupported schema", docID: uuid.New(), version: 0, source: `[]`},
		{name: "not an array", docID: uuid.New(), version: 1, source: `{}`},
		{name: "unknown field", docID: uuid.New(), version: 1, source: `[{"name":"paragraph","text":"x","id":"unexpected"}]`},
		{name: "null text", docID: uuid.New(), version: 1, source: `[{"name":"paragraph","text":null}]`},
		{name: "invalid hierarchy", docID: uuid.New(), version: 1, source: `[{"name":"paragraph","children":[{"name":"paragraph"}]}]`},
		{name: "inline on container", docID: uuid.New(), version: 1, source: `[{"name":"block-quote","inline":[]}]`},
		{name: "unknown inline type", docID: uuid.New(), version: 1, source: `[{"name":"paragraph","inline":[{"type":"mystery","attributes":{}}]}]`},
		{name: "invalid inline attributes", docID: uuid.New(), version: 1, source: `[{"name":"paragraph","inline":[{"type":"run","content":"x","attributes":[]}]}]`},
		{name: "empty run content", docID: uuid.New(), version: 1, source: `[{"name":"paragraph","inline":[{"type":"run","content":"","attributes":{}}]}]`},
		{name: "invalid trailing whitespace", docID: uuid.New(), version: 1, source: `[]`, trailingWhitespace: "# injection"},
		{name: "invalid source gap", docID: uuid.New(), version: 1, source: `[{"name":"paragraph","text":"x","sourceGap":"# injected"}]`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := ImportMuyaState(test.docID, fingerprint, test.version, []byte(test.source), test.trailingWhitespace)
			if !errors.Is(err, ErrInvalid) {
				t.Fatalf("ImportMuyaState() error = %v, want %v", err, ErrInvalid)
			}
		})
	}

}

func TestImportMuyaStateBootstrapIdentity(t *testing.T) {
	documentID := uuid.MustParse("149a8d07-8490-43ed-98fa-ebaa91b05e90")
	markdown := "# **Plan**\n\n- [x] ship\n"
	fingerprint := sha256.Sum256([]byte(markdown))
	source, err := os.ReadFile("../../../../frontend/src/features/docs/lib/muya/state/fixtures/body-import-bootstrap.json")
	if err != nil {
		t.Fatalf("read browser bootstrap fixture: %v", err)
	}
	body, err := ImportMuyaState(documentID, fingerprint, 1, source, "\n")
	if err != nil {
		t.Fatalf("ImportMuyaState() error = %v", err)
	}
	wantIDs := []uuid.UUID{
		uuid.MustParse("86ba28c5-daf4-53ec-b583-0a72ee65b38c"),
		uuid.MustParse("4ac70c64-ac57-5399-a623-0d7f72b54bf8"),
		uuid.MustParse("e45ea7b4-a85c-5198-8636-1c04fef67465"),
		uuid.MustParse("f45019f5-ab8a-5061-abbf-588a9652f644"),
		uuid.MustParse("ba5a5165-8355-57c4-a1c8-bcad0491bdc7"),
		uuid.MustParse("bbbdf10f-2eaf-53ad-a455-63d695eb7aca"),
		uuid.MustParse("6bf4e016-d4eb-5370-9578-a2b8da9d4189"),
	}
	if len(body.Nodes) != len(wantIDs) || body.RootNodeID != wantIDs[0] {
		t.Fatalf("imported root and %d nodes; want root %s and %d nodes", body.RootNodeID, wantIDs[0], len(wantIDs))
	}
	if string(body.Nodes[0].Attributes) != `{"trailingWhitespace":"\n"}` {
		t.Fatalf("root trailing whitespace = %s, want persisted newline metadata", body.Nodes[0].Attributes)
	}
	for index, wantID := range wantIDs {
		if body.Nodes[index].NodeID != wantID {
			t.Fatalf("node %d ID = %s, want browser bootstrap ID %s", index, body.Nodes[index].NodeID, wantID)
		}
	}
}
