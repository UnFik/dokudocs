package documentbody

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"
)

// The attribute shapes below are exactly what the collaborative editor emits
// when a mark command splits a run (frontend prosemirror/inlineMarks.ts).
func TestValidateAcceptsEditorMarkRuns(t *testing.T) {
	cases := map[string]string{
		"plain":         `{}`,
		"bold":          `{"bold":true}`,
		"italic":        `{"italic":true}`,
		"strike":        `{"strike":true}`,
		"code":          `{"code":true}`,
		"link":          `{"href":"https://example.com/docs"}`,
		"link title":    `{"href":"https://example.com","linkTitle":"docs"}`,
		"bold and link": `{"bold":true,"href":"/relative"}`,
	}
	for name, attributes := range cases {
		t.Run(name, func(t *testing.T) {
			documentID, rootID, paragraphID := uuid.New(), uuid.New(), uuid.New()
			nodes := []Node{
				node(documentID, rootID, nil, 0, "document"),
				node(documentID, paragraphID, &rootID, 1, "paragraph"),
			}
			for index, content := range []string{"h", "ell", "o"} {
				run := node(documentID, uuid.New(), &paragraphID, float64(index+1), "run")
				run.Content = content
				run.Attributes = json.RawMessage(attributes)
				nodes = append(nodes, run)
			}
			if err := Validate(Body{DocumentID: documentID, RootNodeID: rootID, Nodes: nodes}); err != nil {
				t.Fatalf("Validate() error = %v", err)
			}
		})
	}
}

func TestValidateAcceptsEditorHeadingConversion(t *testing.T) {
	documentID, rootID, headingID, runID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	heading := node(documentID, headingID, &rootID, 1, "atx-heading")
	heading.Attributes = json.RawMessage(`{"level":3}`)
	run := node(documentID, runID, &headingID, 1, "run")
	run.Content = "Title"
	body := Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{node(documentID, rootID, nil, 0, "document"), heading, run}}
	if err := Validate(body); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
}

func TestValidateRejectsMalformedEditorMarks(t *testing.T) {
	for _, attributes := range []string{`{"bold":"yes"}`, `{"href":true}`, `{"code":1}`} {
		documentID, rootID, paragraphID := uuid.New(), uuid.New(), uuid.New()
		run := node(documentID, uuid.New(), &paragraphID, 1, "run")
		run.Content = "x"
		run.Attributes = json.RawMessage(attributes)
		body := Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{
			node(documentID, rootID, nil, 0, "document"), node(documentID, paragraphID, &rootID, 1, "paragraph"), run,
		}}
		if err := Validate(body); !errors.Is(err, ErrInvalid) {
			t.Fatalf("attributes %s: error = %v, want ErrInvalid", attributes, err)
		}
	}
}
