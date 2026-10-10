package policy

import "testing"

func TestValidateCommentAnchor(t *testing.T) {
	const (
		text    = `{"nodeID":"n1","start":"AA==","end":"AQ=="}`
		element = `{"kind":"element","elementId":"node-1"}`
		pointed = `{"kind":"element","elementId":"node-1","x":0.25,"y":1}`
		source  = `{"kind":"source","start":"AA==","end":"AQ=="}`
	)
	cases := []struct {
		name    string
		docType string
		anchor  string
		valid   bool
	}{
		{"markdown text anchor", "markdown", text, true},
		{"markdown with no anchor (threads made before anchors)", "markdown", "", true},
		{"markdown missing nodeID", "markdown", `{"start":"AA==","end":"AQ=="}`, false},
		{"markdown missing end", "markdown", `{"nodeID":"n1","start":"AA=="}`, false},
		{"markdown empty start", "markdown", `{"nodeID":"n1","start":"","end":"AQ=="}`, false},
		{"markdown with an element anchor", "markdown", element, false},
		{"markdown with a source anchor", "markdown", source, false},
		{"markdown with an unrelated object", "markdown", `{"foo":1}`, false},
		{"markdown with a non-string position", "markdown", `{"nodeID":"n1","start":1,"end":2}`, false},

		{"architecture element", "architecture", element, true},
		{"architecture element with a point", "architecture", pointed, true},
		{"architecture needs an anchor", "architecture", "", false},
		{"architecture element without id", "architecture", `{"kind":"element"}`, false},
		{"architecture element with empty id", "architecture", `{"kind":"element","elementId":""}`, false},
		{"architecture point outside the box", "architecture", `{"kind":"element","elementId":"a","x":1.5}`, false},
		{"architecture negative point", "architecture", `{"kind":"element","elementId":"a","y":-0.1}`, false},
		{"architecture point not a number", "architecture", `{"kind":"element","elementId":"a","x":"left"}`, false},
		{"architecture with a text anchor", "architecture", text, false},
		{"architecture with a source anchor", "architecture", source, false},

		{"dbml source", "dbdiagram", source, true},
		{"mermaid source", "mermaid", source, true},
		{"dbml needs an anchor", "dbdiagram", "", false},
		{"mermaid needs an anchor", "mermaid", "", false},
		{"dbml missing end", "dbdiagram", `{"kind":"source","start":"AA=="}`, false},
		{"mermaid with a text anchor", "mermaid", text, false},
		{"mermaid with an element anchor", "mermaid", element, false},

		{"unknown document type", "spreadsheet", source, false},
		{"unknown document type, no anchor", "", "", false},
	}
	for _, tc := range cases {
		err := ValidateCommentAnchor(tc.docType, []byte(tc.anchor))
		if tc.valid && err != nil {
			t.Errorf("%s: ValidateCommentAnchor() = %v, want nil", tc.name, err)
		}
		if !tc.valid && err == nil {
			t.Errorf("%s: ValidateCommentAnchor() = nil, want an error", tc.name)
		}
	}
}
