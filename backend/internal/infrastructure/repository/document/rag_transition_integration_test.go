//go:build integration

package document

import (
	"testing"

	"github.com/google/uuid"
)

const transitionProvider = "fake"

// transitionModel is new on every run, so leftovers from an earlier run cannot count as progress.
var transitionModel = "transition-" + uuid.NewString()

// embedAll stores a vector for every chunk still missing one for the given model.
func (f *ragLifecycleFixture) embedAll(provider, model string) {
	f.t.Helper()
	for {
		pending, err := f.repo.ListRAGChunksMissingEmbeddings(f.ctx, provider, model, 32)
		if err != nil {
			f.t.Fatalf("list missing embeddings: %v", err)
		}
		if len(pending) == 0 {
			return
		}
		embeddings := make([]RAGChunkEmbedding, len(pending))
		for i, chunk := range pending {
			vector := make([]float32, 1536)
			vector[0] = 1
			embeddings[i] = RAGChunkEmbedding{ChunkID: chunk.ChunkID, DocumentID: chunk.DocumentID, BodyVersion: chunk.BodyVersion, SourceFingerprint: chunk.SourceFingerprint, Vector: vector}
		}
		if err := f.repo.StoreRAGChunkEmbeddings(f.ctx, provider, model, embeddings); err != nil {
			f.t.Fatalf("store embeddings: %v", err)
		}
	}
}

func TestTwoEmbeddingModelsCanCoexistAndTheOldOneCanBeDropped(t *testing.T) {
	f := newRAGLifecycleFixture(t)
	// Dropping a model is global; give other tests' leftover documents their vectors back.
	t.Cleanup(func() {
		_, _ = f.db.ExecContext(f.ctx, `DELETE FROM workspaces WHERE id = $1`, f.workspaceID)
		f.embedAll(lifecycleProvider, lifecycleModel)
	})
	documentID := f.newDocument("Transition", "private", "The transition document mentions pelican.")
	f.indexWithEmbeddings()
	_, chunks, embeddings := f.derivedRows(documentID)
	if chunks == 0 || embeddings != chunks {
		t.Fatalf("after the first model: %d chunks, %d embeddings", chunks, embeddings)
	}

	done, total, err := f.repo.RAGEmbeddingProgress(f.ctx, transitionProvider, transitionModel)
	if err != nil || done != 0 || total < chunks {
		t.Fatalf("progress before the new model = %d of %d, %v", done, total, err)
	}

	f.embedAll(transitionProvider, transitionModel)
	if _, _, both := f.derivedRows(documentID); both != 2*chunks {
		t.Fatalf("embeddings with two models = %d, want %d", both, 2*chunks)
	}
	if !f.canRetrieve(f.owner, documentID, "xyzzy") {
		t.Fatal("the old model stopped finding the document while the new one was added")
	}
	done, total, err = f.repo.RAGEmbeddingProgress(f.ctx, transitionProvider, transitionModel)
	if err != nil || done != total || total < chunks {
		t.Fatalf("progress after the new model = %d of %d, %v", done, total, err)
	}

	if _, err := f.repo.DeleteRAGEmbeddingsExcept(f.ctx, transitionProvider, transitionModel); err != nil {
		t.Fatalf("DeleteRAGEmbeddingsExcept(): %v", err)
	}
	if _, _, left := f.derivedRows(documentID); left != chunks {
		t.Fatalf("embeddings after dropping the old model = %d, want %d", left, chunks)
	}
	if f.canRetrieve(f.owner, documentID, "xyzzy") {
		t.Fatal("the dropped model still finds the document")
	}
}
