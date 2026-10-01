package documentbody

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
)

// ImportMuyaState converts versioned Muya block state, optionally enriched with
// inline nodes from the Muya lexer, into a document body. Blocks without inline
// data remain provisional and preserve their text in Content. The fingerprint
// must be SHA-256 of the Markdown source, and trailingWhitespace must be its
// exact final run of spaces, tabs, CRs, and LFs.
func ImportMuyaState(documentID uuid.UUID, sourceFingerprint [sha256.Size]byte, schemaVersion int, source []byte, trailingWhitespace string) (Body, error) {
	if documentID == uuid.Nil || schemaVersion < 1 || len(source) == 0 || !isMarkdownWhitespace(trailingWhitespace) {
		return Body{}, invalid("document id, positive schema version, Muya state, and Markdown trailing whitespace are required")
	}
	var states []json.RawMessage
	if err := json.Unmarshal(source, &states); err != nil || states == nil {
		return Body{}, invalid("Muya state must be a JSON array")
	}

	body := Body{DocumentID: documentID}
	body.RootNodeID = deterministicNodeID(documentID, sourceFingerprint, schemaVersion, "root")
	body.Nodes = append(body.Nodes, Node{
		DocumentID: documentID, NodeID: body.RootNodeID, SiblingOrder: 0,
		Type: "document", Attributes: json.RawMessage(`{}`), Version: 1,
	})
	sourceGaps := make(map[string]string)
	sourceTables := make(map[string]string)
	for i, state := range states {
		if err := appendMuyaNode(&body, documentID, sourceFingerprint, schemaVersion, body.RootNodeID, []int{i}, state, sourceGaps, sourceTables); err != nil {
			return Body{}, err
		}
	}
	rootAttributes := map[string]any{"trailingWhitespace": trailingWhitespace}
	if len(sourceGaps) > 0 {
		rootAttributes["sourceGaps"] = sourceGaps
	}
	if len(sourceTables) > 0 {
		rootAttributes["sourceTables"] = sourceTables
	}
	encodedAttributes, err := json.Marshal(rootAttributes)
	if err != nil {
		return Body{}, err
	}
	body.Nodes[0].Attributes = encodedAttributes
	if err := Validate(body); err != nil {
		return Body{}, err
	}
	return body, nil
}

func appendMuyaNode(body *Body, documentID uuid.UUID, fingerprint [sha256.Size]byte, schemaVersion int, parentID uuid.UUID, path []int, raw json.RawMessage, sourceGaps, sourceTables map[string]string) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return invalid("Muya node at %v must be a JSON object", path)
	}
	for key := range fields {
		switch key {
		case "name", "meta", "text", "children", "inline", "sourceGap", "sourceMarkdown":
		default:
			return invalid("Muya node at %v has unsupported field %q", path, key)
		}
	}
	var nodeType string
	if err := json.Unmarshal(fields["name"], &nodeType); err != nil || nodeType == "" {
		return invalid("Muya node at %v has no valid name", path)
	}
	attributes := json.RawMessage(`{}`)
	if meta, ok := fields["meta"]; ok {
		var object map[string]json.RawMessage
		if err := json.Unmarshal(meta, &object); err != nil || object == nil {
			return invalid("Muya node at %v meta must be an object", path)
		}
		attributes = append(json.RawMessage(nil), meta...)
	}
	content := ""
	if textValue, ok := fields["text"]; ok {
		var value *string
		if err := json.Unmarshal(textValue, &value); err != nil || value == nil {
			return invalid("Muya node at %v text must be a string", path)
		}
		content = *value
	}
	inline, hasInline := fields["inline"]
	if hasInline {
		if !isInlineParent(nodeType) {
			return invalid("Muya node at %v cannot contain inline nodes", path)
		}
		content = ""
	}

	nodeID := deterministicNodeID(documentID, fingerprint, schemaVersion, pathKey(path)+":"+nodeType)
	if rawGap, ok := fields["sourceGap"]; ok {
		var sourceGap string
		if err := json.Unmarshal(rawGap, &sourceGap); err != nil || !isMarkdownWhitespace(sourceGap) {
			return invalid("Muya node at %v sourceGap must contain Markdown whitespace", path)
		}
		sourceGaps[nodeID.String()] = sourceGap
	}
	if rawSource, ok := fields["sourceMarkdown"]; ok {
		var sourceMarkdown string
		if nodeType != "table" || json.Unmarshal(rawSource, &sourceMarkdown) != nil || sourceMarkdown == "" {
			return invalid("Muya node at %v sourceMarkdown must be non-empty Markdown table source", path)
		}
		sourceTables[nodeID.String()] = sourceMarkdown
	}
	body.Nodes = append(body.Nodes, Node{
		DocumentID: documentID, NodeID: nodeID, ParentID: uuidPointer(parentID),
		SiblingOrder: float64(path[len(path)-1]), Type: nodeType, Content: content,
		Attributes: attributes, Version: 1,
	})
	if hasInline {
		if err := appendMuyaInlineNodes(body, documentID, fingerprint, schemaVersion, nodeID, path, inline); err != nil {
			return err
		}
	}
	children := json.RawMessage("[]")
	if value, ok := fields["children"]; ok {
		children = value
	}
	var childStates []json.RawMessage
	if err := json.Unmarshal(children, &childStates); err != nil || childStates == nil {
		return invalid("Muya node at %v children must be an array", path)
	}
	for i, child := range childStates {
		childPath := append(append([]int(nil), path...), i)
		if err := appendMuyaNode(body, documentID, fingerprint, schemaVersion, nodeID, childPath, child, sourceGaps, sourceTables); err != nil {
			return err
		}
	}
	return nil
}

func appendMuyaInlineNodes(body *Body, documentID uuid.UUID, fingerprint [sha256.Size]byte, schemaVersion int, parentID uuid.UUID, parentPath []int, raw json.RawMessage) error {
	var states []json.RawMessage
	if err := json.Unmarshal(raw, &states); err != nil || states == nil {
		return invalid("Muya inline nodes must be a JSON array")
	}
	for i, state := range states {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(state, &fields); err != nil || fields == nil {
			return invalid("Muya inline node %d must be a JSON object", i)
		}
		for key := range fields {
			if key != "type" && key != "content" && key != "attributes" {
				return invalid("Muya inline node %d has unsupported field %q", i, key)
			}
		}
		var nodeType string
		if err := json.Unmarshal(fields["type"], &nodeType); err != nil || !isInline(nodeType) {
			return invalid("Muya inline node %d has invalid type", i)
		}
		content := ""
		if rawContent, ok := fields["content"]; ok {
			var value *string
			if err := json.Unmarshal(rawContent, &value); err != nil || value == nil {
				return invalid("Muya inline node %d content must be a string", i)
			}
			content = *value
		}
		attributes := fields["attributes"]
		if !isJSONObject(attributes) {
			return invalid("Muya inline node %d attributes must be a JSON object", i)
		}
		path := append(append([]int(nil), parentPath...), i)
		body.Nodes = append(body.Nodes, Node{
			DocumentID: documentID, NodeID: deterministicNodeID(documentID, fingerprint, schemaVersion, pathKey(path)+":"+nodeType),
			ParentID: uuidPointer(parentID), SiblingOrder: float64(i), Type: nodeType,
			Content: content, Attributes: append(json.RawMessage(nil), attributes...), Version: 1,
		})
	}
	return nil
}

func deterministicNodeID(documentID uuid.UUID, fingerprint [sha256.Size]byte, schemaVersion int, path string) uuid.UUID {
	name := fmt.Sprintf("muya:%d:%x:%s", schemaVersion, fingerprint, path)
	return uuid.NewSHA1(documentID, []byte(name))
}

func pathKey(path []int) string {
	var buffer bytes.Buffer
	for i, index := range path {
		if i > 0 {
			buffer.WriteByte('/')
		}
		fmt.Fprint(&buffer, index)
	}
	return buffer.String()
}

func uuidPointer(id uuid.UUID) *uuid.UUID { return &id }

func isInlineParent(nodeType string) bool {
	switch nodeType {
	case "paragraph", "atx-heading", "setext-heading", "table.cell":
		return true
	default:
		return false
	}
}
