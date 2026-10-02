package documentbody

import (
	"errors"
	"testing"

	"github.com/google/uuid"
)

func bodyOfNodes(count int) Body {
	documentID, rootID := uuid.New(), uuid.New()
	body := Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []Node{node(documentID, rootID, nil, 0, "document")}}
	for i := 1; i < count; i++ {
		body.Nodes = append(body.Nodes, node(documentID, uuid.New(), &rootID, float64(i), "thematic-break"))
	}
	return body
}

func TestCheckCollaborativeSizeRejectsBodiesAboveTheSupportedSize(t *testing.T) {
	if err := CheckCollaborativeSize(bodyOfNodes(MaxCollaborativeNodes)); err != nil {
		t.Fatalf("body at the limit: %v", err)
	}
	if err := CheckCollaborativeSize(bodyOfNodes(MaxCollaborativeNodes + 1)); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("body above the limit error = %v, want ErrTooLarge", err)
	}
}

func TestValidateCollaborativeChangeRejectsGrowthPastTheLimitButAllowsEditsThatDoNotGrow(t *testing.T) {
	atLimit := bodyOfNodes(MaxCollaborativeNodes)
	grown := atLimit
	grown.Nodes = append(append([]Node(nil), atLimit.Nodes...), node(atLimit.DocumentID, uuid.New(), &atLimit.RootNodeID, float64(MaxCollaborativeNodes), "thematic-break"))
	if err := ValidateCollaborativeChange(atLimit, grown); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("growth past the limit error = %v, want ErrTooLarge", err)
	}

	over := grown
	if err := ValidateCollaborativeChange(over, over); err != nil {
		t.Fatalf("non-growing edit of an oversized body: %v", err)
	}
}
