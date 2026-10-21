package usecase

import (
	"backend/constant"
	"context"
	"encoding/base64"
	"errors"
	"math"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"backend/internal/application/airuns"
	"backend/internal/application/aiusage"
	"backend/internal/domain/mention"
	"backend/internal/domain/model"
	"backend/internal/domain/searchscope"

	"github.com/google/uuid"
)

var (
	ErrInvalidChatRequest = errors.New("invalid chatbot request")
	// ErrMentionUnavailable: a question names a document the User cannot read here.
	ErrMentionUnavailable = errors.New("a mentioned document is not available")
	// ErrTooManyMentions: a question names more than MaxMentions documents.
	ErrTooManyMentions        = errors.New("too many documents are mentioned")
	ErrAnswerModelUnavailable = errors.New("RAG answer model is unavailable")
	ErrRAGProviderUnavailable = errors.New("RAG model provider is unavailable")
	// ErrEmbeddingNotConfigured is what an embedder returns when no provider is set up;
	// chat then searches by text alone.
	ErrEmbeddingNotConfigured = errors.New("no embedding provider is configured")
)

type ModelInput struct {
	Question string
	Language string
	History  []model.RAGMessage
	Sources  []model.RAGChunk
	// Context is other chats of the User, background only and never evidence.
	Context []model.ContextChat
	// Attachments are files the User attached to this question; the model may cite them by ID.
	Attachments []model.QuestionAttachment
	// Editor is what the DBML or Mermaid editor reported; data, never instructions.
	Editor *model.EditorContext
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
	ReadableDocumentTitles(ctx context.Context, workspaceID, actorID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]string, error)
	SearchDocumentTitles(ctx context.Context, workspaceID, actorID uuid.UUID, text string, limit int) ([]model.RAGDocumentHit, error)
	LookupDocuments(ctx context.Context, workspaceID, actorID uuid.UUID, ids []uuid.UUID) ([]model.RAGDocumentHit, error)
	GetRAGConversationPage(ctx context.Context, conversationID, actorID uuid.UUID, before int64, limit int) (model.RAGConversationHistory, int64, error)
	DeleteRAGConversation(context.Context, uuid.UUID, uuid.UUID) error
	RAGTitleSource(ctx context.Context, conversationID, actorID uuid.UUID) (question, answer string, ok bool, err error)
	SetGeneratedRAGTitle(ctx context.Context, conversationID, actorID uuid.UUID, title string) error
	RAGCategories(ctx context.Context, workspaceID, actorID uuid.UUID) ([]model.RAGCategory, error)
	CountVisibleRAGCategories(ctx context.Context, workspaceID, actorID uuid.UUID, ids []uuid.UUID) (int, error)
	RAGContextChats(ctx context.Context, workspaceID, actorID uuid.UUID, ids []uuid.UUID) ([]model.ContextChat, error)
	MarkRAGConversationRead(ctx context.Context, conversationID, actorID uuid.UUID) error
	UpdateRAGConversation(ctx context.Context, conversationID, actorID uuid.UUID, patch model.RAGConversationPatch) (model.RAGConversation, error)
	SearchRAGChunksWithPublicLinkTokens(context.Context, uuid.UUID, uuid.UUID, string, int, []string) ([]model.RAGChunk, error)
	SearchRAGChunksWithEmbedding(context.Context, uuid.UUID, uuid.UUID, string, []float32, string, string, int, []string) ([]model.RAGChunk, error)
	HasStaleReadableRAGIndex(context.Context, uuid.UUID, uuid.UUID, []string, string, string) (bool, error)
	StoreRAGAnswer(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string, string, bool, bool, []model.RAGCitation, []string) error
	CreateDocumentRAGConversation(ctx context.Context, workspaceID, actorID, documentID uuid.UUID) (model.RAGConversation, error)
	ListDocumentRAGConversations(ctx context.Context, actorID, documentID uuid.UUID) ([]model.RAGConversation, error)
	ListRAGChunksForDocument(ctx context.Context, workspaceID, actorID, documentID uuid.UUID, limit int) ([]model.RAGChunk, error)
}

type AskInput struct {
	// Extras were checked by PrepareExtras.
	Extras           model.QuestionExtras
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

// CreateDocumentConversation opens a Conversation on one document the actor may read.
func (u *ChatUseCase) CreateDocumentConversation(ctx context.Context, workspaceID, actorID, documentID uuid.UUID) (model.RAGConversation, error) {
	if workspaceID == uuid.Nil || actorID == uuid.Nil || documentID == uuid.Nil {
		return model.RAGConversation{}, ErrInvalidChatRequest
	}
	return u.repository.CreateDocumentRAGConversation(ctx, workspaceID, actorID, documentID)
}

// ListDocumentConversations lists the actor's own Conversations on one document.
func (u *ChatUseCase) ListDocumentConversations(ctx context.Context, actorID, documentID uuid.UUID) ([]model.RAGConversation, error) {
	if actorID == uuid.Nil || documentID == uuid.Nil {
		return nil, ErrInvalidChatRequest
	}
	return u.repository.ListDocumentRAGConversations(ctx, actorID, documentID)
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

// SearchDocuments lists documents a question can name, for the picker.
func (u *ChatUseCase) SearchDocuments(ctx context.Context, workspaceID, actorID uuid.UUID, text string, limit int) ([]model.RAGDocumentHit, error) {
	if workspaceID == uuid.Nil || actorID == uuid.Nil || limit < 1 || len(text) > 200 {
		return nil, ErrInvalidChatRequest
	}
	return u.repository.SearchDocumentTitles(ctx, workspaceID, actorID, text, min(limit, 20))
}

// MaxLookup is how many documents one answer may ask about at once.
const MaxLookup = 20

// LookupDocuments names the documents an answer refers to. Only those the User
// may read now, in this workspace and not in the trash, come back; the rest are
// left out, so an unknown, hidden or removed id looks the same.
func (u *ChatUseCase) LookupDocuments(ctx context.Context, workspaceID, actorID uuid.UUID, ids []uuid.UUID) ([]model.RAGDocumentHit, error) {
	if workspaceID == uuid.Nil || actorID == uuid.Nil || len(ids) > MaxLookup {
		return nil, ErrInvalidChatRequest
	}
	if len(ids) == 0 {
		return []model.RAGDocumentHit{}, nil
	}
	return u.repository.LookupDocuments(ctx, workspaceID, actorID, ids)
}

// MaxMentions is how many different documents one question may name.
const MaxMentions = 5

// ResolveMentions checks the documents a question names and returns it with
// each label written from the document's current title (ADR 0036). It refuses
// a document the User cannot read in the workspace and more than MaxMentions
// different documents; naming one document again does not count twice.
func (u *ChatUseCase) ResolveMentions(ctx context.Context, workspaceID, actorID uuid.UUID, question string) (string, error) {
	found := mention.ParseDocuments(question)
	if len(found) == 0 {
		return question, nil
	}
	var ids []uuid.UUID
	seen := map[uuid.UUID]bool{}
	for _, f := range found {
		if !seen[f.DocumentID] {
			seen[f.DocumentID] = true
			ids = append(ids, f.DocumentID)
		}
	}
	if len(ids) > MaxMentions {
		return "", ErrTooManyMentions
	}
	titles, err := u.repository.ReadableDocumentTitles(ctx, workspaceID, actorID, ids)
	if err != nil {
		return "", err
	}
	for _, id := range ids {
		if _, ok := titles[id]; !ok {
			return "", ErrMentionUnavailable
		}
	}
	return mention.RewriteDocuments(question, func(id uuid.UUID) string { return mention.DocumentLabel(titles[id]) }), nil
}

const (
	// DefaultHistoryPage is how many messages a conversation shows at first.
	DefaultHistoryPage = 30
	maxHistoryPage     = 100
)

// GetConversationPage returns one page of a conversation, newest page first.
// cursor is empty for the newest page, or the opaque value an earlier page
// returned; the returned cursor is empty when nothing older remains.
func (u *ChatUseCase) GetConversationPage(ctx context.Context, conversationID, actorID uuid.UUID, cursor string, limit int) (model.RAGConversationHistory, string, error) {
	if conversationID == uuid.Nil || actorID == uuid.Nil || limit < 1 {
		return model.RAGConversationHistory{}, "", ErrInvalidChatRequest
	}
	limit = min(limit, maxHistoryPage)
	var before int64
	if cursor != "" {
		raw, err := base64.RawURLEncoding.DecodeString(cursor)
		if err == nil {
			before, err = strconv.ParseInt(string(raw), 10, 64)
		}
		if err != nil || before < 1 {
			return model.RAGConversationHistory{}, "", ErrInvalidChatRequest
		}
	}
	history, next, err := u.repository.GetRAGConversationPage(ctx, conversationID, actorID, before, limit)
	if err != nil || next == 0 {
		return history, "", err
	}
	return history, base64.RawURLEncoding.EncodeToString([]byte(strconv.FormatInt(next, 10))), nil
}

// maxConversationTitle is the longest title a User may give a Conversation.
const maxConversationTitle = 120

// UpdateConversation renames, pins, unpins, archives or restores one of the
// actor's Conversations. A title is trimmed and may not end up empty.
func (u *ChatUseCase) UpdateConversation(ctx context.Context, conversationID, actorID uuid.UUID, patch model.RAGConversationPatch) (model.RAGConversation, error) {
	if conversationID == uuid.Nil || actorID == uuid.Nil || (patch.Title == nil && patch.Pinned == nil && patch.Archived == nil) {
		return model.RAGConversation{}, ErrInvalidChatRequest
	}
	if patch.Title != nil {
		title := strings.TrimSpace(*patch.Title)
		if title == "" || utf8.RuneCountInString(title) > maxConversationTitle {
			return model.RAGConversation{}, ErrInvalidChatRequest
		}
		patch.Title = &title
	}
	return u.repository.UpdateRAGConversation(ctx, conversationID, actorID, patch)
}

// TitleRequest opens the request that asks the model for a Conversation's title.
const TitleRequest = "Write a short title (at most six words, no quotes) for this conversation."

const maxGeneratedTitle = 60

// TitleConversation asks the model for a short title once a Conversation has its
// first answer, and keeps it unless the User renamed the Conversation meanwhile.
// It does nothing when no model is set up.
func (u *ChatUseCase) TitleConversation(ctx context.Context, workspaceID, conversationID, actorID uuid.UUID, language string) error {
	if u.model == nil {
		return nil
	}
	question, answer, ok, err := u.repository.RAGTitleSource(ctx, conversationID, actorID)
	if err != nil || !ok {
		return err
	}
	ctx = aiusage.With(ctx, aiusage.Attribution{Feature: aiusage.FeatureChatTitle, UserID: actorID, WorkspaceID: workspaceID})
	exchange := "Question: " + clip(mention.VisibleDocuments(question), 1000) + "\nAnswer: " + clip(answer, 1000)
	generated, err := u.model.Answer(ctx, ModelInput{
		Question: TitleRequest + " Reply in the language of the question.",
		Language: normalizeRAGLanguage(language),
		Sources:  []model.RAGChunk{{ChunkID: uuid.New(), Text: exchange}},
	})
	if err != nil {
		return err
	}
	title := tidyTitle(generated.Text)
	if title == "" {
		return nil
	}
	return u.repository.SetGeneratedRAGTitle(ctx, conversationID, actorID, title)
}

func clip(text string, runes int) string {
	if utf8.RuneCountInString(text) <= runes {
		return text
	}
	return string([]rune(text)[:runes])
}

// tidyTitle keeps the first line, drops quotes and extra spaces, and shortens it.
func tidyTitle(text string) string {
	line, _, _ := strings.Cut(strings.TrimSpace(text), "\n")
	line = strings.Join(strings.Fields(strings.Trim(strings.TrimSpace(line), "\"'`“”‘’")), " ")
	return strings.TrimSpace(clip(line, maxGeneratedTitle))
}

// MarkConversationRead records that the actor has seen the Conversation's latest answer.
func (u *ChatUseCase) MarkConversationRead(ctx context.Context, conversationID, actorID uuid.UUID) error {
	if conversationID == uuid.Nil || actorID == uuid.Nil {
		return ErrInvalidChatRequest
	}
	return u.repository.MarkRAGConversationRead(ctx, conversationID, actorID)
}

func (u *ChatUseCase) DeleteConversation(ctx context.Context, conversationID, actorID uuid.UUID) error {
	if conversationID == uuid.Nil || actorID == uuid.Nil {
		return ErrInvalidChatRequest
	}
	return u.repository.DeleteRAGConversation(ctx, conversationID, actorID)
}

// Authorize checks that the actor may ask in the conversation, so a run can be
// refused before it starts.
func (u *ChatUseCase) Authorize(ctx context.Context, workspaceID, conversationID, actorID uuid.UUID) error {
	if workspaceID == uuid.Nil || conversationID == uuid.Nil || actorID == uuid.Nil {
		return ErrInvalidChatRequest
	}
	return u.repository.AuthorizeRAGQuestion(ctx, workspaceID, conversationID, actorID)
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
	if err := airuns.Emit(ctx, "status", map[string]string{"phase": "searching"}); err != nil {
		return Answer{}, err
	}
	previousQuestions := make([]model.RAGMessage, 0, 10)
	for _, message := range history.Messages {
		if message.Role == "user" {
			message.Content = mention.VisibleDocuments(message.Content)
			previousQuestions = append(previousQuestions, message)
		}
	}
	if len(previousQuestions) > 10 {
		previousQuestions = previousQuestions[len(previousQuestions)-10:]
	}
	// The model and the search read "@Title"; the ids stay in the stored question.
	visible := mention.VisibleDocuments(question)
	retrievalQuery := visible
	if len(previousQuestions) > 0 && needsRAGHistoryContext(visible) {
		retrievalQuery += " " + previousQuestions[len(previousQuestions)-1].Content
	}
	linkTokens := append([]string{}, input.PublicLinkTokens...)
	var chunks []model.RAGChunk
	embedder := u.embedder
	var vector []float32
	feature := aiusage.FeatureChatWorkspace
	if history.Conversation.DocumentID != nil {
		feature = aiusage.FeatureChatDocument
	}
	ctx = aiusage.With(ctx, aiusage.Attribution{Feature: feature, UserID: input.ActorID, WorkspaceID: input.WorkspaceID})
	ctx = searchscope.WithCategories(ctx, input.Extras.CategoryIDs)
	if history.Conversation.DocumentID != nil {
		// A document Conversation draws on its document alone.
		chunks, err = u.repository.ListRAGChunksForDocument(ctx, input.WorkspaceID, input.ActorID, *history.Conversation.DocumentID, 40)
		if err != nil {
			return Answer{}, err
		}
		embedder = nil
	} else if embedder != nil {
		vectors, embedErr := embedder.Embed(ctx, []string{retrievalQuery})
		switch {
		case errors.Is(embedErr, ErrEmbeddingNotConfigured):
			embedder = nil
		case embedErr != nil:
			return Answer{}, embedErr
		case len(vectors) != 1 || !validEmbedding(vectors[0], embedder.Dimensions()):
			return Answer{}, errors.New("embedding model returned an invalid vector")
		default:
			vector = vectors[0]
		}
	}
	switch {
	case history.Conversation.DocumentID != nil:
	case embedder == nil:
		chunks, err = u.repository.SearchRAGChunksWithPublicLinkTokens(ctx, input.WorkspaceID, input.ActorID, retrievalQuery, 20, linkTokens)
	default:
		chunks, err = u.repository.SearchRAGChunksWithEmbedding(ctx, input.WorkspaceID, input.ActorID, retrievalQuery, vector, embedder.Provider(), embedder.Model(), 20, linkTokens)
	}
	if err != nil {
		return Answer{}, err
	}
	chunks, err = u.withMentionedDocuments(ctx, input, question, chunks)
	if err != nil {
		return Answer{}, err
	}
	provider, embeddingModel := "", ""
	if embedder != nil {
		provider, embeddingModel = embedder.Provider(), embedder.Model()
	}
	sourcesMayBeIncomplete, err := u.repository.HasStaleReadableRAGIndex(ctx, input.WorkspaceID, input.ActorID, linkTokens, provider, embeddingModel)
	if err != nil {
		return Answer{}, err
	}
	answer := Answer{
		ConversationID: input.ConversationID, Citations: []model.RAGCitation{},
		SourcesMayBeIncomplete: sourcesMayBeIncomplete,
	}
	storedQuestion := input.Extras.Annotate(question)
	if len(chunks) == 0 && len(input.Extras.Attachments) == 0 {
		answer.Text = noEvidenceMessage(language)
		if err := u.repository.StoreRAGAnswer(ctx, input.WorkspaceID, input.ConversationID, input.ActorID, storedQuestion, answer.Text, answer.CoveragePartial, answer.SourcesMayBeIncomplete, nil, linkTokens); err != nil {
			return Answer{}, err
		}
		return answer, nil
	}
	if u.model == nil {
		return Answer{}, ErrAnswerModelUnavailable
	}
	if err := airuns.Emit(ctx, "status", map[string]string{"phase": "answering"}); err != nil {
		return Answer{}, err
	}
	generated, err := u.model.Answer(ctx, ModelInput{
		Question: visible, Language: language, History: previousQuestions, Sources: chunks,
		Context: input.Extras.ContextChats, Attachments: input.Extras.Attachments, Editor: input.Extras.Editor,
	})
	if err != nil {
		return Answer{}, err
	}
	chunkByID := make(map[uuid.UUID]model.RAGChunk, len(chunks))
	for _, chunk := range chunks {
		chunkByID[chunk.ChunkID] = chunk
		answer.CoveragePartial = answer.CoveragePartial || chunk.CoverageStatus == "partial"
	}
	attached := make(map[uuid.UUID]bool, len(input.Extras.Attachments))
	for _, attachment := range input.Extras.Attachments {
		attached[attachment.ID] = true
	}
	citedAttachment := false
	seen := make(map[uuid.UUID]struct{}, len(generated.SourceIDs))
	for _, sourceID := range generated.SourceIDs {
		if attached[sourceID] {
			citedAttachment = true
			continue
		}
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
	if strings.TrimSpace(generated.Text) == "" || (len(answer.Citations) == 0 && !citedAttachment) {
		answer.Text = noEvidenceMessage(language)
		answer.Citations = []model.RAGCitation{}
		answer.CoveragePartial = false
	} else {
		answer.Text = strings.TrimSpace(generated.Text)
	}
	if err := u.repository.StoreRAGAnswer(ctx, input.WorkspaceID, input.ConversationID, input.ActorID, storedQuestion, answer.Text, answer.CoveragePartial, answer.SourcesMayBeIncomplete, answer.Citations, linkTokens); err != nil {
		return Answer{}, err
	}
	return answer, nil
}

// mentionedChunkBudget is how many chunks the mentioned documents share, so a
// question that names five long documents does not fill the prompt with them.
const mentionedChunkBudget = 40

// withMentionedDocuments puts the text of the documents the question names in
// front of what the search found, so they are always read. A document that has
// no current index yet adds nothing, and a long one is cut to its share.
func (u *ChatUseCase) withMentionedDocuments(ctx context.Context, input AskInput, question string, found []model.RAGChunk) ([]model.RAGChunk, error) {
	var ids []uuid.UUID
	seen := map[uuid.UUID]bool{}
	for _, named := range mention.ParseDocuments(question) {
		if !seen[named.DocumentID] {
			seen[named.DocumentID] = true
			ids = append(ids, named.DocumentID)
		}
	}
	if len(ids) == 0 {
		return found, nil
	}
	share := max(mentionedChunkBudget/len(ids), 8)
	merged := make([]model.RAGChunk, 0, len(found)+len(ids)*share)
	have := map[uuid.UUID]bool{}
	truncated := false
	for _, id := range ids {
		chunks, err := u.repository.ListRAGChunksForDocument(ctx, input.WorkspaceID, input.ActorID, id, share)
		if errors.Is(err, constant.ErrDocumentNotFound) || errors.Is(err, constant.ErrForbidden) {
			// Deleted or no longer readable since the question was checked.
			continue
		}
		if err != nil {
			return nil, err
		}
		truncated = truncated || len(chunks) == share
		for _, chunk := range chunks {
			if !have[chunk.ChunkID] {
				have[chunk.ChunkID] = true
				merged = append(merged, chunk)
			}
		}
	}
	for _, chunk := range found {
		if !have[chunk.ChunkID] {
			have[chunk.ChunkID] = true
			merged = append(merged, chunk)
		}
	}
	if err := airuns.Emit(ctx, "status", map[string]any{"phase": "reading", "truncated": truncated}); err != nil {
		return nil, err
	}
	return merged, nil
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
