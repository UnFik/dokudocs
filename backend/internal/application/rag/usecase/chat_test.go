package usecase

import (
	"context"
	"errors"
	"testing"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

// chatRepo records which search the chat took; the rest of ChatRepository is unused here.
type chatRepo struct {
	ChatRepository
	lexicalCalls, semanticCalls int
	staleProvider               string
	chunks                      []model.RAGChunk
}

func (r *chatRepo) AuthorizeRAGQuestion(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error {
	return nil
}
func (r *chatRepo) GetRAGConversation(context.Context, uuid.UUID, uuid.UUID) (model.RAGConversationHistory, error) {
	return model.RAGConversationHistory{}, nil
}
func (r *chatRepo) SearchRAGChunksWithPublicLinkTokens(context.Context, uuid.UUID, uuid.UUID, string, int, []string) ([]model.RAGChunk, error) {
	r.lexicalCalls++
	return r.chunks, nil
}
func (r *chatRepo) SearchRAGChunksWithEmbedding(context.Context, uuid.UUID, uuid.UUID, string, []float32, string, string, int, []string) ([]model.RAGChunk, error) {
	r.semanticCalls++
	return r.chunks, nil
}
func (r *chatRepo) HasStaleReadableRAGIndex(_ context.Context, _, _ uuid.UUID, _ []string, provider, _ string) (bool, error) {
	r.staleProvider = provider
	return false, nil
}
func (r *chatRepo) StoreRAGAnswer(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string, string, bool, bool, []model.RAGCitation, []string) error {
	return nil
}

type unconfiguredEmbedder struct{}

func (unconfiguredEmbedder) Provider() string { return "" }
func (unconfiguredEmbedder) Model() string    { return "" }
func (unconfiguredEmbedder) Dimensions() int  { return 1536 }
func (unconfiguredEmbedder) Embed(context.Context, []string) ([][]float32, error) {
	return nil, ErrEmbeddingNotConfigured
}

type brokenEmbedder struct{ unconfiguredEmbedder }

func (brokenEmbedder) Embed(context.Context, []string) ([][]float32, error) {
	return nil, ErrRAGProviderUnavailable
}

func ask(t *testing.T, repo *chatRepo, embedder EmbeddingModel) error {
	t.Helper()
	_, err := NewChatUseCase(repo, nil, embedder).Ask(context.Background(), AskInput{
		WorkspaceID: uuid.New(), ConversationID: uuid.New(), ActorID: uuid.New(), Question: "where is it deployed",
	})
	return err
}

func TestChatFallsBackToTextSearchWhenNoEmbeddingProviderIsConfigured(t *testing.T) {
	repo := &chatRepo{}
	if err := ask(t, repo, unconfiguredEmbedder{}); err != nil {
		t.Fatalf("Ask(): %v", err)
	}
	if repo.lexicalCalls != 1 || repo.semanticCalls != 0 || repo.staleProvider != "" {
		t.Fatalf("lexical %d, semantic %d, stale check for %q", repo.lexicalCalls, repo.semanticCalls, repo.staleProvider)
	}
}

func TestChatReportsAnEmbeddingProviderThatIsDown(t *testing.T) {
	repo := &chatRepo{}
	if err := ask(t, repo, brokenEmbedder{}); !errors.Is(err, ErrRAGProviderUnavailable) {
		t.Fatalf("Ask() error = %v, want ErrRAGProviderUnavailable", err)
	}
	if repo.lexicalCalls != 0 {
		t.Fatal("a provider outage silently fell back to text search")
	}
}
