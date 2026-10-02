package documentbody

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/google/uuid"
)

var ErrInvalid = errors.New("invalid document body")

type Body struct {
	DocumentID uuid.UUID `json:"documentID"`
	RootNodeID uuid.UUID `json:"rootNodeID"`
	Nodes      []Node    `json:"nodes"`
}

type Node struct {
	DocumentID   uuid.UUID       `json:"documentID"`
	NodeID       uuid.UUID       `json:"nodeID"`
	ParentID     *uuid.UUID      `json:"parentID"`
	SiblingOrder float64         `json:"siblingOrder"`
	Type         string          `json:"type"`
	Content      string          `json:"content"`
	Attributes   json.RawMessage `json:"attributes"`
	Version      int64           `json:"version"`
}

func Validate(body Body) error {
	return validateBody(body, nil)
}

// validateBody checks structure for every node and attributes only for nodes
// where checkAttributes reports true; a nil checkAttributes checks all nodes.
func validateBody(body Body, checkAttributes func(Node) bool) error {
	if body.DocumentID == uuid.Nil || body.RootNodeID == uuid.Nil || len(body.Nodes) == 0 {
		return invalid("document, root, and nodes are required")
	}

	nodes := make(map[uuid.UUID]Node, len(body.Nodes))
	orders := make(map[uuid.UUID]map[float64]uuid.UUID)
	rootCount := 0
	for _, node := range body.Nodes {
		if node.DocumentID != body.DocumentID {
			return invalid("node %s belongs to another document", node.NodeID)
		}
		if node.NodeID == uuid.Nil || node.Type == "" || node.Version < 1 {
			return invalid("node id, type, and positive version are required")
		}
		switch node.Type {
		case "run", "math", "opaque-inline":
			if node.Content == "" {
				return invalid("%s node %s cannot be empty", node.Type, node.NodeID)
			}
		}
		if math.IsNaN(node.SiblingOrder) || math.IsInf(node.SiblingOrder, 0) {
			return invalid("node %s has a non-finite sibling order", node.NodeID)
		}
		if _, ok := nodes[node.NodeID]; ok {
			return invalid("duplicate node id %s", node.NodeID)
		}
		if checkAttributes == nil || checkAttributes(node) {
			if !isJSONObject(node.Attributes) {
				return invalid("node %s attributes must be a JSON object", node.NodeID)
			}
			if err := validateNodeAttributes(node); err != nil {
				return err
			}
		}

		if node.ParentID == nil {
			rootCount++
			if node.NodeID != body.RootNodeID || node.Type != "document" {
				return invalid("only the declared document node may be a root")
			}
		} else {
			if *node.ParentID == node.NodeID {
				return invalid("node %s cannot parent itself", node.NodeID)
			}
			if orders[*node.ParentID] == nil {
				orders[*node.ParentID] = make(map[float64]uuid.UUID)
			}
			if sibling, ok := orders[*node.ParentID][node.SiblingOrder]; ok {
				return invalid("nodes %s and %s share sibling order", sibling, node.NodeID)
			}
			orders[*node.ParentID][node.SiblingOrder] = node.NodeID
		}
		nodes[node.NodeID] = node
	}
	if rootCount != 1 {
		return invalid("body must have exactly one root")
	}

	for _, node := range body.Nodes {
		if node.ParentID == nil {
			continue
		}
		parent, ok := nodes[*node.ParentID]
		if !ok {
			return invalid("node %s has a missing parent", node.NodeID)
		}
		if !allowsChild(parent.Type, node.Type) {
			return invalid("node type %q cannot contain %q", parent.Type, node.Type)
		}
	}

	state := make(map[uuid.UUID]uint8, len(nodes))
	for id := range nodes {
		if state[id] == 2 {
			continue
		}
		path := make([]uuid.UUID, 0)
		current := id
		for {
			switch state[current] {
			case 1:
				return invalid("body contains a parent cycle at node %s", current)
			case 2:
				current = uuid.Nil
			}
			if current == uuid.Nil {
				break
			}
			state[current] = 1
			path = append(path, current)
			parentID := nodes[current].ParentID
			if parentID == nil {
				break
			}
			current = *parentID
		}
		for _, pathID := range path {
			state[pathID] = 2
		}
	}
	return nil
}

// ValidateOpaquePreservation rejects a body projection that changes opaque
// source or moves an opaque node, including through a moved ancestor. New or
// deleted siblings do not count as a move; ordering is compared against old
// siblings that still share the same parent.
func ValidateOpaquePreservation(before, after Body) error {
	if before.DocumentID != after.DocumentID || before.RootNodeID != after.RootNodeID {
		return invalid("opaque projection must keep the document root")
	}
	if err := Validate(before); err != nil {
		return err
	}
	if err := Validate(after); err != nil {
		return err
	}

	oldNodes := make(map[uuid.UUID]Node, len(before.Nodes))
	newNodes := make(map[uuid.UUID]Node, len(after.Nodes))
	oldChildren := make(map[uuid.UUID][]Node)
	for _, node := range before.Nodes {
		oldNodes[node.NodeID] = node
		if node.ParentID != nil {
			oldChildren[*node.ParentID] = append(oldChildren[*node.ParentID], node)
		}
	}
	for _, node := range after.Nodes {
		newNodes[node.NodeID] = node
	}

	for _, opaque := range before.Nodes {
		if !isOpaque(opaque.Type) {
			continue
		}
		updated, ok := newNodes[opaque.NodeID]
		if !ok || updated.Type != opaque.Type || updated.Content != opaque.Content || updated.Version != opaque.Version {
			return invalid("opaque node %s was removed or changed", opaque.NodeID)
		}

		oldPathNode := opaque
		newPathNode := updated
		for oldPathNode.ParentID != nil {
			if !sameParent(oldPathNode.ParentID, newPathNode.ParentID) {
				return invalid("opaque node %s changed structural path", opaque.NodeID)
			}
			parentID := *oldPathNode.ParentID
			oldParent, oldParentExists := oldNodes[parentID]
			newParent, newParentExists := newNodes[parentID]
			if !oldParentExists || !newParentExists || oldParent.Type != newParent.Type {
				return invalid("opaque node %s changed structural path", opaque.NodeID)
			}
			for _, oldSibling := range oldChildren[parentID] {
				if oldSibling.NodeID == oldPathNode.NodeID {
					continue
				}
				newSibling, exists := newNodes[oldSibling.NodeID]
				if !exists || newSibling.ParentID == nil || *newSibling.ParentID != parentID {
					continue
				}
				if orderRelation(oldPathNode.SiblingOrder, oldSibling.SiblingOrder) != orderRelation(newPathNode.SiblingOrder, newSibling.SiblingOrder) {
					return invalid("opaque node %s changed relative order on its structural path", opaque.NodeID)
				}
			}
			oldPathNode = oldParent
			newPathNode = newParent
		}
	}
	return nil
}

// ValidateExistingStructure requires parent changes and reorders of existing
// nodes to be authorized by a durable MoveNode command. Deletions of existing
// nodes must use DeleteNode; insertion may shift sibling_order without
// changing surviving nodes' order.
func ValidateExistingStructure(before, after Body, authorizedMoveNodeIDs map[uuid.UUID]struct{}) error {
	if before.DocumentID != after.DocumentID || before.RootNodeID != after.RootNodeID {
		return invalid("collaborative projection must keep the document root")
	}
	if err := Validate(before); err != nil {
		return err
	}
	if err := Validate(after); err != nil {
		return err
	}
	oldNodes := make(map[uuid.UUID]Node, len(before.Nodes))
	newNodes := make(map[uuid.UUID]Node, len(after.Nodes))
	for _, node := range before.Nodes {
		oldNodes[node.NodeID] = node
	}
	for _, node := range after.Nodes {
		newNodes[node.NodeID] = node
	}
	for id, oldNode := range oldNodes {
		newNode, exists := newNodes[id]
		if !exists {
			return invalid("existing node %s was deleted without DeleteNode", id)
		}
		if oldNode.Type != newNode.Type {
			return invalid("existing node %s changed type", id)
		}
		if !sameParent(oldNode.ParentID, newNode.ParentID) {
			if _, authorized := authorizedMoveNodeIDs[id]; !authorized {
				return invalid("existing node %s changed parent without MoveNode", id)
			}
		}
	}

	oldOrder := stableSiblingOrder(before.Nodes, oldNodes, newNodes, authorizedMoveNodeIDs)
	newOrder := stableSiblingOrder(after.Nodes, oldNodes, newNodes, authorizedMoveNodeIDs)
	for parentID, oldIDs := range oldOrder {
		if !equalIDs(oldIDs, newOrder[parentID]) {
			return invalid("existing siblings under node %s were reordered without MoveNode", parentID)
		}
	}
	for parentID, newIDs := range newOrder {
		if !equalIDs(oldOrder[parentID], newIDs) {
			return invalid("existing siblings under node %s were reordered without MoveNode", parentID)
		}
	}
	return nil
}

func stableSiblingOrder(nodes []Node, oldNodes, newNodes map[uuid.UUID]Node, authorized map[uuid.UUID]struct{}) map[uuid.UUID][]uuid.UUID {
	children := make(map[uuid.UUID][]Node)
	for _, node := range nodes {
		if node.ParentID != nil {
			children[*node.ParentID] = append(children[*node.ParentID], node)
		}
	}
	result := make(map[uuid.UUID][]uuid.UUID, len(children))
	for parentID, siblings := range children {
		sort.Slice(siblings, func(i, j int) bool { return siblings[i].SiblingOrder < siblings[j].SiblingOrder })
		for _, node := range siblings {
			oldNode, wasPresent := oldNodes[node.NodeID]
			newNode, remains := newNodes[node.NodeID]
			if !wasPresent || !remains || oldNode.ParentID == nil || newNode.ParentID == nil || *oldNode.ParentID != *newNode.ParentID || *newNode.ParentID != parentID {
				continue
			}
			if _, moved := authorized[node.NodeID]; moved {
				continue
			}
			result[parentID] = append(result[parentID], node.NodeID)
		}
	}
	return result
}

func equalIDs(left, right []uuid.UUID) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func isOpaque(nodeType string) bool {
	return nodeType == "opaque" || nodeType == "opaque-inline"
}

func sameParent(left, right *uuid.UUID) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func orderRelation(left, right float64) int {
	if left < right {
		return -1
	}
	if left > right {
		return 1
	}
	return 0
}

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, args...))
}

func isJSONObject(raw json.RawMessage) bool {
	var value map[string]json.RawMessage
	return len(raw) > 0 && json.Unmarshal(raw, &value) == nil && value != nil
}

func validateNodeAttributes(node Node) error {
	var attributes map[string]json.RawMessage
	if err := json.Unmarshal(node.Attributes, &attributes); err != nil {
		return invalid("node %s attributes must be an object", node.NodeID)
	}

	switch node.Type {
	case "document":
		if err := allowAttributes(node, attributes, "trailingWhitespace", "sourceGaps", "sourceTables"); err != nil {
			return err
		}
		if _, ok := attributes["trailingWhitespace"]; ok {
			value, err := requiredStringValue(attributes, "trailingWhitespace")
			if err != nil || !isMarkdownWhitespace(value) {
				return invalid("document root trailingWhitespace must contain only Markdown whitespace")
			}
		}
		if raw, ok := attributes["sourceGaps"]; ok {
			var sourceGaps map[string]string
			if err := json.Unmarshal(raw, &sourceGaps); err != nil || sourceGaps == nil {
				return invalid("document root sourceGaps must map node IDs to Markdown whitespace")
			}
			for nodeID, gap := range sourceGaps {
				if _, err := uuid.Parse(nodeID); err != nil || !isMarkdownWhitespace(gap) {
					return invalid("document root sourceGaps contains invalid entry %q", nodeID)
				}
			}
		}
		if raw, ok := attributes["sourceTables"]; ok {
			var sourceTables map[string]string
			if err := json.Unmarshal(raw, &sourceTables); err != nil || sourceTables == nil {
				return invalid("document root sourceTables must map node IDs to Markdown table source")
			}
			for nodeID, sourceMarkdown := range sourceTables {
				if _, err := uuid.Parse(nodeID); err != nil || sourceMarkdown == "" {
					return invalid("document root sourceTables contains invalid entry %q", nodeID)
				}
			}
		}
		if node.Content != "" {
			return invalid("document root cannot contain content")
		}
	case "block-quote", "list-item", "table", "table.row", "paragraph", "thematic-break", "html-block", "link-reference-definition", "opaque":
		if len(attributes) != 0 {
			return invalid("node %s type %q does not accept attributes", node.NodeID, node.Type)
		}
		if isContainer(node.Type) && node.Content != "" {
			return invalid("container node %s cannot contain text", node.NodeID)
		}
	case "order-list":
		if err := allowAttributes(node, attributes, "start", "loose", "delimiter"); err != nil {
			return err
		}
		start, err := requiredInteger(node, attributes, "start")
		if err != nil || start < 1 {
			return invalid("ordered list node %s must have a positive integer start", node.NodeID)
		}
		if err := requiredBool(node, attributes, "loose"); err != nil {
			return err
		}
		if err := requiredChoice(node, attributes, "delimiter", ".", ")"); err != nil {
			return err
		}
		if node.Content != "" {
			return invalid("container node %s cannot contain text", node.NodeID)
		}
	case "bullet-list", "task-list":
		if err := allowAttributes(node, attributes, "marker", "loose"); err != nil {
			return err
		}
		if err := requiredChoice(node, attributes, "marker", "-", "+", "*"); err != nil {
			return err
		}
		if err := requiredBool(node, attributes, "loose"); err != nil {
			return err
		}
		if node.Content != "" {
			return invalid("container node %s cannot contain text", node.NodeID)
		}
	case "task-list-item":
		if err := allowAttributes(node, attributes, "checked"); err != nil {
			return err
		}
		if err := requiredBool(node, attributes, "checked"); err != nil {
			return err
		}
		if node.Content != "" {
			return invalid("container node %s cannot contain text", node.NodeID)
		}
	case "atx-heading":
		if err := allowAttributes(node, attributes, "level"); err != nil {
			return err
		}
		level, err := requiredInteger(node, attributes, "level")
		if err != nil || level < 1 || level > 6 {
			return invalid("ATX heading node %s must have a level from 1 to 6", node.NodeID)
		}
	case "setext-heading":
		if err := allowAttributes(node, attributes, "level", "underline"); err != nil {
			return err
		}
		level, err := requiredInteger(node, attributes, "level")
		underline, underlineErr := requiredStringValue(attributes, "underline")
		validUnderline := underline != "" && (strings.Trim(underline, "=") == "" || strings.Trim(underline, "-") == "")
		if err != nil || underlineErr != nil || (level != 1 && level != 2) || !validUnderline || (level == 1) != strings.HasPrefix(underline, "=") {
			return invalid("setext heading node %s has invalid level or underline", node.NodeID)
		}
	case "table.cell":
		if err := allowAttributes(node, attributes, "align"); err != nil {
			return err
		}
		if err := requiredChoice(node, attributes, "align", "none", "left", "center", "right"); err != nil {
			return err
		}
	case "code-block":
		if err := allowAttributes(node, attributes, "type", "lang", "fenceLength"); err != nil {
			return err
		}
		if err := requiredChoice(node, attributes, "type", "fenced", "indented"); err != nil {
			return err
		}
		lang, err := requiredStringValue(attributes, "lang")
		if err != nil || strings.ContainsAny(lang, "\r\n") {
			return invalid("code block node %s has invalid info string", node.NodeID)
		}
		if raw, ok := attributes["fenceLength"]; ok {
			var fenceLength *int
			if err := json.Unmarshal(raw, &fenceLength); err != nil || fenceLength == nil || *fenceLength < 3 {
				return invalid("code block node %s has invalid fence length", node.NodeID)
			}
		}
	case "math-block":
		if err := allowAttributes(node, attributes, "mathStyle"); err != nil {
			return err
		}
		if err := requiredChoice(node, attributes, "mathStyle", "", "gitlab"); err != nil {
			return err
		}
	case "frontmatter":
		if err := allowAttributes(node, attributes, "lang", "style"); err != nil {
			return err
		}
		lang, err := requiredStringValue(attributes, "lang")
		style, styleErr := requiredStringValue(attributes, "style")
		if err != nil || styleErr != nil ||
			(lang == "yaml" && style != "-") || (lang == "toml" && style != "+") ||
			(lang == "json" && style != ";" && style != "{") ||
			(lang != "yaml" && lang != "toml" && lang != "json") {
			return invalid("frontmatter node %s has invalid language or delimiter", node.NodeID)
		}
	case "diagram":
		if err := allowAttributes(node, attributes, "type", "lang"); err != nil {
			return err
		}
		diagramType, err := requiredStringValue(attributes, "type")
		lang, langErr := requiredStringValue(attributes, "lang")
		expectedLang := "yaml"
		if diagramType == "vega-lite" {
			expectedLang = "json"
		}
		if err != nil || langErr != nil || !contains([]string{"mermaid", "plantuml", "vega-lite", "flowchart", "sequence"}, diagramType) || lang != expectedLang {
			return invalid("diagram node %s has invalid type or language", node.NodeID)
		}
	case "footnote":
		if err := allowAttributes(node, attributes, "identifier"); err != nil {
			return err
		}
		identifier, err := requiredStringValue(attributes, "identifier")
		if err != nil || identifier == "" || strings.ContainsAny(identifier, "\r\n[]") {
			return invalid("footnote node %s has invalid identifier", node.NodeID)
		}
		if node.Content != "" {
			return invalid("container node %s cannot contain text", node.NodeID)
		}
	case "run", "image", "math", "line-break", "opaque-inline":
		var values map[string]any
		if err := json.Unmarshal(node.Attributes, &values); err != nil {
			return invalid("inline node %s attributes must be an object", node.NodeID)
		}
		for key, value := range values {
			switch value.(type) {
			case string, bool:
			default:
				return invalid("inline node %s attribute %q must be a string or boolean", node.NodeID, key)
			}
			if contains([]string{"bold", "italic", "strike", "code", "hard"}, key) {
				if _, ok := value.(bool); !ok {
					return invalid("inline node %s attribute %q must be boolean", node.NodeID, key)
				}
			}
			if contains([]string{"boldMarker", "italicMarker", "strikeMarker", "codeMarker", "href", "linkTitle", "linkSource", "referenceLabel", "source", "src", "alt", "title", "marker"}, key) {
				if _, ok := value.(string); !ok {
					return invalid("inline node %s attribute %q must be a string", node.NodeID, key)
				}
			}
			if key == "boldMarker" || key == "italicMarker" || key == "strikeMarker" {
				marker := value.(string)
				if (key == "boldMarker" && marker != "**" && marker != "__") ||
					(key == "italicMarker" && marker != "*" && marker != "_") ||
					(key == "strikeMarker" && marker != "~~") {
					return invalid("inline node %s attribute %q is invalid", node.NodeID, key)
				}
			}
		}
		if (node.Type == "image" || node.Type == "line-break") && node.Content != "" {
			return invalid("inline node %s type %q cannot contain text", node.NodeID, node.Type)
		}
		switch node.Type {
		case "image":
			if _, err := requiredStringValue(attributes, "src"); err != nil {
				return invalid("image node %s requires src and alt attributes", node.NodeID)
			}
			if _, err := requiredStringValue(attributes, "alt"); err != nil {
				return invalid("image node %s requires src and alt attributes", node.NodeID)
			}
		case "line-break":
			if _, ok := values["hard"].(bool); !ok {
				return invalid("line break node %s requires boolean attribute %q", node.NodeID, "hard")
			}
		case "math":
			if strings.ContainsAny(node.Content, "\r\n") {
				return invalid("inline math node %s cannot contain a line break", node.NodeID)
			}
		case "run":
			if values["code"] == true && strings.ContainsAny(node.Content, "\r\n") {
				return invalid("inline code node %s cannot contain a line break", node.NodeID)
			}
		case "opaque-inline":
			if len(values) != 0 {
				return invalid("opaque inline node %s cannot contain attributes", node.NodeID)
			}
		}
	default:
		return invalid("node %s has unsupported type %q", node.NodeID, node.Type)
	}
	return nil
}

func isContainer(nodeType string) bool {
	switch nodeType {
	case "block-quote", "list-item", "task-list-item", "order-list", "bullet-list", "task-list", "table", "table.row", "footnote":
		return true
	default:
		return false
	}
}

func allowAttributes(node Node, attributes map[string]json.RawMessage, allowed ...string) error {
	for key := range attributes {
		if !contains(allowed, key) {
			return invalid("node %s type %q has unsupported attribute %q", node.NodeID, node.Type, key)
		}
	}
	return nil
}

func requiredInteger(node Node, attributes map[string]json.RawMessage, key string) (int, error) {
	var value *int
	if err := json.Unmarshal(attributes[key], &value); err != nil || value == nil {
		return 0, invalid("node %s requires integer attribute %q", node.NodeID, key)
	}
	return *value, nil
}

func requiredBool(node Node, attributes map[string]json.RawMessage, key string) error {
	var value *bool
	if err := json.Unmarshal(attributes[key], &value); err != nil || value == nil {
		return invalid("node %s requires boolean attribute %q", node.NodeID, key)
	}
	return nil
}

func requiredStringValue(attributes map[string]json.RawMessage, key string) (string, error) {
	var value *string
	if err := json.Unmarshal(attributes[key], &value); err != nil || value == nil {
		return "", fmt.Errorf("attribute %q must be a string", key)
	}
	return *value, nil
}

func isMarkdownWhitespace(value string) bool {
	for _, char := range value {
		if char != ' ' && char != '\t' && char != '\r' && char != '\n' {
			return false
		}
	}
	return true
}

func markdownLineBreakCount(value string) int {
	count := 0
	for index := 0; index < len(value); index++ {
		if value[index] == '\r' {
			count++
			if index+1 < len(value) && value[index+1] == '\n' {
				index++
			}
		} else if value[index] == '\n' {
			count++
		}
	}
	return count
}

func requiredChoice(node Node, attributes map[string]json.RawMessage, key string, choices ...string) error {
	value, err := requiredStringValue(attributes, key)
	if err != nil || !contains(choices, value) {
		return invalid("node %s requires valid attribute %q", node.NodeID, key)
	}
	return nil
}

func contains(values []string, candidate string) bool {
	for _, value := range values {
		if value == candidate {
			return true
		}
	}
	return false
}

func allowsChild(parent, child string) bool {
	switch parent {
	case "document", "block-quote", "list-item", "task-list-item", "footnote":
		return isBlock(child)
	case "order-list", "bullet-list":
		return child == "list-item"
	case "task-list":
		return child == "task-list-item"
	case "table":
		return child == "table.row"
	case "table.row":
		return child == "table.cell"
	case "paragraph", "atx-heading", "setext-heading", "table.cell":
		return isInline(child)
	default:
		return false
	}
}

func isInline(nodeType string) bool {
	switch nodeType {
	case "run", "image", "math", "line-break", "opaque-inline":
		return true
	default:
		return false
	}
}

func isBlock(nodeType string) bool {
	switch nodeType {
	case "paragraph", "atx-heading", "setext-heading", "thematic-break", "code-block", "html-block", "link-reference-definition", "block-quote", "order-list", "bullet-list", "task-list", "table", "math-block", "frontmatter", "diagram", "footnote", "opaque":
		return true
	default:
		return false
	}
}
