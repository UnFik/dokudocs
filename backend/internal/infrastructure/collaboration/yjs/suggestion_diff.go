package yjs

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/reearth/ygo/crdt"
)

// A user with comment access may write to the shared body, but only suggestions of
// their own (ADR 0027). ValidateSuggesterChange is the rule the server applies to
// every update from such a user.
//
// The idea is a single comparison. Take the body before the update and the body
// after it, remove everything the sender authored from each, and require the two
// to be identical. What is left is the canonical body and every other user's
// suggestions, so a change to real text, to a block, or to someone else's
// suggestion, or a suggestion forged in someone else's name, all show up as a
// difference. Removing the sender's own contribution means:
//
//   - text with the sender's insert mark is dropped, and a run that held only such
//     text is dropped with it;
//   - the sender's delete and format marks are taken off the text they cover;
//   - a block the sender inserted is dissolved: the block goes, and whatever
//     other users put inside it stays where it was, so deleting such a block is
//     a change to those users' suggestions;
//   - the sender's delete and format suggestions are taken off blocks.
//
// Text the sender inserted may carry only the sender's marks; another author's
// mark on it would be authorship forged on text that this comparison removes.

// ErrSuggesterChange means an update from a user without edit access does more than
// add, change, or remove their own suggestions.
var ErrSuggesterChange = errors.New("the update changes more than the sender's own suggestions")

// ErrSuggestionLimit means an update would give one user more suggestions than a
// document may hold for them.
var ErrSuggestionLimit = errors.New("too many suggestions from one user on this document")

// Limits on what one user may have pending on one document. They bound the
// growth of the shared state; an update that only removes or shrinks is always
// allowed, so a user over a limit can still withdraw.
const (
	MaxSuggestionsPerUser        = 500
	MaxSuggestedTextBytesPerUser = 200_000
	MaxSuggestedNodesPerUser     = 2_000
)

// layerStats counts what the sender has in a body.
type layerStats struct {
	suggestions int
	textBytes   int
	nodes       int
}

// ValidateSuggesterChange reports whether going from before to after, both full
// encoded states, changes only suggestions authored by sender.
func ValidateSuggesterChange(before, after []byte, sender uuid.UUID) error {
	if sender == uuid.Nil {
		return fmt.Errorf("%w: no sender", ErrSuggesterChange)
	}
	beforePrint, beforeStats, err := senderMaskedLayer(before, sender)
	if err != nil {
		return err
	}
	afterPrint, afterStats, err := senderMaskedLayer(after, sender)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrSuggesterChange, err)
	}
	if !bytes.Equal(beforePrint, afterPrint) {
		return ErrSuggesterChange
	}
	if exceeds(afterStats.suggestions, beforeStats.suggestions, MaxSuggestionsPerUser) ||
		exceeds(afterStats.textBytes, beforeStats.textBytes, MaxSuggestedTextBytesPerUser) ||
		exceeds(afterStats.nodes, beforeStats.nodes, MaxSuggestedNodesPerUser) {
		return ErrSuggestionLimit
	}
	return nil
}

// exceeds reports a count over its limit that this update made larger.
func exceeds(after, before, limit int) bool {
	return after > limit && after > before
}

type layerWalker struct {
	sender uuid.UUID
	ids    map[uuid.UUID]struct{}
	stats  layerStats
}

type layerNode struct {
	Name     string         `json:"n"`
	ID       string         `json:"i"`
	Content  string         `json:"c"`
	Other    map[string]any `json:"o,omitempty"`
	Attrs    map[string]any `json:"a,omitempty"`
	Children []any          `json:"k,omitempty"`
}

type layerChunk struct {
	Text  string         `json:"t"`
	Attrs map[string]any `json:"a,omitempty"`
}

// senderMaskedLayer decodes a state and returns a deterministic encoding of its
// body with the sender's contribution taken out, plus what the sender has.
func senderMaskedLayer(state []byte, sender uuid.UUID) ([]byte, layerStats, error) {
	if len(state) == 0 {
		return nil, layerStats{}, projectionError("state is required")
	}
	doc := crdt.New()
	defer doc.Destroy()
	if err := crdt.ApplyUpdateV1(doc, state, nil); err != nil {
		return nil, layerStats{}, fmt.Errorf("%w: decode Yjs state: %v", ErrInvalidProjection, err)
	}
	children := doc.GetXmlFragment("body").Children()
	if len(children) != 1 {
		return nil, layerStats{}, projectionError("body fragment must have one document root")
	}
	root, ok := children[0].(*crdt.YXmlElement)
	if !ok {
		return nil, layerStats{}, projectionError("body fragment root must be an element")
	}
	walker := &layerWalker{sender: sender, ids: map[uuid.UUID]struct{}{}}
	nodes, err := walker.element(root, false)
	if err != nil {
		return nil, layerStats{}, err
	}
	encoded, err := json.Marshal(nodes)
	if err != nil {
		return nil, layerStats{}, err
	}
	walker.stats.suggestions = len(walker.ids)
	return encoded, walker.stats, nil
}

// element returns the masked form of an element: usually one node, none for a run
// that held only the sender's text, and the surviving children for a block the
// sender inserted.
func (w *layerWalker) element(element *crdt.YXmlElement, insideOwnBlock bool) ([]any, error) {
	values := element.GetAttributeValues()
	node := layerNode{Name: element.NodeName, Other: map[string]any{}}
	ownBlock := false
	for key, value := range values {
		switch key {
		case "nodeID":
			node.ID, _ = value.(string)
		case "bodyContent":
			node.Content, _ = value.(string)
		case "bodyAttributes":
			text, _ := value.(string)
			attrs, own, err := w.nodeAttributes(text)
			if err != nil {
				return nil, err
			}
			node.Attrs, ownBlock = attrs, own
		default:
			node.Other[key] = value
		}
	}
	if len(node.Other) == 0 {
		node.Other = nil
	}
	if ownBlock || insideOwnBlock {
		w.stats.nodes++
	}
	sawOwnText := false
	inOwn := insideOwnBlock || ownBlock
	var children []any
	for _, child := range element.Children() {
		switch value := child.(type) {
		case *crdt.YXmlElement:
			masked, err := w.element(value, inOwn)
			if err != nil {
				return nil, err
			}
			children = append(children, masked...)
		case *crdt.YXmlText:
			chunks, own, err := w.text(value, inOwn)
			if err != nil {
				return nil, err
			}
			sawOwnText = sawOwnText || own
			for _, chunk := range chunks {
				children = append(children, chunk)
			}
		default:
			return nil, projectionError("node %s contains an unsupported Yjs XML child", node.ID)
		}
	}
	if ownBlock {
		// The block itself is the sender's; what others put in it is not.
		return children, nil
	}
	_, foreign := node.Attrs["suggestion"]
	if insideOwnBlock && !foreign && len(children) == 0 {
		// Plain content inside a block the sender inserted is the sender's too.
		return nil, nil
	}
	if element.NodeName == "run" && sawOwnText && len(children) == 0 {
		return nil, nil
	}
	node.Children = children
	return []any{node}, nil
}

// nodeAttributes parses a node's bodyAttributes, takes out a suggestion of the
// sender's, and reports whether that suggestion was an insert.
func (w *layerWalker) nodeAttributes(text string) (map[string]any, bool, error) {
	if text == "" || text == "{}" {
		return nil, false, nil
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal([]byte(text), &object); err != nil {
		return nil, false, projectionError("invalid bodyAttributes")
	}
	own := false
	if raw, ok := object["suggestion"]; ok {
		suggestion, err := parseNodeSuggestion(raw)
		if err != nil {
			return nil, false, projectionError("%v", err)
		}
		if suggestion.Author == w.sender {
			w.ids[suggestion.ID] = struct{}{}
			delete(object, "suggestion")
			own = suggestion.Kind == "insert"
		}
	}
	attrs := make(map[string]any, len(object))
	for key, raw := range object {
		var value any
		if err := json.Unmarshal(raw, &value); err != nil {
			return nil, false, projectionError("invalid bodyAttributes")
		}
		attrs[key] = value
	}
	if len(attrs) == 0 {
		return nil, own, nil
	}
	return attrs, own, nil
}

// text returns a text's chunks without the sender's insertions, with the sender's
// marks taken off the rest, and adjacent chunks that now look alike merged.
func (w *layerWalker) text(text *crdt.YXmlText, insideOwnBlock bool) ([]layerChunk, bool, error) {
	var chunks []layerChunk
	sawOwn := false
	for _, delta := range text.ToDelta() {
		if delta.Op != crdt.DeltaOpInsert {
			return nil, false, projectionError("text contains a non-insert delta")
		}
		chunk, ok := delta.Insert.(string)
		if !ok {
			return nil, false, projectionError("text contains a non-text embed")
		}
		attrs := map[string]any{}
		var found []textSuggestion
		for name, value := range delta.Attributes {
			if value == nil {
				continue
			}
			if isSuggestionMark(name) {
				parsed, err := parseTextSuggestionMark(name, value)
				if err != nil {
					return nil, false, projectionError("%v", err)
				}
				found = append(found, parsed)
				continue
			}
			attrs[name] = value
		}
		ownInsert := false
		for _, suggestion := range found {
			if suggestion.Author == w.sender && suggestion.Kind == "insert" {
				ownInsert = true
			}
		}
		if ownInsert {
			for _, suggestion := range found {
				if suggestion.Author != w.sender {
					return nil, false, fmt.Errorf("text the sender inserted carries a mark by %s", suggestion.Author)
				}
				w.ids[suggestion.ID] = struct{}{}
			}
			w.stats.textBytes += len(chunk)
			sawOwn = true
			continue
		}
		foreign := false
		for _, suggestion := range found {
			if suggestion.Author == w.sender {
				w.ids[suggestion.ID] = struct{}{}
				continue
			}
			foreign = true
			attrs["suggestion_"+suggestion.Kind] = delta.Attributes["suggestion_"+suggestion.Kind]
		}
		if insideOwnBlock && !foreign {
			// Plain text inside a block the sender inserted is the sender's.
			w.stats.textBytes += len(chunk)
			sawOwn = true
			continue
		}
		normalized, err := normalizeAttributes(attrs)
		if err != nil {
			return nil, false, err
		}
		if last := len(chunks) - 1; last >= 0 && sameAttributes(chunks[last].Attrs, normalized) {
			chunks[last].Text += chunk
			continue
		}
		chunks = append(chunks, layerChunk{Text: chunk, Attrs: normalized})
	}
	return chunks, sawOwn, nil
}

// normalizeAttributes round-trips attributes through JSON so every nested value has
// one representation and the encoding is the same however the state was built.
func normalizeAttributes(attrs map[string]any) (map[string]any, error) {
	if len(attrs) == 0 {
		return nil, nil
	}
	encoded, err := json.Marshal(attrs)
	if err != nil {
		return nil, err
	}
	var normalized map[string]any
	if err := json.Unmarshal(encoded, &normalized); err != nil {
		return nil, err
	}
	return normalized, nil
}

func sameAttributes(left, right map[string]any) bool {
	leftEncoded, _ := json.Marshal(left)
	rightEncoded, _ := json.Marshal(right)
	return bytes.Equal(leftEncoded, rightEncoded)
}
