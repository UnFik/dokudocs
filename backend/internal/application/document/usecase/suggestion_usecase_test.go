package usecase

import (
	"context"
	"strings"
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

func TestSuggestionReplyRejectsEmptyOversizedAndIncompleteInput(t *testing.T) {
	service := NewSuggestionUseCase(nil, nil, nil, nil)
	valid := SuggestionReplyInput{
		WorkspaceID: uuid.New(), DocumentID: uuid.New(), SuggestionID: uuid.New(),
		ReplyID: uuid.New(), AuthorID: uuid.New(), Body: "ok",
	}
	for name, mutate := range map[string]func(*SuggestionReplyInput){
		"empty":         func(i *SuggestionReplyInput) { i.Body = "" },
		"only spaces":   func(i *SuggestionReplyInput) { i.Body = " \n\t " },
		"too long":      func(i *SuggestionReplyInput) { i.Body = strings.Repeat("x", MaxSuggestionReplyLength+1) },
		"no reply id":   func(i *SuggestionReplyInput) { i.ReplyID = uuid.Nil },
		"no author":     func(i *SuggestionReplyInput) { i.AuthorID = uuid.Nil },
		"no suggestion": func(i *SuggestionReplyInput) { i.SuggestionID = uuid.Nil },
		"no workspace":  func(i *SuggestionReplyInput) { i.WorkspaceID = uuid.Nil },
	} {
		input := valid
		mutate(&input)
		if err := service.Reply(context.Background(), input); err != ErrInvalidSuggestion {
			t.Errorf("%s: Reply() = %v, want %v", name, err, ErrInvalidSuggestion)
		}
	}
	if err := service.Resolve(context.Background(), uuid.Nil, uuid.New(), uuid.New(), uuid.New(), true); err != ErrInvalidSuggestion {
		t.Errorf("Resolve() without a workspace = %v, want %v", err, ErrInvalidSuggestion)
	}
}
