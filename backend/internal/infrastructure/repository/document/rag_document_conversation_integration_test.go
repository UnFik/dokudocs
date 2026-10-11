//go:build integration

package document

import (
	"encoding/json"
	"errors"
	"testing"

	"backend/constant"
)

func TestADocumentConversationIsListedApartAndFollowsDocumentAccess(t *testing.T) {
	f := newRAGLifecycleFixture(t)
	doc := f.newDocument("Spec", "private", "The login uses passkeys.")
	other := f.newDocument("Other", "workspace", "Unrelated pelican text.")
	f.indexWithEmbeddings()

	if _, err := f.repo.CreateDocumentRAGConversation(f.ctx, f.workspaceID, f.reader, doc); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("a reader without access opened a conversation on a private document: %v", err)
	}
	conv, err := f.repo.CreateDocumentRAGConversation(f.ctx, f.workspaceID, f.owner, doc)
	if err != nil || conv.DocumentID == nil || *conv.DocumentID != doc {
		t.Fatalf("CreateDocumentRAGConversation() = %+v, %v", conv, err)
	}
	workspaceConv, err := f.repo.CreateRAGConversation(f.ctx, f.workspaceID, f.owner)
	if err != nil {
		t.Fatal(err)
	}

	listed, err := f.repo.ListRAGConversations(f.ctx, f.owner)
	if err != nil || len(listed) != 1 || listed[0].ID != workspaceConv.ID {
		t.Fatalf("workspace list = %+v, %v; want only the workspace conversation", listed, err)
	}
	onDoc, err := f.repo.ListDocumentRAGConversations(f.ctx, f.owner, doc)
	if err != nil || len(onDoc) != 1 || onDoc[0].ID != conv.ID {
		t.Fatalf("document list = %+v, %v", onDoc, err)
	}

	if err := f.repo.AuthorizeRAGQuestion(f.ctx, f.workspaceID, conv.ID, f.owner); err != nil {
		t.Fatalf("the owner may ask: %v", err)
	}

	chunks, err := f.repo.ListRAGChunksForDocument(f.ctx, f.workspaceID, f.owner, doc, 20)
	if err != nil || len(chunks) == 0 {
		t.Fatalf("ListRAGChunksForDocument() = %d chunks, %v", len(chunks), err)
	}
	for _, c := range chunks {
		if c.DocumentID != doc {
			t.Fatalf("a chunk from another document (%s) came back", c.DocumentID)
		}
	}
	_ = other

	meta := json.RawMessage(`{"tools":["read_document"],"actions":["a1"]}`)
	if err := f.repo.StoreAgentAnswer(f.ctx, f.workspaceID, conv.ID, f.owner, "What does it use?", "Passkeys.", meta); err != nil {
		t.Fatalf("StoreAgentAnswer(): %v", err)
	}
	history, err := f.repo.GetRAGConversation(f.ctx, conv.ID, f.owner)
	if err != nil || history.Conversation.DocumentID == nil || len(history.Messages) != 2 {
		t.Fatalf("GetRAGConversation() = %+v, %v", history, err)
	}
	var got map[string]any
	if json.Unmarshal(history.Messages[1].Meta, &got) != nil || got["tools"] == nil {
		t.Fatalf("meta = %s", history.Messages[1].Meta)
	}

	// Taking the owner's grant away is not possible (they authored it), so trash the document instead.
	f.exec(`UPDATE documents SET deleted_at = NOW() WHERE id = $1`, doc)
	if err := f.repo.AuthorizeRAGQuestion(f.ctx, f.workspaceID, conv.ID, f.owner); err == nil {
		t.Fatal("a question was allowed on a document that is gone")
	}
	if _, err := f.repo.GetRAGConversation(f.ctx, conv.ID, f.owner); err != nil {
		t.Fatalf("the history must stay readable: %v", err)
	}
}
