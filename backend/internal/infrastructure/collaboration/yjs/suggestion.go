package yjs

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"

	"github.com/google/uuid"
	"github.com/reearth/ygo/crdt"
)

// Suggestions are content of the Yjs body (ADR 0027). Inside a run's text they are
// three marks, one per kind, on the characters they cover:
//
//	suggestion_insert  {id, author}        the text is proposed, not canonical
//	suggestion_delete  {id, author}        the text is proposed for removal
//	suggestion_format  {id, author, set}   formatting proposed for the text
//
// On a node they are the `suggestion` key of bodyAttributes:
//
//	{kind: insert|delete|format, id, author, toType?, toAttributes?}
//
// Every shape is checked strictly: a user with comment access writes these, so
// anything unexpected is rejected rather than carried along.

const (
	textInsertMark = "suggestion_insert"
	textDeleteMark = "suggestion_delete"
	textFormatMark = "suggestion_format"
)

// formatKeys are the run formatting a suggestion may propose, with the JSON type
// of each value.
var formatKeys = map[string]string{
	"bold": "bool", "italic": "bool", "strike": "bool", "code": "bool",
	"href": "string", "linkTitle": "string",
}

func isSuggestionMark(name string) bool {
	return name == textInsertMark || name == textDeleteMark || name == textFormatMark
}

// textSuggestion is one suggestion mark found on text.
type textSuggestion struct {
	Kind   string
	ID     uuid.UUID
	Author uuid.UUID
}

func parseTextSuggestionMark(name string, value any) (textSuggestion, error) {
	object, err := suggestionObject(value)
	if err != nil {
		return textSuggestion{}, fmt.Errorf("mark %q: %w", name, err)
	}
	allowed := map[string]bool{"id": true, "author": true}
	if name == textFormatMark {
		allowed["set"] = true
	}
	if err := onlyKeys(object, allowed); err != nil {
		return textSuggestion{}, fmt.Errorf("mark %q: %w", name, err)
	}
	id, author, err := suggestionIdentity(object)
	if err != nil {
		return textSuggestion{}, fmt.Errorf("mark %q: %w", name, err)
	}
	if name == textFormatMark {
		rawSet, ok := object["set"]
		if !ok {
			return textSuggestion{}, fmt.Errorf("mark %q needs the formatting it proposes", name)
		}
		if err := validateTypedObject(rawSet, formatKeys, true); err != nil {
			return textSuggestion{}, fmt.Errorf("mark %q set: %w", name, err)
		}
	}
	return textSuggestion{Kind: name[len("suggestion_"):], ID: id, Author: author}, nil
}

// nodeSuggestion is the suggestion carried by a node's attributes.
type nodeSuggestion struct {
	Kind   string
	ID     uuid.UUID
	Author uuid.UUID
}

func parseNodeSuggestion(raw json.RawMessage) (nodeSuggestion, error) {
	object, err := suggestionObject(json.RawMessage(raw))
	if err != nil {
		return nodeSuggestion{}, fmt.Errorf("suggestion: %w", err)
	}
	if err := onlyKeys(object, map[string]bool{"kind": true, "id": true, "author": true, "toType": true, "toAttributes": true}); err != nil {
		return nodeSuggestion{}, fmt.Errorf("suggestion: %w", err)
	}
	var kind string
	if err := json.Unmarshal(object["kind"], &kind); err != nil || (kind != "insert" && kind != "delete" && kind != "format") {
		return nodeSuggestion{}, fmt.Errorf("suggestion kind must be insert, delete, or format")
	}
	id, author, err := suggestionIdentity(object)
	if err != nil {
		return nodeSuggestion{}, fmt.Errorf("suggestion: %w", err)
	}
	_, hasType := object["toType"]
	_, hasAttributes := object["toAttributes"]
	if (hasType || hasAttributes) && kind != "format" {
		return nodeSuggestion{}, fmt.Errorf("only a format suggestion proposes a type or attributes")
	}
	if kind == "format" && !hasType && !hasAttributes {
		return nodeSuggestion{}, fmt.Errorf("a format suggestion needs the type or attributes it proposes")
	}
	if hasType {
		var toType string
		if err := json.Unmarshal(object["toType"], &toType); err != nil || toType == "" {
			return nodeSuggestion{}, fmt.Errorf("toType must be a node type")
		}
	}
	if hasAttributes {
		if err := validateScalarObject(object["toAttributes"]); err != nil {
			return nodeSuggestion{}, fmt.Errorf("toAttributes: %w", err)
		}
	}
	return nodeSuggestion{Kind: kind, ID: id, Author: author}, nil
}

// suggestionObject decodes a mark value or attribute into its JSON members.
func suggestionObject(value any) (map[string]json.RawMessage, error) {
	var encoded []byte
	switch typed := value.(type) {
	case json.RawMessage:
		encoded = typed
	default:
		var err error
		if encoded, err = json.Marshal(typed); err != nil {
			return nil, fmt.Errorf("is not an object")
		}
	}
	trimmed := bytes.TrimSpace(encoded)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return nil, fmt.Errorf("is not an object")
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(trimmed, &object); err != nil || object == nil {
		return nil, fmt.Errorf("is not an object")
	}
	return object, nil
}

func onlyKeys(object map[string]json.RawMessage, allowed map[string]bool) error {
	for key := range object {
		if !allowed[key] {
			return fmt.Errorf("has unsupported key %q", key)
		}
	}
	return nil
}

func suggestionIdentity(object map[string]json.RawMessage) (id, author uuid.UUID, err error) {
	parse := func(key string) (uuid.UUID, error) {
		var text string
		if err := json.Unmarshal(object[key], &text); err != nil {
			return uuid.Nil, fmt.Errorf("%s must be a UUID", key)
		}
		parsed, err := uuid.Parse(text)
		if err != nil || parsed == uuid.Nil {
			return uuid.Nil, fmt.Errorf("%s must be a UUID", key)
		}
		return parsed, nil
	}
	if id, err = parse("id"); err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	if author, err = parse("author"); err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	return id, author, nil
}

// validateTypedObject checks that raw is an object whose keys are in types and
// whose values have the named JSON type ("bool" or "string").
func validateTypedObject(raw json.RawMessage, types map[string]string, nonEmpty bool) error {
	object, err := suggestionObject(raw)
	if err != nil {
		return err
	}
	if nonEmpty && len(object) == 0 {
		return fmt.Errorf("is empty")
	}
	for key, value := range object {
		kind, ok := types[key]
		if !ok {
			return fmt.Errorf("has unsupported key %q", key)
		}
		var decoded any
		if err := json.Unmarshal(value, &decoded); err != nil {
			return fmt.Errorf("%q is not valid JSON", key)
		}
		switch decoded.(type) {
		case bool:
			if kind != "bool" {
				return fmt.Errorf("%q must be a %s", key, kind)
			}
		case string:
			if kind != "string" {
				return fmt.Errorf("%q must be a %s", key, kind)
			}
		default:
			return fmt.Errorf("%q must be a %s", key, kind)
		}
	}
	return nil
}

// validateScalarObject accepts an object whose values are all booleans, numbers,
// or strings (a heading level is a number).
func validateScalarObject(raw json.RawMessage) error {
	object, err := suggestionObject(raw)
	if err != nil {
		return err
	}
	for key, value := range object {
		var decoded any
		if err := json.Unmarshal(value, &decoded); err != nil {
			return fmt.Errorf("%q is not valid JSON", key)
		}
		switch decoded.(type) {
		case bool, string, float64:
		default:
			return fmt.Errorf("%q must be a boolean, a number, or a string", key)
		}
	}
	return nil
}

// withoutSuggestionMarks separates suggestion marks from formatting and checks
// each one. Text under an insert suggestion is not part of the canonical body;
// delete and format suggestions leave the text and its formatting as they are.
func withoutSuggestionMarks(attributes crdt.Attributes) (rest crdt.Attributes, inserted bool, found []textSuggestion, err error) {
	rest = make(crdt.Attributes, len(attributes))
	for name, value := range attributes {
		if !isSuggestionMark(name) {
			rest[name] = value
			continue
		}
		parsed, err := parseTextSuggestionMark(name, value)
		if err != nil {
			return nil, false, nil, err
		}
		found = append(found, parsed)
		if name == textInsertMark {
			inserted = true
		}
	}
	return rest, inserted, found, nil
}

// SuggestionInfo describes one suggestion found in a body.
type SuggestionInfo struct {
	ID     uuid.UUID
	Author uuid.UUID
	// Kinds are the kinds the suggestion has, sorted. A Replace has delete and insert.
	Kinds []string
	// NodeIDs are the nodes that carry it: the runs whose text is marked, or the
	// node whose attributes hold it.
	NodeIDs []uuid.UUID
}

// suggestionCollector gathers suggestions during projection and enforces that one
// suggestion id has one author, so nobody can add to or take over another
// user's suggestion by reusing its id.
type suggestionCollector struct {
	byID map[uuid.UUID]*SuggestionInfo
}

func (c *suggestionCollector) add(kind string, id, author, nodeID uuid.UUID) error {
	if c.byID == nil {
		c.byID = map[uuid.UUID]*SuggestionInfo{}
	}
	info, ok := c.byID[id]
	if !ok {
		info = &SuggestionInfo{ID: id, Author: author}
		c.byID[id] = info
	}
	if info.Author != author {
		return fmt.Errorf("suggestion %s has more than one author", id)
	}
	if !containsString(info.Kinds, kind) {
		info.Kinds = append(info.Kinds, kind)
	}
	for _, existing := range info.NodeIDs {
		if existing == nodeID {
			return nil
		}
	}
	info.NodeIDs = append(info.NodeIDs, nodeID)
	return nil
}

func (c *suggestionCollector) list() []SuggestionInfo {
	result := make([]SuggestionInfo, 0, len(c.byID))
	for _, info := range c.byID {
		sort.Strings(info.Kinds)
		result = append(result, *info)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID.String() < result[j].ID.String() })
	return result
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
