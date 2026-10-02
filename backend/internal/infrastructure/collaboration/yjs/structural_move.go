package yjs

import (
	"fmt"

	"backend/internal/domain/documentbody"

	"github.com/google/uuid"
	"github.com/reearth/ygo/crdt"
)

// MoveSubtreeV1 moves the subtree rooted at nodeID in the stored state, before
// beforeNodeID under targetParentID, or at the end of the parent when
// beforeNodeID is nil. Yjs has no move, so the subtree is copied (element
// attributes, text, and every mark, suggestions included) to its new place and
// the original is deleted, in one transaction. after is the body the command
// computed; the result must project to it.
//
// Suggestions that are not canonical stay where they are relative to their own
// neighbours: the subtree goes before the named sibling, whatever sits between.
func MoveSubtreeV1(encoded []byte, nodeID, targetParentID uuid.UUID, beforeNodeID *uuid.UUID, after documentbody.Body) ([]byte, error) {
	doc, root, err := openStoredBody(encoded)
	if err != nil {
		return nil, err
	}
	defer doc.Destroy()
	places := indexElements(root)

	moving, ok := places[nodeID]
	if !ok {
		return nil, fmt.Errorf("%w: node %s is missing from the stored state", ErrInvalidProjection, nodeID)
	}
	target := root
	if value, _ := root.GetAttribute("nodeID"); value != targetParentID.String() {
		place, ok := places[targetParentID]
		if !ok {
			return nil, fmt.Errorf("%w: target parent %s is missing from the stored state", ErrInvalidProjection, targetParentID)
		}
		target = place.element
	}
	index := len(target.Children())
	if beforeNodeID != nil {
		sibling, ok := places[*beforeNodeID]
		if !ok || !sameElement(sibling.parent, target) {
			return nil, fmt.Errorf("%w: node %s is not a child of the target parent", ErrInvalidProjection, *beforeNodeID)
		}
		index = sibling.index
	}
	// The original goes first, so positions after it shift down by one.
	if sameElement(moving.parent, target) && moving.index < index {
		index--
	}
	// Everything is read before the transaction: reading a Yjs type takes the
	// document lock, which a transaction holds.
	copied := snapshotElement(moving.element)

	if err := doc.TransactE(func(tx *crdt.Transaction) error {
		moving.parent.Delete(tx, moving.index, 1)
		target.InsertElement(tx, index, copied.build(tx))
		return nil
	}); err != nil {
		return nil, err
	}
	return finishStructural(doc, after)
}

func sameElement(left, right *crdt.YXmlElement) bool {
	leftID, _ := left.GetAttribute("nodeID")
	rightID, _ := right.GetAttribute("nodeID")
	return leftID != "" && leftID == rightID
}

// elementSnapshot is a subtree read out of the document, so it can be rebuilt
// elsewhere.
type elementSnapshot struct {
	name       string
	attributes map[string]any
	children   []childSnapshot
}

// childSnapshot is either a nested element or a text with its deltas.
type childSnapshot struct {
	element *elementSnapshot
	deltas  []crdt.Delta
}

func snapshotElement(source *crdt.YXmlElement) elementSnapshot {
	snapshot := elementSnapshot{name: source.NodeName, attributes: source.GetAttributeValues()}
	for _, child := range source.Children() {
		switch node := child.(type) {
		case *crdt.YXmlElement:
			nested := snapshotElement(node)
			snapshot.children = append(snapshot.children, childSnapshot{element: &nested})
		case *crdt.YXmlText:
			snapshot.children = append(snapshot.children, childSnapshot{deltas: node.ToDelta()})
		}
	}
	return snapshot
}

func (s elementSnapshot) build(tx *crdt.Transaction) *crdt.YXmlElement {
	element := crdt.NewYXmlElement(s.name)
	for key, value := range s.attributes {
		element.SetAttributeValue(tx, key, value)
	}
	for index, child := range s.children {
		if child.element != nil {
			element.InsertElement(tx, index, child.element.build(tx))
			continue
		}
		text := crdt.NewYXmlText()
		text.ApplyDelta(tx, child.deltas)
		element.InsertText(tx, index, text)
	}
	return element
}
