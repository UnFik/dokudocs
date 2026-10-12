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

type docChatRepo struct {
	chatRepo
	documentID uuid.UUID
	docCalls   int
}

func (r *docChatRepo) GetRAGConversation(context.Context, uuid.UUID, uuid.UUID) (model.RAGConversationHistory, error) {
	return model.RAGConversationHistory{Conversation: model.RAGConversation{DocumentID: &r.documentID}}, nil
}
func (r *docChatRepo) ListRAGChunksForDocument(_ context.Context, _, _, documentID uuid.UUID, _ int) ([]model.RAGChunk, error) {
	r.docCalls++
	return nil, nil
}

func TestADocumentConversationOnlyDrawsOnItsDocument(t *testing.T) {
	repo := &docChatRepo{documentID: uuid.New()}
	if err := ask(t, &repo.chatRepo, unconfiguredEmbedder{}); err != nil {
		t.Fatal(err)
	}
	repo.chatRepo = chatRepo{}
	_, err := NewChatUseCase(repo, nil, unconfiguredEmbedder{}).Ask(context.Background(), AskInput{
		WorkspaceID: uuid.New(), ConversationID: uuid.New(), ActorID: uuid.New(), Question: "what does it say",
	})
	if err != nil {
		t.Fatalf("Ask(): %v", err)
	}
	if repo.docCalls != 1 || repo.lexicalCalls != 0 || repo.semanticCalls != 0 {
		t.Fatalf("document chunks %d, lexical %d, semantic %d", repo.docCalls, repo.lexicalCalls, repo.semanticCalls)
	}
}

type mentionRepo struct {
	chatRepo
	chunksByDocument map[uuid.UUID][]model.RAGChunk
	asked            []uuid.UUID
}

func (r *mentionRepo) ListRAGChunksForDocument(_ context.Context, _, _, documentID uuid.UUID, _ int) ([]model.RAGChunk, error) {
	r.asked = append(r.asked, documentID)
	return r.chunksByDocument[documentID], nil
}

type capturingModel struct{ got ModelInput }

func (m *capturingModel) Answer(_ context.Context, input ModelInput) (ModelOutput, error) {
	m.got = input
	ids := make([]uuid.UUID, len(input.Sources))
	for i, source := range input.Sources {
		ids[i] = source.ChunkID
	}
	return ModelOutput{Text: "done", SourceIDs: ids}, nil
}

func TestAMentionedDocumentIsAlwaysInTheModelsSourcesWhateverTheSearchFinds(t *testing.T) {
	mentioned, found := uuid.New(), uuid.New()
	mentionedChunk := model.RAGChunk{ChunkID: uuid.New(), DocumentID: mentioned, Text: "The runbook says restart."}
	foundChunk := model.RAGChunk{ChunkID: uuid.New(), DocumentID: found, Text: "Found by search."}
	repo := &mentionRepo{
		chatRepo:         chatRepo{chunks: []model.RAGChunk{foundChunk, mentionedChunk}},
		chunksByDocument: map[uuid.UUID][]model.RAGChunk{mentioned: {mentionedChunk}},
	}
	answers := &capturingModel{}
	question := "what does @[Runbook](doc:" + mentioned.String() + ") say about restarts?"
	if _, err := NewChatUseCase(repo, answers, unconfiguredEmbedder{}).Ask(context.Background(), AskInput{
		WorkspaceID: uuid.New(), ConversationID: uuid.New(), ActorID: uuid.New(), Question: question,
	}); err != nil {
		t.Fatalf("Ask(): %v", err)
	}
	if len(repo.asked) != 1 || repo.asked[0] != mentioned {
		t.Fatalf("read chunks of %v, want only the mentioned document %s", repo.asked, mentioned)
	}
	ids := map[uuid.UUID]int{}
	for _, source := range answers.got.Sources {
		ids[source.ChunkID]++
	}
	if ids[mentionedChunk.ChunkID] != 1 || ids[foundChunk.ChunkID] != 1 || len(answers.got.Sources) != 2 {
		t.Errorf("sources = %+v, want the mentioned chunk and the searched chunk once each", answers.got.Sources)
	}
	if want := "what does @Runbook say about restarts?"; answers.got.Question != want {
		t.Errorf("the model was asked %q, want %q (no ids in the prompt)", answers.got.Question, want)
	}
}

func TestMentionedSourcesComeFirstSoTheyAreNotCutOff(t *testing.T) {
	mentioned := uuid.New()
	mentionedChunk := model.RAGChunk{ChunkID: uuid.New(), DocumentID: mentioned, Text: "mentioned"}
	var searched []model.RAGChunk
	for i := 0; i < 20; i++ {
		searched = append(searched, model.RAGChunk{ChunkID: uuid.New(), DocumentID: uuid.New(), Text: "searched"})
	}
	repo := &mentionRepo{
		chatRepo:         chatRepo{chunks: searched},
		chunksByDocument: map[uuid.UUID][]model.RAGChunk{mentioned: {mentionedChunk}},
	}
	answers := &capturingModel{}
	if _, err := NewChatUseCase(repo, answers, unconfiguredEmbedder{}).Ask(context.Background(), AskInput{
		WorkspaceID: uuid.New(), ConversationID: uuid.New(), ActorID: uuid.New(),
		Question: "@[Doc](doc:" + mentioned.String() + ") summary",
	}); err != nil {
		t.Fatal(err)
	}
	if len(answers.got.Sources) == 0 || answers.got.Sources[0].ChunkID != mentionedChunk.ChunkID {
		t.Errorf("first source = %+v, want the mentioned chunk", answers.got.Sources)
	}
}
