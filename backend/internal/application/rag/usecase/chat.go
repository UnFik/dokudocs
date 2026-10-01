package usecase

import (
	"context"
	"errors"
	"math"
	"strings"
	"unicode"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

var (
	ErrInvalidChatRequest     = errors.New("invalid chatbot request")
	ErrAnswerModelUnavailable = errors.New("RAG answer model is unavailable")
	ErrRAGProviderUnavailable = errors.New("RAG model provider is unavailable")
)

type ModelInput struct {
	Question string
	Language string
	History  []model.RAGMessage
	Sources  []model.RAGChunk
}

type ModelOutput struct {
	Text      string
	SourceIDs []uuid.UUID
}

type AnswerModel interface {
	Answer(context.Context, ModelInput) (ModelOutput, error)
}

type EmbeddingModel interface {
	Provider() string
	Model() string
	Dimensions() int
	Embed(context.Context, []string) ([][]float32, error)
}

type ChatRepository interface {
	CreateRAGConversation(context.Context, uuid.UUID, uuid.UUID) (model.RAGConversation, error)
	ListRAGConversations(context.Context, uuid.UUID) ([]model.RAGConversation, error)
	AuthorizeRAGQuestion(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error
	GetRAGConversation(context.Context, uuid.UUID, uuid.UUID) (model.RAGConversationHistory, error)
	DeleteRAGConversation(context.Context, uuid.UUID, uuid.UUID) error
	SearchRAGChunksWithPublicLinkTokens(context.Context, uuid.UUID, uuid.UUID, string, int, []string) ([]model.RAGChunk, error)
	SearchRAGChunksWithEmbedding(context.Context, uuid.UUID, uuid.UUID, string, []float32, string, string, int, []string) ([]model.RAGChunk, error)
	HasStaleReadableRAGIndex(context.Context, uuid.UUID, uuid.UUID, []string, string, string) (bool, error)
	StoreRAGAnswer(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string, string, bool, bool, []model.RAGCitation, []string) error
}

type AskInput struct {
	WorkspaceID      uuid.UUID
	ConversationID   uuid.UUID
	ActorID          uuid.UUID
	Question         string
	Language         string
	PublicLinkTokens []string
}

type Answer struct {
	ConversationID         uuid.UUID           `json:"conversationId"`
	Text                   string              `json:"text"`
	Citations              []model.RAGCitation `json:"citations"`
	CoveragePartial        bool                `json:"coveragePartial"`
	SourcesMayBeIncomplete bool                `json:"sourcesMayBeIncomplete"`
}

type ChatUseCase struct {
	repository ChatRepository
	model      AnswerModel
	embedder   EmbeddingModel
}

func NewChatUseCase(repository ChatRepository, answerModel AnswerModel, embedder EmbeddingModel) *ChatUseCase {
	return &ChatUseCase{repository: repository, model: answerModel, embedder: embedder}
}

func (u *ChatUseCase) CreateConversation(ctx context.Context, workspaceID, actorID uuid.UUID) (model.RAGConversation, error) {
	if workspaceID == uuid.Nil || actorID == uuid.Nil {
		return model.RAGConversation{}, ErrInvalidChatRequest
	}
	return u.repository.CreateRAGConversation(ctx, workspaceID, actorID)
}

func (u *ChatUseCase) ListConversations(ctx context.Context, actorID uuid.UUID) ([]model.RAGConversation, error) {
	if actorID == uuid.Nil {
		return nil, ErrInvalidChatRequest
	}
	return u.repository.ListRAGConversations(ctx, actorID)
}

func (u *ChatUseCase) GetConversation(ctx context.Context, conversationID, actorID uuid.UUID) (model.RAGConversationHistory, error) {
	if conversationID == uuid.Nil || actorID == uuid.Nil {
		return model.RAGConversationHistory{}, ErrInvalidChatRequest
	}
	return u.repository.GetRAGConversation(ctx, conversationID, actorID)
}

func (u *ChatUseCase) DeleteConversation(ctx context.Context, conversationID, actorID uuid.UUID) error {
	if conversationID == uuid.Nil || actorID == uuid.Nil {
		return ErrInvalidChatRequest
	}
	return u.repository.DeleteRAGConversation(ctx, conversationID, actorID)
}

func (u *ChatUseCase) Ask(ctx context.Context, input AskInput) (Answer, error) {
	question := strings.TrimSpace(input.Question)
	if input.WorkspaceID == uuid.Nil || input.ConversationID == uuid.Nil || input.ActorID == uuid.Nil || question == "" || len(question) > 10000 || len(input.PublicLinkTokens) > 20 {
		return Answer{}, ErrInvalidChatRequest
	}
	language := normalizeRAGLanguage(input.Language)
	for _, token := range input.PublicLinkTokens {
		if strings.TrimSpace(token) == "" || len(token) > 64 {
			return Answer{}, ErrInvalidChatRequest
		}
	}
	if err := u.repository.AuthorizeRAGQuestion(ctx, input.WorkspaceID, input.ConversationID, input.ActorID); err != nil {
		return Answer{}, err
	}
	history, err := u.repository.GetRAGConversation(ctx, input.ConversationID, input.ActorID)
	if err != nil {
		return Answer{}, err
	}
	previousQuestions := make([]model.RAGMessage, 0, 10)
	for _, message := range history.Messages {
		if message.Role == "user" {
			previousQuestions = append(previousQuestions, message)
		}
	}
	if len(previousQuestions) > 10 {
		previousQuestions = previousQuestions[len(previousQuestions)-10:]
	}
	retrievalQuery := question
	if len(previousQuestions) > 0 && needsRAGHistoryContext(question) {
		retrievalQuery += " " + previousQuestions[len(previousQuestions)-1].Content
	}
	linkTokens := append([]string{}, input.PublicLinkTokens...)
	var chunks []model.RAGChunk
	if u.embedder == nil {
		chunks, err = u.repository.SearchRAGChunksWithPublicLinkTokens(ctx, input.WorkspaceID, input.ActorID, retrievalQuery, 20, linkTokens)
	} else {
		vectors, embedErr := u.embedder.Embed(ctx, []string{retrievalQuery})
		if embedErr != nil {
			return Answer{}, embedErr
		}
		if len(vectors) != 1 || !validEmbedding(vectors[0], u.embedder.Dimensions()) {
			return Answer{}, errors.New("embedding model returned an invalid vector")
		}
		chunks, err = u.repository.SearchRAGChunksWithEmbedding(ctx, input.WorkspaceID, input.ActorID, retrievalQuery, vectors[0], u.embedder.Provider(), u.embedder.Model(), 20, linkTokens)
	}
	if err != nil {
		return Answer{}, err
	}
	provider, embeddingModel := "", ""
	if u.embedder != nil {
		provider, embeddingModel = u.embedder.Provider(), u.embedder.Model()
	}
	sourcesMayBeIncomplete, err := u.repository.HasStaleReadableRAGIndex(ctx, input.WorkspaceID, input.ActorID, linkTokens, provider, embeddingModel)
	if err != nil {
		return Answer{}, err
	}
	answer := Answer{
		ConversationID: input.ConversationID, Citations: []model.RAGCitation{},
		SourcesMayBeIncomplete: sourcesMayBeIncomplete,
	}
	if len(chunks) == 0 {
		answer.Text = noEvidenceMessage(language)
		if err := u.repository.StoreRAGAnswer(ctx, input.WorkspaceID, input.ConversationID, input.ActorID, question, answer.Text, answer.CoveragePartial, answer.SourcesMayBeIncomplete, nil, linkTokens); err != nil {
			return Answer{}, err
		}
		return answer, nil
	}
	if u.model == nil {
		return Answer{}, ErrAnswerModelUnavailable
	}
	generated, err := u.model.Answer(ctx, ModelInput{Question: question, Language: language, History: previousQuestions, Sources: chunks})
	if err != nil {
		return Answer{}, err
	}
	chunkByID := make(map[uuid.UUID]model.RAGChunk, len(chunks))
	for _, chunk := range chunks {
		chunkByID[chunk.ChunkID] = chunk
		answer.CoveragePartial = answer.CoveragePartial || chunk.CoverageStatus == "partial"
	}
	seen := make(map[uuid.UUID]struct{}, len(generated.SourceIDs))
	for _, sourceID := range generated.SourceIDs {
		chunk, ok := chunkByID[sourceID]
		if !ok {
			continue
		}
		if _, exists := seen[sourceID]; exists {
			continue
		}
		seen[sourceID] = struct{}{}
		answer.Citations = append(answer.Citations, model.RAGCitation{
			ChunkID: chunk.ChunkID, DocumentID: chunk.DocumentID, DocumentTitle: chunk.Title,
			ProjectName: chunk.ProjectName, NodeID: chunk.NodeID,
			BodyVersion: chunk.BodyVersion, SourceFingerprint: chunk.SourceFingerprint,
			QuotedText: chunk.Text, Breadcrumb: chunk.Breadcrumb, Ordinal: len(answer.Citations),
		})
	}
	if strings.TrimSpace(generated.Text) == "" || len(answer.Citations) == 0 {
		answer.Text = noEvidenceMessage(language)
		answer.Citations = []model.RAGCitation{}
		answer.CoveragePartial = false
	} else {
		answer.Text = strings.TrimSpace(generated.Text)
	}
	if err := u.repository.StoreRAGAnswer(ctx, input.WorkspaceID, input.ConversationID, input.ActorID, question, answer.Text, answer.CoveragePartial, answer.SourcesMayBeIncomplete, answer.Citations, linkTokens); err != nil {
		return Answer{}, err
	}
	return answer, nil
}

func normalizeRAGLanguage(language string) string {
	language = strings.ToLower(strings.TrimSpace(language))
	if strings.HasPrefix(language, "en") {
		return "en"
	}
	return "id"
}

func needsRAGHistoryContext(question string) bool {
	question = strings.ToLower(strings.TrimSpace(question))
	for _, prefix := range []string{"what about", "how about", "what if", "and then", "and for", "bagaimana dengan", "bagaimana untuk", "kalau untuk", "dan untuk", "dan kalau"} {
		if strings.HasPrefix(question, prefix) {
			return true
		}
	}
	for _, word := range strings.FieldsFunc(question, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsNumber(r) }) {
		switch word {
		case "it", "that", "this", "they", "them", "those", "these", "then", "itu", "tersebut", "mereka":
			return true
		}
	}
	return false
}

func validEmbedding(vector []float32, dimensions int) bool {
	if dimensions <= 0 || len(vector) != dimensions {
		return false
	}
	norm := float64(0)
	for _, value := range vector {
		if math.IsNaN(float64(value)) || math.IsInf(float64(value), 0) {
			return false
		}
		norm += float64(value) * float64(value)
	}
	return norm > 0
}

func noEvidenceMessage(language string) string {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(language)), "en") {
		return "I couldn't find supporting information in the workspace documents."
	}
	return "Informasi pendukung tidak ditemukan di dokumen workspace."
}
