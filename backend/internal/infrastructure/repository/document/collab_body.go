package document

import "encoding/json"

// hasCollabBody reports whether documents of this type keep their body in the
// collaboration service: a Yjs state, JSON derived from it (content_json) and
// text derived from that (content).
func hasCollabBody(documentType string) bool {
	return documentType == "markdown" || documentType == "architecture" || isSourceDocument(documentType)
}

// isSourceDocument reports whether the body is one shared source text, its
// DiagramSource, stored as {"source": "..."} (ADR 0033).
func isSourceDocument(documentType string) bool {
	return documentType == "dbdiagram" || documentType == "mermaid"
}

// sourceFromJSON reads the source out of {"source": "..."}. Anything else, an
// extra key included, does not fit and is refused.
func sourceFromJSON(content []byte) (string, bool) {
	var object map[string]json.RawMessage
	if json.Unmarshal(content, &object) != nil || len(object) != 1 {
		return "", false
	}
	raw, ok := object["source"]
	if !ok {
		return "", false
	}
	var source string
	if json.Unmarshal(raw, &source) != nil {
		return "", false
	}
	return source, true
}
