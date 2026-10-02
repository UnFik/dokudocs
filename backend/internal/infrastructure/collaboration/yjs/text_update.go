package yjs

import (
	"fmt"

	"backend/internal/domain/documentbody"

	"github.com/google/uuid"
	"github.com/reearth/ygo/crdt"
)

// ApplyTextChangesV1 preserves the shared XML types when an accepted suggestion
// changes only text. Re-encoding a fresh Y.Doc within the same body epoch would
// make older client state merge into a different tree.
func ApplyTextChangesV1(encoded []byte, before, after documentbody.Body) ([]byte, error) {
	if before.DocumentID != after.DocumentID || len(before.Nodes) != len(after.Nodes) {
		return nil, fmt.Errorf("%w: text change has a different tree", ErrInvalidProjection)
	}
	doc := crdt.New()
	defer doc.Destroy()
	if err := crdt.ApplyUpdateV1(doc, encoded, nil); err != nil {
		return nil, fmt.Errorf("%w: decode text change state: %v", ErrInvalidProjection, err)
	}
	rootChildren := doc.GetXmlFragment("body").Children()
	if len(rootChildren) != 1 {
		return nil, fmt.Errorf("%w: text change has no document root", ErrInvalidProjection)
	}
	root, ok := rootChildren[0].(*crdt.YXmlElement)
	if !ok {
		return nil, fmt.Errorf("%w: text change has no XML root", ErrInvalidProjection)
	}
	type patch struct {
		element *crdt.YXmlElement
		texts   []*crdt.YXmlText
		content string
		marks   crdt.Attributes
	}
	var patches []patch
	for index, node := range after.Nodes {
		if before.Nodes[index].NodeID != node.NodeID {
			return nil, fmt.Errorf("%w: text change reordered nodes", ErrInvalidProjection)
		}
		if before.Nodes[index].Content == node.Content {
			continue
		}
		element := findXMLNode(root, node.NodeID)
		if element == nil {
			return nil, fmt.Errorf("%w: text node %s is missing", ErrInvalidProjection, node.NodeID)
		}
		item := patch{element: element, content: node.Content}
		for _, child := range element.Children() {
			text, ok := child.(*crdt.YXmlText)
			if !ok {
				return nil, fmt.Errorf("%w: text node %s contains an element", ErrInvalidProjection, node.NodeID)
			}
			item.texts = append(item.texts, text)
		}
		var err error
		item.marks, err = runMarks(node)
		if err != nil {
			return nil, err
		}
		patches = append(patches, item)
	}
	if err := doc.TransactE(func(tx *crdt.Transaction) error {
		for _, item := range patches {
			if len(item.texts) == 0 {
				text := crdt.NewYXmlText()
				text.Insert(tx, 0, item.content, item.marks)
				item.element.InsertText(tx, 0, text)
				continue
			}
			for _, text := range item.texts {
				text.Delete(tx, 0, text.Len())
			}
			if item.content != "" {
				item.texts[0].Insert(tx, 0, item.content, item.marks)
			}
		}
		return nil
	}); err != nil {
		return nil, err
	}
	result := crdt.EncodeStateAsUpdateV1(doc, nil)
	projected, err := ProjectV1(result, after.DocumentID)
	if err != nil {
		return nil, err
	}
	if !documentbody.SameContent(after, projected) {
		return nil, fmt.Errorf("%w: text change differs from accepted body", ErrInvalidProjection)
	}
	return result, nil
}

func findXMLNode(element *crdt.YXmlElement, id uuid.UUID) *crdt.YXmlElement {
	if value, ok := element.GetAttribute("nodeID"); ok && value == id.String() {
		return element
	}
	for _, child := range element.Children() {
		if nested, ok := child.(*crdt.YXmlElement); ok {
			if found := findXMLNode(nested, id); found != nil {
				return found
			}
		}
	}
	return nil
}
