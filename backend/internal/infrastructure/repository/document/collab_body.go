package document

// hasCollabBody reports whether documents of this type keep their body in the
// collaboration service: a Yjs state, JSON derived from it (content_json) and
// text derived from that (content). DBML and Mermaid documents are plain text.
func hasCollabBody(documentType string) bool {
	return documentType == "markdown" || documentType == "architecture"
}
