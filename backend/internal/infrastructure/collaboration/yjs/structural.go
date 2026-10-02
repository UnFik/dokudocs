package yjs

import (
	"fmt"

	"backend/internal/domain/documentbody"

	"github.com/google/uuid"
	"github.com/reearth/ygo/crdt"
)

// Structural commands (DeleteNode, DeleteNodes, MoveNode) change the stored Yjs
// document in place. Rebuilding it from the canonical body with EncodeBodyV1
// would erase every pending suggestion (ADR 0027), because the canonical body
// has none. Editing the stored document keeps everything the command does not
// touch: other blocks, and the suggestions inside them.
//
// Each function checks its result against the body the command computed
// (after), so the stored state and document_nodes cannot drift apart.

// xmlPlace is where an element sits: its parent and its position among all of
// the parent's children, canonical or not.
type xmlPlace struct {
	element *crdt.YXmlElement
	parent  *crdt.YXmlElement
	index   int
}

func openStoredBody(encoded []byte) (*crdt.Doc, *crdt.YXmlElement, error) {
	doc := crdt.New()
	if err := crdt.ApplyUpdateV1(doc, encoded, nil); err != nil {
		doc.Destroy()
		return nil, nil, fmt.Errorf("%w: decode stored state: %v", ErrInvalidProjection, err)
	}
	rootChildren := doc.GetXmlFragment("body").Children()
	if len(rootChildren) != 1 {
		doc.Destroy()
		return nil, nil, fmt.Errorf("%w: stored state has no document root", ErrInvalidProjection)
	}
	root, ok := rootChildren[0].(*crdt.YXmlElement)
	if !ok {
		doc.Destroy()
		return nil, nil, fmt.Errorf("%w: stored state has no XML root", ErrInvalidProjection)
	}
	return doc, root, nil
}

// indexElements records the place of every element that has a node ID.
func indexElements(root *crdt.YXmlElement) map[uuid.UUID]xmlPlace {
	places := map[uuid.UUID]xmlPlace{}
	var visit func(parent *crdt.YXmlElement)
	visit = func(parent *crdt.YXmlElement) {
		for index, child := range parent.Children() {
			element, ok := child.(*crdt.YXmlElement)
			if !ok {
				continue
			}
			if value, ok := element.GetAttribute("nodeID"); ok {
				if id, err := uuid.Parse(value); err == nil {
					places[id] = xmlPlace{element: element, parent: parent, index: index}
				}
			}
			visit(element)
		}
	}
	visit(root)
	return places
}

// DeleteSubtreesV1 removes the subtrees rooted at nodeIDs from the stored state.
// A listed node inside another listed subtree goes with it. after is the body
// the command computed; the result must project to it.
func DeleteSubtreesV1(encoded []byte, nodeIDs []uuid.UUID, after documentbody.Body) ([]byte, error) {
	doc, root, err := openStoredBody(encoded)
	if err != nil {
		return nil, err
	}
	defer doc.Destroy()
	places := indexElements(root)

	doomed := make(map[uuid.UUID]struct{}, len(nodeIDs))
	for _, id := range nodeIDs {
		if _, ok := places[id]; !ok {
			return nil, fmt.Errorf("%w: node %s is missing from the stored state", ErrInvalidProjection, id)
		}
		doomed[id] = struct{}{}
	}
	// Highest index first within a parent, so each delete leaves the positions of
	// the ones still to do as they were.
	var targets []xmlPlace
	for id := range doomed {
		if hasDoomedAncestor(places, doomed, id) {
			continue
		}
		targets = append(targets, places[id])
	}
	for i := range targets {
		for j := i + 1; j < len(targets); j++ {
			if targets[j].parent == targets[i].parent && targets[j].index > targets[i].index {
				targets[i], targets[j] = targets[j], targets[i]
			}
		}
	}
	if err := doc.TransactE(func(tx *crdt.Transaction) error {
		for _, target := range targets {
			target.parent.Delete(tx, target.index, 1)
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return finishStructural(doc, after)
}

// hasDoomedAncestor reports whether a node sits under another node being deleted.
func hasDoomedAncestor(places map[uuid.UUID]xmlPlace, doomed map[uuid.UUID]struct{}, id uuid.UUID) bool {
	for parent := places[id].parent; parent != nil; {
		value, ok := parent.GetAttribute("nodeID")
		if !ok {
			return false
		}
		parentID, err := uuid.Parse(value)
		if err != nil {
			return false
		}
		if _, hit := doomed[parentID]; hit {
			return true
		}
		parent = places[parentID].parent
	}
	return false
}

func finishStructural(doc *crdt.Doc, after documentbody.Body) ([]byte, error) {
	result := crdt.EncodeStateAsUpdateV1(doc, nil)
	projected, err := ProjectV1(result, after.DocumentID)
	if err != nil {
		return nil, err
	}
	if !documentbody.SameContent(after, projected) {
		return nil, fmt.Errorf("%w: structural change differs from the computed body", ErrInvalidProjection)
	}
	return result, nil
}
