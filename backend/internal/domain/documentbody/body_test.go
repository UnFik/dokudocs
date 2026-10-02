package documentbody

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestValidate(t *testing.T) {
	documentID := uuid.New()
	rootID, listID, itemID, paragraphID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	root, list, item := node(documentID, rootID, nil, 0, "document"), node(documentID, listID, &rootID, 1, "bullet-list"), node(documentID, itemID, &listID, 1, "list-item")
	valid := Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{
		root, list, item, node(documentID, paragraphID, &itemID, 1, "paragraph"),
	}}
	rootWithTrailingWhitespace := node(documentID, rootID, nil, 0, "document")
	rootWithTrailingWhitespace.Attributes = json.RawMessage(`{"trailingWhitespace":"\r\n "}`)

	tests := []struct {
		name string
		body Body
		want error
	}{
		{name: "valid nested list", body: valid},
		{name: "valid root trailing whitespace", body: Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{rootWithTrailingWhitespace}}},
		{name: "cross document", body: Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{root, node(uuid.New(), listID, &rootID, 1, "paragraph")}}, want: ErrInvalid},
		{name: "missing parent", body: Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{root, node(documentID, listID, ptr(uuid.New()), 1, "paragraph")}}, want: ErrInvalid},
		{name: "duplicate sibling order", body: Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{root, list, node(documentID, uuid.New(), &rootID, 1, "paragraph")}}, want: ErrInvalid},
		{name: "invalid parent grammar", body: Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{root, node(documentID, paragraphID, &rootID, 1, "paragraph"), node(documentID, uuid.New(), &paragraphID, 1, "paragraph")}}, want: ErrInvalid},
		{name: "cycle", body: Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{
			root, node(documentID, listID, &itemID, 1, "block-quote"), node(documentID, itemID, &listID, 1, "block-quote"),
		}}, want: ErrInvalid},
		{name: "attributes must be object", body: Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{root, func() Node {
			n := node(documentID, listID, &rootID, 1, "paragraph")
			n.Attributes = json.RawMessage(`[]`)
			return n
		}()}}, want: ErrInvalid},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := Validate(test.body)
			if !errors.Is(err, test.want) {
				t.Fatalf("Validate() error = %v, want %v", err, test.want)
			}
		})
	}
}

func TestValidateDocumentTrailingWhitespace(t *testing.T) {
	tests := []struct {
		name       string
		attributes string
		want       bool
	}{
		{name: "allowed whitespace", attributes: `{"trailingWhitespace":" \t\r\n"}`},
		{name: "allowed source gap", attributes: `{"sourceGaps":{"00000000-0000-4000-8000-000000000001":"\n\n\n"}}`},
		{name: "allowed source indentation", attributes: `{"sourceGaps":{"00000000-0000-4000-8000-000000000001":" "}}`},
		{name: "allowed tight source gap", attributes: `{"sourceGaps":{"00000000-0000-4000-8000-000000000001":""}}`},
		{name: "allowed source table", attributes: `{"sourceTables":{"00000000-0000-4000-8000-000000000001":"|a|\n|-|"}}`},
		{name: "unknown attribute", attributes: `{"source":"# injected"}`, want: true},
		{name: "non-whitespace source", attributes: `{"trailingWhitespace":"# injected"}`, want: true},
		{name: "wrong type", attributes: `{"trailingWhitespace":false}`, want: true},
		{name: "source gap syntax", attributes: `{"sourceGaps":{"00000000-0000-4000-8000-000000000001":"# injected"}}`, want: true},
		{name: "source gap ID", attributes: `{"sourceGaps":{"not-a-node":"\n\n\n"}}`, want: true},
		{name: "source table content", attributes: `{"sourceTables":{"00000000-0000-4000-8000-000000000001":""}}`, want: true},
		{name: "source table ID", attributes: `{"sourceTables":{"not-a-node":"|a|\n|-|"}}`, want: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			documentID, rootID := uuid.New(), uuid.New()
			root := node(documentID, rootID, nil, 0, "document")
			root.Attributes = json.RawMessage(test.attributes)
			err := Validate(Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{root}})
			if (err != nil) != test.want {
				t.Fatalf("Validate() error = %v, want error %v", err, test.want)
			}
		})
	}
}

func TestValidateMuyaParentGrammar(t *testing.T) {
	pairs := [][2]string{
		{"document", "paragraph"}, {"block-quote", "paragraph"}, {"list-item", "paragraph"},
		{"task-list-item", "paragraph"}, {"footnote", "paragraph"}, {"order-list", "list-item"},
		{"bullet-list", "list-item"}, {"task-list", "task-list-item"}, {"table", "table.row"},
		{"table.row", "table.cell"}, {"paragraph", "run"}, {"paragraph", "image"},
		{"paragraph", "math"}, {"paragraph", "line-break"}, {"paragraph", "opaque-inline"},
		{"atx-heading", "run"}, {"setext-heading", "run"}, {"table.cell", "run"},
	}
	for _, pair := range pairs {
		t.Run(pair[0]+" contains "+pair[1], func(t *testing.T) {
			documentID := uuid.New()
			rootID, parentID, childID := uuid.New(), uuid.New(), uuid.New()
			nodes := []Node{node(documentID, rootID, nil, 0, "document")}
			if pair[0] == "document" {
				nodes = append(nodes, node(documentID, childID, &rootID, 1, pair[1]))
			} else if pair[0] == "table.cell" {
				tableID, rowID := uuid.New(), uuid.New()
				nodes = append(nodes,
					node(documentID, tableID, &rootID, 1, "table"),
					node(documentID, rowID, &tableID, 1, "table.row"),
					node(documentID, parentID, &rowID, 1, pair[0]),
				)
				child := validInlineNode(documentID, childID, parentID, pair[1])
				nodes = append(nodes, child)
			} else {
				parentOfParent := rootID
				ancestorType := map[string]string{"list-item": "bullet-list", "task-list-item": "task-list", "table.row": "table"}[pair[0]]
				if ancestorType != "" {
					ancestorID := uuid.New()
					nodes = append(nodes, node(documentID, ancestorID, &rootID, 1, ancestorType))
					parentOfParent = ancestorID
				}
				child := validInlineNode(documentID, childID, parentID, pair[1])
				nodes = append(nodes,
					node(documentID, parentID, &parentOfParent, 1, pair[0]),
					child,
				)
			}
			if err := Validate(Body{DocumentID: documentID, RootNodeID: rootID, Nodes: nodes}); err != nil {
				t.Fatalf("Validate() = %v", err)
			}
		})
	}
}

func TestValidateRejectsEmptyInlinePayload(t *testing.T) {
	for _, nodeType := range []string{"run", "math", "opaque-inline"} {
		t.Run(nodeType, func(t *testing.T) {
			documentID, rootID, paragraphID, inlineID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
			body := Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{
				node(documentID, rootID, nil, 0, "document"),
				node(documentID, paragraphID, &rootID, 1, "paragraph"),
				node(documentID, inlineID, &paragraphID, 1, nodeType),
			}}
			if err := Validate(body); !errors.Is(err, ErrInvalid) {
				t.Fatalf("Validate() error = %v, want %v", err, ErrInvalid)
			}
		})
	}
}

func TestValidateRejectsInvalidMuyaMetadata(t *testing.T) {
	tests := []struct {
		name            string
		nodeType        string
		content         string
		attributes      string
		childType       string
		childContent    string
		childAttributes string
	}{
		{name: "unknown block attribute", nodeType: "paragraph", attributes: `{"future":true}`},
		{name: "ordered list start", nodeType: "order-list", attributes: `{"start":0,"loose":false,"delimiter":"."}`},
		{name: "heading level", nodeType: "atx-heading", attributes: `{"level":7}`},
		{name: "setext underline", nodeType: "setext-heading", attributes: `{"level":1,"underline":"---"}`},
		{name: "fence length", nodeType: "code-block", attributes: `{"type":"fenced","lang":"ts","fenceLength":2}`},
		{name: "frontmatter delimiter", nodeType: "frontmatter", attributes: `{"lang":"yaml","style":"+"}`},
		{name: "diagram language", nodeType: "diagram", attributes: `{"type":"mermaid","lang":"json"}`},
		{name: "container content", nodeType: "block-quote", content: "ignored"},
		{name: "inline attribute value", nodeType: "paragraph", childType: "run", childContent: "text", childAttributes: `{"bold":1}`},
		{name: "inline delimiter", nodeType: "paragraph", childType: "run", childContent: "text", childAttributes: `{"bold":true,"boldMarker":"<x>"}`},
		{name: "image content", nodeType: "paragraph", childType: "image", childContent: "unexpected", childAttributes: `{"src":"image.png","alt":"image"}`},
		{name: "image metadata", nodeType: "paragraph", childType: "image", childAttributes: `{"alt":"image"}`},
		{name: "line break metadata", nodeType: "paragraph", childType: "line-break"},
		{name: "inline math newline", nodeType: "paragraph", childType: "math", childContent: "first\nsecond"},
		{name: "inline code newline", nodeType: "paragraph", childType: "run", childContent: "first\nsecond", childAttributes: `{"code":true}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			documentID, rootID, nodeID := uuid.New(), uuid.New(), uuid.New()
			attributes := test.attributes
			if attributes == "" {
				attributes = `{}`
			}
			body := Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{
				node(documentID, rootID, nil, 0, "document"),
				{
					DocumentID: documentID, NodeID: nodeID, ParentID: &rootID,
					SiblingOrder: 1, Type: test.nodeType, Content: test.content,
					Attributes: json.RawMessage(attributes), Version: 1,
				},
			}}
			if test.childType != "" {
				paragraphID := nodeID
				body.Nodes[1] = node(documentID, paragraphID, &rootID, 1, "paragraph")
				childAttributes := test.childAttributes
				if childAttributes == "" {
					childAttributes = `{}`
				}
				body.Nodes = append(body.Nodes, Node{
					DocumentID: documentID, NodeID: uuid.New(), ParentID: &paragraphID,
					SiblingOrder: 1, Type: test.childType, Content: test.childContent,
					Attributes: json.RawMessage(childAttributes), Version: 1,
				})
			}
			if err := Validate(body); !errors.Is(err, ErrInvalid) {
				t.Fatalf("Validate() error = %v, want %v", err, ErrInvalid)
			}
		})
	}
}

func TestValidateOpaquePreservation(t *testing.T) {
	before, ids := opaqueBody()
	tests := []struct {
		name    string
		mutate  func(*Body)
		wantErr bool
	}{
		{name: "unchanged"},
		{name: "reindex with stable relative order", mutate: func(body *Body) {
			findNode(body, ids["opaque-block"]).SiblingOrder = 10
			findNode(body, ids["quote-paragraph"]).SiblingOrder = 20
			findNode(body, ids["opaque-inline"]).SiblingOrder = 10
			findNode(body, ids["run"]).SiblingOrder = 20
		}},
		{name: "new sibling before opaque", mutate: func(body *Body) {
			body.Nodes = append(body.Nodes, node(body.DocumentID, uuid.New(), uuidPointer(ids["quote-a"]), 0, "paragraph"))
		}},
		{name: "delete unrelated sibling", mutate: func(body *Body) {
			body.Nodes = withoutNode(body.Nodes, ids["quote-paragraph"])
		}},
		{name: "edit unrelated sibling", mutate: func(body *Body) {
			findNode(body, ids["quote-paragraph"]).Content = "updated text"
		}},
		{name: "delete opaque block", mutate: func(body *Body) {
			body.Nodes = withoutNode(body.Nodes, ids["opaque-block"])
		}, wantErr: true},
		{name: "change opaque inline source", mutate: func(body *Body) {
			findNode(body, ids["opaque-inline"]).Content = "<span>changed</span>"
		}, wantErr: true},
		{name: "change opaque version", mutate: func(body *Body) {
			findNode(body, ids["opaque-block"]).Version++
		}, wantErr: true},
		{name: "move opaque node", mutate: func(body *Body) {
			findNode(body, ids["opaque-block"]).ParentID = uuidPointer(ids["quote-b"])
		}, wantErr: true},
		{name: "move opaque ancestor", mutate: func(body *Body) {
			findNode(body, ids["quote-a"]).ParentID = uuidPointer(ids["quote-b"])
		}, wantErr: true},
		{name: "reorder old sibling", mutate: func(body *Body) {
			findNode(body, ids["quote-a"]).SiblingOrder = 2
			findNode(body, ids["quote-b"]).SiblingOrder = 1
		}, wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			after := Body{
				DocumentID: before.DocumentID,
				RootNodeID: before.RootNodeID,
				Nodes:      append([]Node(nil), before.Nodes...),
			}
			if test.mutate != nil {
				test.mutate(&after)
			}
			err := ValidateOpaquePreservation(before, after)
			if (err != nil) != test.wantErr {
				t.Fatalf("ValidateOpaquePreservation() error = %v, wantErr %t", err, test.wantErr)
			}
		})
	}
}

func opaqueBody() (Body, map[string]uuid.UUID) {
	documentID := uuid.New()
	ids := map[string]uuid.UUID{
		"root": uuid.New(), "quote-a": uuid.New(), "quote-b": uuid.New(),
		"opaque-block": uuid.New(), "quote-paragraph": uuid.New(),
		"inline-paragraph": uuid.New(), "opaque-inline": uuid.New(), "run": uuid.New(),
	}
	root := node(documentID, ids["root"], nil, 0, "document")
	quoteA := node(documentID, ids["quote-a"], uuidPointer(ids["root"]), 1, "block-quote")
	quoteB := node(documentID, ids["quote-b"], uuidPointer(ids["root"]), 2, "block-quote")
	opaqueBlock := node(documentID, ids["opaque-block"], uuidPointer(ids["quote-a"]), 1, "opaque")
	opaqueBlock.Content = ":::unknown\nraw bytes\n:::"
	quoteParagraph := node(documentID, ids["quote-paragraph"], uuidPointer(ids["quote-a"]), 2, "paragraph")
	quoteParagraph.Content = "quoted"
	inlineParagraph := node(documentID, ids["inline-paragraph"], uuidPointer(ids["root"]), 3, "paragraph")
	opaqueInline := node(documentID, ids["opaque-inline"], uuidPointer(ids["inline-paragraph"]), 1, "opaque-inline")
	opaqueInline.Content = "<span>raw</span>"
	run := node(documentID, ids["run"], uuidPointer(ids["inline-paragraph"]), 2, "run")
	run.Content = "tail"
	return Body{
		DocumentID: documentID, RootNodeID: ids["root"],
		Nodes: []Node{root, quoteA, quoteB, opaqueBlock, quoteParagraph, inlineParagraph, opaqueInline, run},
	}, ids
}

func findNode(body *Body, id uuid.UUID) *Node {
	for i := range body.Nodes {
		if body.Nodes[i].NodeID == id {
			return &body.Nodes[i]
		}
	}
	panic("test node not found")
}

func withoutNode(nodes []Node, id uuid.UUID) []Node {
	filtered := nodes[:0]
	for _, node := range nodes {
		if node.NodeID != id {
			filtered = append(filtered, node)
		}
	}
	return filtered
}

func validInlineNode(documentID, nodeID, parentID uuid.UUID, nodeType string) Node {
	child := node(documentID, nodeID, &parentID, 1, nodeType)
	if nodeType == "run" || nodeType == "math" || nodeType == "opaque-inline" {
		child.Content = "text"
	}
	return child
}

func node(documentID, nodeID uuid.UUID, parentID *uuid.UUID, order float64, nodeType string) Node {
	attributes := map[string]string{
		"document": "{}", "block-quote": "{}", "list-item": "{}", "paragraph": "{}",
		"thematic-break": "{}", "html-block": "{}", "link-reference-definition": "{}", "opaque": "{}",
		"order-list":  `{"start":1,"loose":false,"delimiter":"."}`,
		"bullet-list": `{"marker":"-","loose":false}`, "task-list": `{"marker":"-","loose":false}`,
		"task-list-item": `{"checked":false}`, "atx-heading": `{"level":1}`,
		"setext-heading": `{"level":1,"underline":"==="}`, "table": "{}", "table.row": "{}",
		"table.cell": `{"align":"none"}`, "code-block": `{"type":"fenced","lang":""}`,
		"math-block": `{"mathStyle":""}`, "frontmatter": `{"lang":"yaml","style":"-"}`,
		"diagram": `{"type":"mermaid","lang":"yaml"}`, "footnote": `{"identifier":"note"}`,
		"run": "{}", "image": `{"src":"","alt":""}`, "math": "{}",
		"line-break": `{"hard":false}`, "opaque-inline": "{}",
	}
	attributeJSON, ok := attributes[nodeType]
	if !ok {
		attributeJSON = "{}"
	}
	return Node{
		DocumentID:   documentID,
		NodeID:       nodeID,
		ParentID:     parentID,
		SiblingOrder: order,
		Type:         nodeType,
		Attributes:   json.RawMessage(attributeJSON),
		Version:      1,
	}
}

func ptr(id uuid.UUID) *uuid.UUID { return &id }
