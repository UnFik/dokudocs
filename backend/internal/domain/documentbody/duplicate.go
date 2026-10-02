package documentbody

import (
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
)

func CloneForDocument(source Body, targetDocumentID uuid.UUID) (Body, error) {
	if err := Validate(source); err != nil {
		return Body{}, err
	}
	if targetDocumentID == uuid.Nil || targetDocumentID == source.DocumentID {
		return Body{}, invalid("duplicate requires a new document ID")
	}

	ids := make(map[uuid.UUID]uuid.UUID, len(source.Nodes))
	for _, node := range source.Nodes {
		ids[node.NodeID] = uuid.New()
	}
	copyBody := Body{DocumentID: targetDocumentID, RootNodeID: ids[source.RootNodeID], Nodes: make([]Node, len(source.Nodes))}
	for index, node := range source.Nodes {
		copyNode := node
		copyNode.DocumentID = targetDocumentID
		copyNode.NodeID = ids[node.NodeID]
		copyNode.Version = 1
		copyNode.Attributes = append(json.RawMessage(nil), node.Attributes...)
		if node.ParentID != nil {
			parentID, ok := ids[*node.ParentID]
			if !ok {
				return Body{}, invalid("duplicate source node %s has an unmapped parent", node.NodeID)
			}
			copyNode.ParentID = &parentID
		}
		if node.NodeID == source.RootNodeID {
			attributes, err := cloneRootReferences(node.Attributes, ids)
			if err != nil {
				return Body{}, err
			}
			copyNode.Attributes = attributes
		}
		copyBody.Nodes[index] = copyNode
	}
	if err := Validate(copyBody); err != nil {
		return Body{}, fmt.Errorf("duplicate body: %w", err)
	}
	return copyBody, nil
}

func cloneRootReferences(raw json.RawMessage, ids map[uuid.UUID]uuid.UUID) (json.RawMessage, error) {
	var attributes map[string]json.RawMessage
	if err := json.Unmarshal(raw, &attributes); err != nil {
		return nil, err
	}
	for _, key := range []string{"sourceGaps", "sourceTables"} {
		value, exists := attributes[key]
		if !exists {
			continue
		}
		var references map[string]string
		if err := json.Unmarshal(value, &references); err != nil {
			return nil, err
		}
		cloned := make(map[string]string, len(references))
		for oldID, content := range references {
			parsedID, err := uuid.Parse(oldID)
			if err != nil {
				return nil, invalid("document root %s contains an invalid node reference", key)
			}
			if newID, exists := ids[parsedID]; exists {
				cloned[newID.String()] = content
			}
		}
		encoded, err := json.Marshal(cloned)
		if err != nil {
			return nil, err
		}
		attributes[key] = encoded
	}
	return json.Marshal(attributes)
}
