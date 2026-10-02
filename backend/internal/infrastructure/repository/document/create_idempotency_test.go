package document

import (
	"testing"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func TestCreateRequestHashTracksPayloadAndNormalizesEmptyCategories(t *testing.T) {
	doc := model.Document{
		WorkspaceID: uuid.New(),
		Title:       "Architecture",
		Type:        "markdown",
		Content:     "# Architecture",
		AuthorID:    uuid.New(),
		Tags:        []string{},
	}
	withoutCategories, err := createRequestHash(doc, nil, nil, 1)
	if err != nil {
		t.Fatalf("createRequestHash(nil categories): %v", err)
	}
	withEmptyCategories, err := createRequestHash(doc, []string{}, nil, 1)
	if err != nil {
		t.Fatalf("createRequestHash(empty categories): %v", err)
	}
	if withoutCategories != withEmptyCategories {
		t.Fatal("nil and empty categories produced different request fingerprints")
	}

	doc.Content = "# Changed"
	changedPayload, err := createRequestHash(doc, nil, nil, 1)
	if err != nil {
		t.Fatalf("createRequestHash(changed payload): %v", err)
	}
	if changedPayload == withoutCategories {
		t.Fatal("changed document content reused the original request fingerprint")
	}
}
