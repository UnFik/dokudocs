package yjs

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"backend/internal/domain/documentbody"

	"github.com/google/uuid"
	"github.com/reearth/ygo/crdt"
)

const BodySchemaVersionV1 = 1

// EncodeBodyV1 creates the canonical ProseMirror/Yjs state for a validated AST.
// It rejects AST data that the current Yjs projection cannot preserve exactly.
func EncodeBodyV1(body documentbody.Body) ([]byte, error) {
	if err := documentbody.Validate(body); err != nil {
		return nil, err
	}

	nodes := make(map[uuid.UUID]documentbody.Node, len(body.Nodes))
	children := make(map[uuid.UUID][]documentbody.Node)
	for _, node := range body.Nodes {
		nodes[node.NodeID] = node
		if node.ParentID != nil {
			parentID := *node.ParentID
			children[parentID] = append(children[parentID], node)
		}
	}
	for parentID := range children {
		sort.Slice(children[parentID], func(i, j int) bool {
			return children[parentID][i].SiblingOrder < children[parentID][j].SiblingOrder
		})
	}

	doc := crdt.New()
	defer doc.Destroy()
	fragment := doc.GetXmlFragment("body")
	var buildErr error
	doc.Transact(func(txn *crdt.Transaction) {
		root, err := encodeElement(txn, nodes[body.RootNodeID], children)
		if err != nil {
			buildErr = err
			return
		}
		fragment.InsertElement(txn, 0, root)
	})
	if buildErr != nil {
		return nil, buildErr
	}
	encoded := crdt.EncodeStateAsUpdateV1(doc, nil)
	projected, err := ProjectV1(encoded, body.DocumentID)
	if err != nil {
		return nil, err
	}
	if !documentbody.SameContent(body, projected) {
		return nil, fmt.Errorf("%w: AST cannot be represented losslessly in Yjs", ErrInvalidProjection)
	}
	return encoded, nil
}

func encodeElement(txn *crdt.Transaction, node documentbody.Node, children map[uuid.UUID][]documentbody.Node) (*crdt.YXmlElement, error) {
	attributes, err := canonicalObject(node.Attributes)
	if err != nil {
		return nil, fmt.Errorf("%w: node %s attributes: %v", ErrInvalidProjection, node.NodeID, err)
	}
	content := ""
	if node.Type == "opaque" || node.Type == "opaque-inline" || node.Type == "thematic-break" {
		content = node.Content
	}
	element := crdt.NewYXmlElement(proseMirrorNodeName(node.Type))
	element.SetAttribute(txn, "nodeID", node.NodeID.String())
	element.SetAttribute(txn, "bodyAttributes", string(attributes))
	element.SetAttribute(txn, "bodyContent", content)

	nodeChildren := children[node.NodeID]
	if isInlineParent(node.Type) && node.Content != "" && len(nodeChildren) > 0 {
		return nil, fmt.Errorf("%w: inline parent %s mixes text and child nodes", ErrInvalidProjection, node.NodeID)
	}
	if isTextOnly(node.Type) || node.Type == "run" || (isInlineParent(node.Type) && len(nodeChildren) == 0) {
		if node.Content != "" {
			text := crdt.NewYXmlText()
			marks, err := runMarks(node)
			if err != nil {
				return nil, err
			}
			text.Insert(txn, 0, node.Content, marks)
			element.InsertText(txn, 0, text)
		}
	}
	for index, child := range nodeChildren {
		encodedChild, err := encodeElement(txn, child, children)
		if err != nil {
			return nil, err
		}
		element.InsertElement(txn, index, encodedChild)
	}
	return element, nil
}

func runMarks(node documentbody.Node) (crdt.Attributes, error) {
	if node.Type != "run" {
		return nil, nil
	}
	var attributes map[string]json.RawMessage
	if err := json.Unmarshal(node.Attributes, &attributes); err != nil {
		return nil, fmt.Errorf("%w: run %s attributes: %v", ErrInvalidProjection, node.NodeID, err)
	}
	marks := make(crdt.Attributes)
	for key, mark := range map[string]string{"bold": "strong", "italic": "em", "strike": "strike", "code": "code"} {
		var enabled bool
		if raw := attributes[key]; len(raw) > 0 {
			if err := json.Unmarshal(raw, &enabled); err != nil {
				return nil, fmt.Errorf("%w: run %s mark %q is invalid", ErrInvalidProjection, node.NodeID, key)
			}
		}
		if enabled {
			marks[mark] = map[string]any{}
		}
	}
	if raw := attributes["href"]; len(raw) > 0 {
		var href string
		if err := json.Unmarshal(raw, &href); err != nil || href == "" {
			return nil, fmt.Errorf("%w: run %s link href is invalid", ErrInvalidProjection, node.NodeID)
		}
		link := map[string]any{"href": href}
		if rawTitle := attributes["linkTitle"]; len(rawTitle) > 0 {
			var title string
			if err := json.Unmarshal(rawTitle, &title); err != nil {
				return nil, fmt.Errorf("%w: run %s link title is invalid", ErrInvalidProjection, node.NodeID)
			}
			link["title"] = title
		}
		marks["link"] = link
	}
	return marks, nil
}

func proseMirrorNodeName(nodeType string) string {
	switch nodeType {
	case "table.row":
		return "table_row"
	case "table.cell":
		return "table_cell"
	default:
		return strings.ReplaceAll(nodeType, "-", "_")
	}
}

func canonicalObject(raw json.RawMessage) ([]byte, error) {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil || object == nil {
		return nil, documentbody.ErrInvalid
	}
	return json.Marshal(object)
}
