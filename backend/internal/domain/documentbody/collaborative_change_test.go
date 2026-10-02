package documentbody

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
)

// fullCollaborativeValidation is the oracle: the three checks CommitUpdate ran
// before the diff-aware validator existed.
func fullCollaborativeValidation(before, after Body) error {
	if err := Validate(after); err != nil {
		return err
	}
	if err := ValidateExistingStructure(before, after, nil); err != nil {
		return err
	}
	return ValidateOpaquePreservation(before, after)
}

func TestValidateCollaborativeChangeAgreesWithFullValidation(t *testing.T) {
	before, ids := opaqueBody()
	heading := uuid.New()
	before.Nodes = append(before.Nodes, node(before.DocumentID, heading, uuidPointer(ids["root"]), 4, "atx-heading"))

	cases := []struct {
		name   string
		mutate func(*Body)
	}{
		{name: "unchanged"},
		{name: "edit run text", mutate: func(b *Body) { findNode(b, ids["run"]).Content = "tail edited" }},
		{name: "edit paragraph text", mutate: func(b *Body) { findNode(b, ids["quote-paragraph"]).Content = "updated" }},
		{name: "renumber with stable order", mutate: func(b *Body) {
			findNode(b, ids["opaque-block"]).SiblingOrder = 10
			findNode(b, ids["quote-paragraph"]).SiblingOrder = 20
		}},
		{name: "insert paragraph at the start", mutate: func(b *Body) {
			b.Nodes = append(b.Nodes, node(b.DocumentID, uuid.New(), uuidPointer(ids["root"]), 0, "paragraph"))
		}},
		{name: "insert run into paragraph", mutate: func(b *Body) {
			run := node(b.DocumentID, uuid.New(), uuidPointer(ids["inline-paragraph"]), 3, "run")
			run.Content = "more"
			b.Nodes = append(b.Nodes, run)
		}},
		{name: "insert empty run", mutate: func(b *Body) {
			b.Nodes = append(b.Nodes, node(b.DocumentID, uuid.New(), uuidPointer(ids["inline-paragraph"]), 3, "run"))
		}},
		{name: "insert node under a parent that cannot hold it", mutate: func(b *Body) {
			b.Nodes = append(b.Nodes, node(b.DocumentID, uuid.New(), uuidPointer(ids["run"]), 0, "paragraph"))
		}},
		{name: "insert node with a duplicate sibling order", mutate: func(b *Body) {
			b.Nodes = append(b.Nodes, node(b.DocumentID, uuid.New(), uuidPointer(ids["root"]), 1, "paragraph"))
		}},
		{name: "insert node under a missing parent", mutate: func(b *Body) {
			b.Nodes = append(b.Nodes, node(b.DocumentID, uuid.New(), uuidPointer(uuid.New()), 0, "paragraph"))
		}},
		{name: "invalid attributes on changed heading", mutate: func(b *Body) {
			findNode(b, heading).Attributes = json.RawMessage(`{"level":9}`)
		}},
		{name: "valid attributes on changed heading", mutate: func(b *Body) {
			findNode(b, heading).Attributes = json.RawMessage(`{"level":2}`)
		}},
		{name: "attributes not an object", mutate: func(b *Body) {
			findNode(b, ids["quote-paragraph"]).Attributes = json.RawMessage(`[]`)
		}},
		{name: "paragraph becomes heading", mutate: func(b *Body) {
			n := findNode(b, ids["inline-paragraph"])
			n.Type = "atx-heading"
			n.Attributes = json.RawMessage(`{"level":2}`)
		}},
		{name: "paragraph becomes heading with invalid level", mutate: func(b *Body) {
			n := findNode(b, ids["inline-paragraph"])
			n.Type = "atx-heading"
			n.Attributes = json.RawMessage(`{"level":7}`)
		}},
		{name: "paragraph becomes heading without level", mutate: func(b *Body) {
			findNode(b, ids["inline-paragraph"]).Type = "atx-heading"
		}},
		{name: "heading becomes paragraph", mutate: func(b *Body) {
			n := findNode(b, heading)
			n.Type = "paragraph"
			n.Attributes = json.RawMessage(`{}`)
		}},
		{name: "paragraph becomes code block", mutate: func(b *Body) { findNode(b, ids["inline-paragraph"]).Type = "code-block" }},
		{name: "change node type", mutate: func(b *Body) { findNode(b, ids["quote-paragraph"]).Type = "html-block" }},
		{name: "delete existing node", mutate: func(b *Body) { b.Nodes = withoutNode(b.Nodes, ids["quote-paragraph"]) }},
		{name: "delete opaque block", mutate: func(b *Body) { b.Nodes = withoutNode(b.Nodes, ids["opaque-block"]) }},
		{name: "change opaque inline source", mutate: func(b *Body) {
			findNode(b, ids["opaque-inline"]).Content = "<span>changed</span>"
		}},
		{name: "change opaque version", mutate: func(b *Body) { findNode(b, ids["opaque-block"]).Version++ }},
		{name: "change ordinary node version", mutate: func(b *Body) { findNode(b, ids["run"]).Version++ }},
		{name: "move opaque node", mutate: func(b *Body) {
			findNode(b, ids["opaque-block"]).ParentID = uuidPointer(ids["quote-b"])
		}},
		{name: "move ordinary node", mutate: func(b *Body) {
			findNode(b, ids["quote-paragraph"]).ParentID = uuidPointer(ids["quote-b"])
		}},
		{name: "reorder existing siblings", mutate: func(b *Body) {
			findNode(b, ids["quote-a"]).SiblingOrder = 2
			findNode(b, ids["quote-b"]).SiblingOrder = 1
		}},
		{name: "parent cycle", mutate: func(b *Body) {
			findNode(b, ids["quote-a"]).ParentID = uuidPointer(ids["quote-paragraph"])
		}},
		{name: "second root", mutate: func(b *Body) {
			b.Nodes = append(b.Nodes, node(b.DocumentID, uuid.New(), nil, 0, "document"))
		}},
		{name: "node from another document", mutate: func(b *Body) {
			n := node(uuid.New(), uuid.New(), uuidPointer(ids["root"]), 9, "paragraph")
			b.Nodes = append(b.Nodes, n)
		}},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			after := Body{DocumentID: before.DocumentID, RootNodeID: before.RootNodeID, Nodes: append([]Node(nil), before.Nodes...)}
			if test.mutate != nil {
				test.mutate(&after)
			}
			want := fullCollaborativeValidation(before, after)
			got := ValidateCollaborativeChange(before, after)
			if (got == nil) != (want == nil) {
				t.Fatalf("ValidateCollaborativeChange() = %v, full validation = %v", got, want)
			}
		})
	}
}

func TestValidateCollaborativeChangeAcceptsParagraphHeadingConversion(t *testing.T) {
	before, ids := opaqueBody()
	after := Body{DocumentID: before.DocumentID, RootNodeID: before.RootNodeID, Nodes: append([]Node(nil), before.Nodes...)}
	n := findNode(&after, ids["inline-paragraph"])
	n.Type = "atx-heading"
	n.Attributes = json.RawMessage(`{"level":2}`)
	if err := ValidateCollaborativeChange(before, after); err != nil {
		t.Fatalf("paragraph to heading with a valid level: %v", err)
	}
	n.Attributes = json.RawMessage(`{"level":7}`)
	if err := ValidateCollaborativeChange(before, after); err == nil {
		t.Fatal("heading level 7 must stay rejected")
	}
}
