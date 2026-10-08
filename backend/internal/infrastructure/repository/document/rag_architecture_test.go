package document

import (
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestAnArchitectureCanvasIsIndexedOneElementAtATime(t *testing.T) {
	api := uuid.New()
	canvas := `{"version":1,"nodes":[
		{"id":"vps","kind":"host","name":"VPS-1","catalog":"vps","parentId":null},
		{"id":"` + api.String() + `","kind":"system","name":"Backend Order","catalog":"golang","tags":["gin"],"parentId":"vps","description":"Orders and payments."},
		{"id":"pg","kind":"system","name":"PostgreSQL","catalog":"postgresql","parentId":null}
	],"connections":[{"id":"c1","source":"` + api.String() + `","target":"pg","protocol":"db-connection","label":"orders"}]}`

	chunks := renderArchitectureRAG([]byte(canvas))
	var system renderedRAGChunk
	for _, c := range chunks {
		if c.nodeID == api {
			system = c
		}
	}
	if system.text == "" {
		t.Fatalf("chunks = %+v, want one keyed by the System's id", chunks)
	}
	for _, want := range []string{`System "Backend Order" (golang; gin) runs on Host "VPS-1".`, "Orders and payments.", `Calls "PostgreSQL" over db-connection (orders).`} {
		if !strings.Contains(system.text, want) {
			t.Fatalf("system chunk = %q, missing %q", system.text, want)
		}
	}
	if system.breadcrumb != "VPS-1" {
		t.Fatalf("breadcrumb = %q, want the Host", system.breadcrumb)
	}
	if len(renderArchitectureRAG([]byte(`not json`))) != 0 {
		t.Fatal("a canvas that cannot be read gives chunks")
	}
}
