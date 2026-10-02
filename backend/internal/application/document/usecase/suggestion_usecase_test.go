package usecase

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestSuggestionProposeRejectsInvalidBatchBeforePersistence(t *testing.T) {
	service := NewSuggestionUseCase(nil, nil, nil, nil)
	err := service.Propose(context.Background(), SuggestionInput{
		WorkspaceID: uuid.New(), DocumentID: uuid.New(), SuggestionID: uuid.New(), ProposerID: uuid.New(),
		BaseBodyVersion: 1, BaseBodyEpoch: 1, OperationSchemaVersion: 1,
		Provenance: "human", Operations: []byte(`{"operations":`),
	})
	if err != ErrInvalidSuggestion {
		t.Fatalf("Propose() error = %v, want %v", err, ErrInvalidSuggestion)
	}
}
