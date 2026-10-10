package policy

import (
	"encoding/json"
	"errors"
)

var ErrInvalidCommentAnchor = errors.New("comment anchor does not fit the document type")

// ValidateCommentAnchor checks that an anchor has the shape its document type
// pins a comment with: Yjs positions inside a text node (markdown), an element
// (architecture), or Yjs positions in the shared source (dbdiagram, mermaid).
// It checks the shape only, not that the node or element still exists.
// Markdown alone may have no anchor, for threads made before anchors existed.
func ValidateCommentAnchor(docType string, anchor json.RawMessage) error {
	if len(anchor) == 0 {
		if docType == "markdown" {
			return nil
		}
		return ErrInvalidCommentAnchor
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(anchor, &fields) != nil || fields == nil {
		return ErrInvalidCommentAnchor
	}
	var ok bool
	switch docType {
	case "markdown":
		_, hasKind := fields["kind"]
		ok = !hasKind && hasText(fields, "nodeID", "start", "end")
	case "architecture":
		ok = kindIs(fields, "element") && hasText(fields, "elementId") &&
			unitIfPresent(fields, "x") && unitIfPresent(fields, "y")
	case "dbdiagram", "mermaid":
		ok = kindIs(fields, "source") && hasText(fields, "start", "end")
	}
	if !ok {
		return ErrInvalidCommentAnchor
	}
	return nil
}

func textField(fields map[string]json.RawMessage, key string) (string, bool) {
	raw, present := fields[key]
	if !present {
		return "", false
	}
	var value string
	if json.Unmarshal(raw, &value) != nil {
		return "", false
	}
	return value, true
}

func hasText(fields map[string]json.RawMessage, keys ...string) bool {
	for _, key := range keys {
		if value, ok := textField(fields, key); !ok || value == "" {
			return false
		}
	}
	return true
}

func kindIs(fields map[string]json.RawMessage, want string) bool {
	kind, ok := textField(fields, "kind")
	return ok && kind == want
}

// unitIfPresent accepts a missing key or a number from 0 to 1, a share of a box.
func unitIfPresent(fields map[string]json.RawMessage, key string) bool {
	raw, present := fields[key]
	if !present {
		return true
	}
	var value float64
	return json.Unmarshal(raw, &value) == nil && value >= 0 && value <= 1
}
