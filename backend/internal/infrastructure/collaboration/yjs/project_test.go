package yjs

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"backend/internal/domain/documentbody"

	"github.com/google/uuid"
	"github.com/reearth/ygo/crdt"
)

func TestProjectV1ProjectsMarksAndPreservesOpaqueSource(t *testing.T) {
	documentID, rootID, paragraphID, runID, opaqueID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	doc := crdt.New()
	defer doc.Destroy()
	fragment := doc.GetXmlFragment("body")
	if err := doc.TransactE(func(tx *crdt.Transaction) error {
		root := xmlElement(tx, "document", rootID, `{}`, "")
		paragraph := xmlElement(tx, "paragraph", paragraphID, `{}`, "")
		run := xmlElement(tx, "run", runID, `{"source":"**hello**","boldMarker":"**"}`, "")
		text := crdt.NewYXmlText()
		text.Insert(tx, 0, "hello", crdt.Attributes{"strong": crdt.Attributes{}})
		run.InsertText(tx, 0, text)
		paragraph.InsertElement(tx, 0, run)
		opaque := xmlElement(tx, "opaque", opaqueID, `{}`, "::: unsupported\nkeep bytes")
		root.InsertElement(tx, 0, paragraph)
		root.InsertElement(tx, 1, opaque)
		fragment.InsertElement(tx, 0, root)
		return nil
	}); err != nil {
		t.Fatalf("build Yjs body: %v", err)
	}

	body, err := ProjectV1(crdt.EncodeStateAsUpdateV1(doc, nil), documentID)
	if err != nil {
		t.Fatalf("ProjectV1() error = %v", err)
	}
	if body.RootNodeID != rootID || len(body.Nodes) != 4 {
		t.Fatalf("body root/nodes = %s/%d", body.RootNodeID, len(body.Nodes))
	}
	if got := body.Nodes[2]; got.NodeID != runID || got.Content != "hello" {
		t.Fatalf("run = %+v", got)
	}
	var runAttributes map[string]any
	if err := json.Unmarshal(body.Nodes[2].Attributes, &runAttributes); err != nil {
		t.Fatalf("decode run attributes: %v", err)
	}
	if runAttributes["bold"] != true || runAttributes["boldMarker"] != "**" || runAttributes["source"] != "**hello**" {
		t.Fatalf("run attributes = %#v", runAttributes)
	}
	if got := body.Nodes[3]; got.NodeID != opaqueID || got.Content != "::: unsupported\nkeep bytes" {
		t.Fatalf("opaque source = %+v", got)
	}
}

func TestProjectV1RejectsMixedRunFormatting(t *testing.T) {
	documentID, rootID, paragraphID, runID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	doc := crdt.New()
	defer doc.Destroy()
	fragment := doc.GetXmlFragment("body")
	if err := doc.TransactE(func(tx *crdt.Transaction) error {
		root := xmlElement(tx, "document", rootID, `{}`, "")
		paragraph := xmlElement(tx, "paragraph", paragraphID, `{}`, "")
		run := xmlElement(tx, "run", runID, `{}`, "")
		text := crdt.NewYXmlText()
		text.ApplyDelta(tx, []crdt.Delta{
			{Op: crdt.DeltaOpInsert, Insert: "plain "},
			{Op: crdt.DeltaOpInsert, Insert: "bold", Attributes: crdt.Attributes{"strong": crdt.Attributes{}}},
		})
		run.InsertText(tx, 0, text)
		paragraph.InsertElement(tx, 0, run)
		root.InsertElement(tx, 0, paragraph)
		fragment.InsertElement(tx, 0, root)
		return nil
	}); err != nil {
		t.Fatalf("build Yjs body: %v", err)
	}

	_, err := ProjectV1(crdt.EncodeStateAsUpdateV1(doc, nil), documentID)
	if err == nil || !strings.Contains(err.Error(), "mixed formatting") {
		t.Fatalf("ProjectV1() error = %v, want mixed formatting rejection", err)
	}
}

func TestProjectV1PreservesLegacyParentText(t *testing.T) {
	documentID, rootID, paragraphID := uuid.New(), uuid.New(), uuid.New()
	doc := crdt.New()
	defer doc.Destroy()
	fragment := doc.GetXmlFragment("body")
	if err := doc.TransactE(func(tx *crdt.Transaction) error {
		root := xmlElement(tx, "document", rootID, `{}`, "")
		paragraph := xmlElement(tx, "paragraph", paragraphID, `{}`, "")
		text := crdt.NewYXmlText()
		text.Insert(tx, 0, "legacy", nil)
		paragraph.InsertText(tx, 0, text)
		root.InsertElement(tx, 0, paragraph)
		fragment.InsertElement(tx, 0, root)
		return nil
	}); err != nil {
		t.Fatalf("build Yjs body: %v", err)
	}

	body, err := ProjectV1(crdt.EncodeStateAsUpdateV1(doc, nil), documentID)
	if err != nil {
		t.Fatalf("ProjectV1() error = %v", err)
	}
	if got := body.Nodes[1]; got.NodeID != paragraphID || got.Content != "legacy" {
		t.Fatalf("legacy paragraph = %+v", got)
	}
	if err := documentbody.Validate(body); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
	encodedBody, err := EncodeBodyV1(body)
	if err != nil {
		t.Fatalf("EncodeBodyV1() error = %v", err)
	}
	encodedProjection, err := ProjectV1(encodedBody, documentID)
	if err != nil {
		t.Fatalf("ProjectV1(encoded body) error = %v", err)
	}
	if !documentbody.SameContent(body, encodedProjection) {
		t.Fatal("EncodeBodyV1() did not preserve the full AST")
	}
}

func TestEncodeBodyV1PreservesRootSourceFormatting(t *testing.T) {
	documentID, rootID, tableID, rowID, cellID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	parentID := rootID
	rowParentID, cellParentID := tableID, rowID
	body := documentbody.Body{
		DocumentID: documentID,
		RootNodeID: rootID,
		Nodes: []documentbody.Node{
			{DocumentID: documentID, NodeID: rootID, SiblingOrder: 0, Type: "document", Attributes: json.RawMessage(fmt.Sprintf(`{"trailingWhitespace":"\r\n ","sourceGaps":{"00000000-0000-4000-8000-000000000099":"\n\n\n"},"sourceTables":{"%s":"|a|b|\n|---|---|\n|x|y|"}}`, tableID)), Version: 1},
			{DocumentID: documentID, NodeID: tableID, ParentID: &parentID, SiblingOrder: 0, Type: "table", Attributes: json.RawMessage(`{}`), Version: 1},
			{DocumentID: documentID, NodeID: rowID, ParentID: &rowParentID, SiblingOrder: 0, Type: "table.row", Attributes: json.RawMessage(`{}`), Version: 1},
			{DocumentID: documentID, NodeID: cellID, ParentID: &cellParentID, SiblingOrder: 0, Type: "table.cell", Attributes: json.RawMessage(`{"align":"none"}`), Version: 1},
		},
	}
	encoded, err := EncodeBodyV1(body)
	if err != nil {
		t.Fatalf("EncodeBodyV1() error = %v", err)
	}
	projected, err := ProjectV1(encoded, documentID)
	if err != nil {
		t.Fatalf("ProjectV1() error = %v", err)
	}
	if !documentbody.SameContent(body, projected) {
		t.Fatalf("Yjs projection lost root source formatting: %#v", projected.Nodes[0].Attributes)
	}
}

func TestProjectV1ProjectsFullFrontendSchema(t *testing.T) {
	encoded, err := os.ReadFile("testdata/full_body_v1.b64")
	if err != nil {
		t.Fatalf("read frontend Yjs fixture: %v", err)
	}
	update, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(encoded)))
	if err != nil {
		t.Fatalf("decode frontend Yjs fixture: %v", err)
	}
	documentID := uuid.MustParse("99999999-9999-4999-8999-999999999999")
	body, err := ProjectV1(update, documentID)
	if err != nil {
		t.Fatalf("ProjectV1() error = %v", err)
	}
	if body.RootNodeID != uuid.MustParse("00000000-0000-4000-8000-000000000001") || len(body.Nodes) != 43 {
		t.Fatalf("root/nodes = %s/%d", body.RootNodeID, len(body.Nodes))
	}
	wantTypes := []string{
		"document", "paragraph", "run", "image", "math", "line-break", "opaque-inline", "run", "paragraph",
		"atx-heading", "run", "setext-heading", "run", "thematic-break", "code-block", "html-block",
		"link-reference-definition", "block-quote", "paragraph", "run", "order-list", "list-item", "paragraph",
		"run", "bullet-list", "list-item", "paragraph", "run", "task-list", "task-list-item", "paragraph", "run",
		"table", "table.row", "table.cell", "run", "math-block", "frontmatter", "diagram", "footnote", "paragraph", "run", "opaque",
	}
	for index, node := range body.Nodes {
		if node.Type != wantTypes[index] {
			t.Fatalf("node %d type = %q, want %q", index, node.Type, wantTypes[index])
		}
	}
	if got := body.Nodes[8]; got.Content != "legacy parent text" {
		t.Fatalf("legacy content = %q", got.Content)
	}
	if got := body.Nodes[len(body.Nodes)-1]; got.Content != "::: unsupported syntax\nexact bytes" {
		t.Fatalf("opaque source = %q", got.Content)
	}
	if err := documentbody.Validate(body); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
}

func xmlElement(tx *crdt.Transaction, name string, id uuid.UUID, attributes, content string) *crdt.YXmlElement {
	element := crdt.NewYXmlElement(name)
	element.SetAttributeValue(tx, "nodeID", id.String())
	element.SetAttributeValue(tx, "bodyAttributes", attributes)
	element.SetAttributeValue(tx, "bodyContent", content)
	return element
}
