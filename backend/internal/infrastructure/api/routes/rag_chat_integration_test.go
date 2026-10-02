//go:build integration

package routes

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	jwtmanager "backend/internal/application/jwt"
	appchat "backend/internal/application/rag/usecase"
	"backend/internal/config"
	"backend/internal/domain/documentbody"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/collaboration/yjs"
	"backend/internal/infrastructure/database"
	"backend/internal/infrastructure/logger"
	documentrepo "backend/internal/infrastructure/repository/document"
	"backend/internal/infrastructure/runtime/container"
	"backend/internal/infrastructure/validator"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type ragChatEnvelope struct {
	Data json.RawMessage `json:"data"`
}

type fakeRAGAnswerModel struct {
	calls        *int
	histories    *[][]string
	sourceInputs *[][]string
	beforeAnswer *func() error
}

type fakeRAGEmbeddingModel struct{}

func (fakeRAGEmbeddingModel) Provider() string { return "fake" }
func (fakeRAGEmbeddingModel) Model() string    { return "cross-language-test-v1" }
func (fakeRAGEmbeddingModel) Dimensions() int  { return 1536 }
func (fakeRAGEmbeddingModel) Embed(_ context.Context, inputs []string) ([][]float32, error) {
	vectors := make([][]float32, len(inputs))
	for i, input := range inputs {
		vector := make([]float32, 1536)
		if strings.Contains(strings.ToLower(input), "service") || strings.Contains(strings.ToLower(input), "layanan") || strings.Contains(strings.ToLower(input), "health check") {
			vector[0] = 1
		} else if strings.Contains(strings.ToLower(input), "lunar archive") {
			vector[1] = 1
		} else if strings.Contains(strings.ToLower(input), "operational checks") {
			vector[2] = 1
		} else {
			vector[3] = 1
		}
		vectors[i] = vector
	}
	return vectors, nil
}

func (fake fakeRAGAnswerModel) Answer(_ context.Context, input appchat.ModelInput) (appchat.ModelOutput, error) {
	if len(input.Sources) == 0 {
		return appchat.ModelOutput{}, fmt.Errorf("model called without evidence")
	}
	*fake.calls = *fake.calls + 1
	questions := make([]string, 0, len(input.History))
	for _, message := range input.History {
		if message.Role != "user" {
			return appchat.ModelOutput{}, fmt.Errorf("historical assistant answer must not be passed as evidence")
		}
		questions = append(questions, message.Content)
	}
	*fake.histories = append(*fake.histories, questions)
	if fake.sourceInputs != nil {
		texts := make([]string, len(input.Sources))
		for i, source := range input.Sources {
			texts[i] = source.Text
		}
		*fake.sourceInputs = append(*fake.sourceInputs, texts)
	}
	if strings.Contains(strings.ToLower(input.Question), "documents conflict") {
		seenDocuments := make(map[uuid.UUID]struct{}, 2)
		conflictingSources := make([]model.RAGChunk, 0, 2)
		for _, source := range input.Sources {
			if _, seen := seenDocuments[source.DocumentID]; seen {
				continue
			}
			seenDocuments[source.DocumentID] = struct{}{}
			conflictingSources = append(conflictingSources, source)
			if len(conflictingSources) == 2 {
				break
			}
		}
		if len(conflictingSources) != 2 {
			return appchat.ModelOutput{}, fmt.Errorf("conflict answer requires evidence from two documents")
		}
		return appchat.ModelOutput{
			Text:      "The documents conflict: " + conflictingSources[0].Text + " versus " + conflictingSources[1].Text,
			SourceIDs: []uuid.UUID{conflictingSources[0].ChunkID, conflictingSources[1].ChunkID},
		}, nil
	}
	if fake.beforeAnswer != nil && *fake.beforeAnswer != nil {
		if err := (*fake.beforeAnswer)(); err != nil {
			return appchat.ModelOutput{}, err
		}
		*fake.beforeAnswer = nil
	}
	return appchat.ModelOutput{
		Text:      "The source says: " + input.Sources[0].Text,
		SourceIDs: []uuid.UUID{input.Sources[0].ChunkID},
	}, nil
}

func TestRAGChatHTTPPersistsGroundedAnswerAndPrivateHistory(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	ctx := context.Background()

	actorID, otherUserID, workspaceID, documentID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	if _, err := db.ExecContext(ctx, `INSERT INTO users (id, account_no, email, full_name) VALUES ($1, $2, $3, 'RAG test user')`, actorID, uuid.NewString(), fmt.Sprintf("rag-%s@example.invalid", actorID)); err != nil {
		t.Fatalf("create user: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO users (id, account_no, email, full_name) VALUES ($1, $2, $3, 'Other RAG user')`, otherUserID, uuid.NewString(), fmt.Sprintf("rag-other-%s@example.invalid", otherUserID)); err != nil {
		t.Fatalf("create other user: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'RAG test', $2, $3)`, workspaceID, "rag-"+workspaceID.String(), actorID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`, workspaceID, actorID); err != nil {
		t.Fatalf("add workspace member: %v", err)
	}
	t.Cleanup(func() {
		if _, err := db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID); err != nil {
			t.Errorf("delete RAG test workspace: %v", err)
		}
		if _, err := db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, actorID); err != nil {
			t.Errorf("delete RAG test user: %v", err)
		}
		if _, err := db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, otherUserID); err != nil {
			t.Errorf("delete RAG test other user: %v", err)
		}
		_ = db.Close()
	})
	if _, err := db.ExecContext(ctx, `INSERT INTO documents (id, workspace_id, title, type, author_id, visibility) VALUES ($1, $2, 'Operations runbook', 'markdown', $3, 'workspace')`, documentID, workspaceID, actorID); err != nil {
		t.Fatalf("create source document: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'owner')`, documentID, actorID); err != nil {
		t.Fatalf("add document owner grant: %v", err)
	}
	rootID, headingID, paragraphID, runID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	body := documentbody.Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []documentbody.Node{
		{DocumentID: documentID, NodeID: rootID, Type: "document", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: documentID, NodeID: headingID, ParentID: &rootID, SiblingOrder: 0, Type: "atx-heading", Content: "Operational checks", Attributes: []byte(`{"level":1}`), Version: 1},
		{DocumentID: documentID, NodeID: paragraphID, ParentID: &rootID, SiblingOrder: 1, Type: "paragraph", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: documentID, NodeID: runID, ParentID: &paragraphID, Type: "run", Content: "The service restarts after a failed health check.", Attributes: []byte(`{}`), Version: 1},
	}}
	encoded, err := yjs.EncodeBodyV1(body)
	if err != nil {
		t.Fatalf("encode canonical body: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_nodes (document_id, node_id, parent_id, sibling_order, node_type, content, attributes, version) VALUES ($1, $2, NULL, 0, 'document', '', '{}', 1), ($1, $3, $2, 0, 'atx-heading', 'Operational checks', '{"level":1}', 1), ($1, $4, $2, 1, 'paragraph', '', '{}', 1), ($1, $5, $4, 0, 'run', $6, '{}', 1)`, documentID, rootID, headingID, paragraphID, runID, body.Nodes[3].Content); err != nil {
		t.Fatalf("insert canonical nodes: %v", err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE documents SET root_node_id = $2 WHERE id = $1`, documentID, rootID); err != nil {
		t.Fatalf("set canonical root: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_collab_states (document_id, encoded_state, schema_version) VALUES ($1, $2, 1)`, documentID, encoded); err != nil {
		t.Fatalf("insert Yjs state: %v", err)
	}
	databaseAccess := database.NewSQLDB(db)
	repository := documentrepo.NewRepository(databaseAccess)
	if _, err := repository.RebuildRAGIndex(ctx, documentID); err != nil {
		t.Fatalf("index canonical body: %v", err)
	}
	sectionChunks, err := repository.SearchRAGChunks(ctx, workspaceID, actorID, "operational checks", 20)
	if err != nil {
		t.Fatalf("search by section breadcrumb: %v", err)
	}
	paragraphFoundBySection := false
	for _, chunk := range sectionChunks {
		if chunk.NodeID == paragraphID && chunk.Breadcrumb == "Operational checks" {
			paragraphFoundBySection = true
		}
	}
	if !paragraphFoundBySection {
		t.Fatalf("search by section breadcrumb returned %+v, want its paragraph source", sectionChunks)
	}
	publicDocumentID, publicProjectID, publicRootID, publicParagraphID, publicRunID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	publicToken := "rag-public-link-token-test"
	if _, err := db.ExecContext(ctx, `INSERT INTO projects (id, workspace_id, name, visibility, created_by) VALUES ($1, $2, 'Private knowledge base', 'private', $3)`, publicProjectID, workspaceID, actorID); err != nil {
		t.Fatalf("create private source project: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO documents (id, workspace_id, project_id, title, type, author_id, visibility, share_token) VALUES ($1, $2, $3, 'Lunar archive', 'markdown', $4, 'public_link', $5)`, publicDocumentID, workspaceID, publicProjectID, otherUserID, publicToken); err != nil {
		t.Fatalf("create public-link source document: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'view')`, publicDocumentID, actorID); err != nil {
		t.Fatalf("grant direct read to public-link source: %v", err)
	}
	publicBody := documentbody.Body{DocumentID: publicDocumentID, RootNodeID: publicRootID, Nodes: []documentbody.Node{
		{DocumentID: publicDocumentID, NodeID: publicRootID, Type: "document", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: publicDocumentID, NodeID: publicParagraphID, ParentID: &publicRootID, Type: "paragraph", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: publicDocumentID, NodeID: publicRunID, ParentID: &publicParagraphID, Type: "run", Content: "The lunar archive is stored in vault 314.", Attributes: []byte(`{}`), Version: 1},
	}}
	publicEncoded, err := yjs.EncodeBodyV1(publicBody)
	if err != nil {
		t.Fatalf("encode public-link body: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_nodes (document_id, node_id, parent_id, sibling_order, node_type, content, attributes, version) VALUES ($1, $2, NULL, 0, 'document', '', '{}', 1), ($1, $3, $2, 0, 'paragraph', '', '{}', 1), ($1, $4, $3, 0, 'run', $5, '{}', 1)`, publicDocumentID, publicRootID, publicParagraphID, publicRunID, publicBody.Nodes[2].Content); err != nil {
		t.Fatalf("insert public-link nodes: %v", err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE documents SET root_node_id = $2 WHERE id = $1`, publicDocumentID, publicRootID); err != nil {
		t.Fatalf("set public-link body root: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_collab_states (document_id, encoded_state, schema_version) VALUES ($1, $2, 1)`, publicDocumentID, publicEncoded); err != nil {
		t.Fatalf("insert public-link Yjs state: %v", err)
	}
	if _, err := repository.RebuildRAGIndex(ctx, publicDocumentID); err != nil {
		t.Fatalf("index public-link body: %v", err)
	}

	embedder := fakeRAGEmbeddingModel{}
	pending, err := repository.ListRAGChunksMissingEmbeddings(ctx, embedder.Provider(), embedder.Model(), 20)
	if err != nil {
		t.Fatalf("list RAG chunks missing embeddings: %v", err)
	}
	incomplete, err := repository.HasStaleReadableRAGIndex(ctx, workspaceID, actorID, nil, embedder.Provider(), embedder.Model())
	if err != nil || !incomplete {
		t.Fatalf("RAG coverage before embeddings = %v, error = %v, want incomplete", incomplete, err)
	}
	texts := make([]string, len(pending))
	for i, chunk := range pending {
		texts[i] = chunk.Text
	}
	vectors, err := embedder.Embed(ctx, texts)
	if err != nil {
		t.Fatalf("fake embed RAG chunks: %v", err)
	}
	embeddings := make([]documentrepo.RAGChunkEmbedding, len(pending))
	for i, chunk := range pending {
		embeddings[i] = documentrepo.RAGChunkEmbedding{
			ChunkID: chunk.ChunkID, DocumentID: chunk.DocumentID, BodyVersion: chunk.BodyVersion,
			SourceFingerprint: chunk.SourceFingerprint, Vector: vectors[i],
		}
	}
	if err := repository.StoreRAGChunkEmbeddings(ctx, embedder.Provider(), embedder.Model(), embeddings); err != nil {
		t.Fatalf("store RAG chunk embeddings: %v", err)
	}
	incomplete, err = repository.HasStaleReadableRAGIndex(ctx, workspaceID, actorID, nil, embedder.Provider(), embedder.Model())
	if err != nil || incomplete {
		t.Fatalf("RAG coverage after embeddings = %v, error = %v, want complete", incomplete, err)
	}

	modelCalls := 0
	modelHistories := make([][]string, 0)
	modelSourceInputs := make([][]string, 0)
	var beforeAnswer func() error
	app := container.New(databaseAccess, logger.New(), validator.New())
	app.RAGAnswerModel = fakeRAGAnswerModel{calls: &modelCalls, histories: &modelHistories, sourceInputs: &modelSourceInputs, beforeAnswer: &beforeAnswer}
	app.RAGEmbeddingModel = embedder
	api := InitRoutes(app, config.Config{JWTSecret: "rag-test-secret", AccessTokenTTL: time.Hour})
	user, err := jwtmanager.NewManager("rag-test-secret", time.Hour).Issue(model.AuthUser{
		ID: actorID, AccountNo: "rag-test-account", Email: fmt.Sprintf("rag-%s@example.invalid", actorID), Roles: []string{"member"},
	})
	if err != nil {
		t.Fatalf("issue test access token: %v", err)
	}
	request := func(method, path, body string, includeWorkspace bool) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		req.Header.Set("Authorization", "Bearer "+user.AccessToken)
		if includeWorkspace {
			req.Header.Set("X-Workspace-Id", workspaceID.String())
		}
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		recorder := httptest.NewRecorder()
		api.ServeHTTP(recorder, req)
		return recorder
	}
	publicBodyRequest := httptest.NewRequest(http.MethodGet, "/api/v1/public/documents/"+publicToken+"/body", nil)
	publicBodyResponse := httptest.NewRecorder()
	api.ServeHTTP(publicBodyResponse, publicBodyRequest)
	if publicBodyResponse.Code != http.StatusOK || !bytes.Contains(publicBodyResponse.Body.Bytes(), []byte(publicParagraphID.String())) || !bytes.Contains(publicBodyResponse.Body.Bytes(), []byte("The lunar archive is stored in vault 314.")) || bytes.Contains(publicBodyResponse.Body.Bytes(), []byte("encodedState")) {
		t.Fatalf("public body response = %d %s, want canonical body nodes without CRDT state", publicBodyResponse.Code, publicBodyResponse.Body.String())
	}

	created := request(http.MethodPost, "/api/v1/rag/conversations", "{}", true)
	if created.Code != http.StatusCreated {
		t.Fatalf("create conversation status = %d, body = %s", created.Code, created.Body.String())
	}
	var createEnvelope ragChatEnvelope
	if err := json.Unmarshal(created.Body.Bytes(), &createEnvelope); err != nil {
		t.Fatalf("decode conversation response: %v", err)
	}
	var conversation model.RAGConversation
	if err := json.Unmarshal(createEnvelope.Data, &conversation); err != nil || conversation.ID == uuid.Nil {
		t.Fatalf("conversation response = %+v, error = %v", conversation, err)
	}
	asked := request(http.MethodPost, "/api/v1/rag/conversations/"+conversation.ID.String()+"/messages", `{"question":"What happens after a failed health check?","language":"en"}`, true)
	if asked.Code != http.StatusOK {
		t.Fatalf("ask status = %d, body = %s", asked.Code, asked.Body.String())
	}
	var answerEnvelope ragChatEnvelope
	if err := json.Unmarshal(asked.Body.Bytes(), &answerEnvelope); err != nil {
		t.Fatalf("decode answer response: %v", err)
	}
	var answer appchat.Answer
	if err := json.Unmarshal(answerEnvelope.Data, &answer); err != nil {
		t.Fatalf("decode answer data: %v", err)
	}
	if answer.Text != "The source says: The service restarts after a failed health check." || len(answer.Citations) != 1 || answer.Citations[0].NodeID != paragraphID || answer.SourcesMayBeIncomplete || !bytes.Contains(answerEnvelope.Data, []byte(`"breadcrumb":"Operational checks"`)) {
		t.Fatalf("answer = %+v, want grounded answer with exact paragraph citation", answer)
	}
	if len(modelSourceInputs) == 0 {
		t.Fatal("RAG model received no evidence")
	}
	evidence := strings.Join(modelSourceInputs[0], " ")
	if !strings.Contains(evidence, "The service restarts after a failed health check.") || strings.Contains(evidence, "cobalt") {
		t.Fatalf("RAG model evidence = %v, want only the canonical paragraph and no pending suggestion text", modelSourceInputs)
	}

	// Exercise the winning side of the finalization/revocation race. The trigger
	// pauses the assistant INSERT after StoreRAGAnswer has acquired its access
	// locks; revocation must wait, then commit after the complete answer.
	raceConversationResponse := request(http.MethodPost, "/api/v1/rag/conversations", "{}", true)
	var raceConversationEnvelope ragChatEnvelope
	if raceConversationResponse.Code != http.StatusCreated || json.Unmarshal(raceConversationResponse.Body.Bytes(), &raceConversationEnvelope) != nil {
		t.Fatalf("create race conversation status = %d, body = %s", raceConversationResponse.Code, raceConversationResponse.Body.String())
	}
	var raceConversation model.RAGConversation
	if err := json.Unmarshal(raceConversationEnvelope.Data, &raceConversation); err != nil || raceConversation.ID == uuid.Nil {
		t.Fatalf("race conversation = %+v, error = %v", raceConversation, err)
	}
	for _, statement := range []string{
		`DROP TRIGGER IF EXISTS rag_test_pause_finalization ON rag_messages`,
		`DROP FUNCTION IF EXISTS rag_test_pause_finalization()`,
		`DROP SEQUENCE IF EXISTS rag_test_finalization_entered`,
		`CREATE SEQUENCE rag_test_finalization_entered`,
		`CREATE FUNCTION rag_test_pause_finalization() RETURNS trigger AS $$
			BEGIN
				IF NEW.role = 'assistant' AND NEW.conversation_id = TG_ARGV[0]::uuid THEN
					PERFORM nextval('rag_test_finalization_entered');
					PERFORM pg_sleep(2);
				END IF;
				RETURN NEW;
			END;
		$$ LANGUAGE plpgsql`,
		`CREATE TRIGGER rag_test_pause_finalization BEFORE INSERT ON rag_messages
			FOR EACH ROW EXECUTE FUNCTION rag_test_pause_finalization('` + raceConversation.ID.String() + `')`,
	} {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			t.Fatalf("prepare finalization race trigger: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DROP TRIGGER IF EXISTS rag_test_pause_finalization ON rag_messages`)
		_, _ = db.ExecContext(context.Background(), `DROP FUNCTION IF EXISTS rag_test_pause_finalization()`)
		_, _ = db.ExecContext(context.Background(), `DROP SEQUENCE IF EXISTS rag_test_finalization_entered`)
	})

	answerDone := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		answerDone <- request(http.MethodPost, "/api/v1/rag/conversations/"+raceConversation.ID.String()+"/messages", `{"question":"What happens after a failed health check?","language":"en"}`, true)
	}()
	triggerDeadline := time.Now().Add(5 * time.Second)
	triggerEntered := false
	for time.Now().Before(triggerDeadline) {
		var called bool
		if err := db.QueryRowContext(ctx, `SELECT is_called FROM rag_test_finalization_entered`).Scan(&called); err != nil {
			t.Fatalf("wait for finalization trigger: %v", err)
		}
		if called {
			triggerEntered = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !triggerEntered {
		t.Fatal("RAG finalization did not reach the pause trigger")
	}
	revokeConn, err := db.Conn(ctx)
	if err != nil {
		t.Fatalf("open workspace revoke connection: %v", err)
	}
	defer revokeConn.Close()
	var revokePID int
	if err := revokeConn.QueryRowContext(ctx, `SELECT pg_backend_pid()`).Scan(&revokePID); err != nil {
		t.Fatalf("read workspace revoke backend PID: %v", err)
	}
	revokeDone := make(chan error, 1)
	go func() {
		_, err := revokeConn.ExecContext(ctx, `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, workspaceID, actorID)
		revokeDone <- err
	}()
	lockDeadline := time.Now().Add(time.Second)
	revocationWaited := false
	for time.Now().Before(lockDeadline) {
		var state string
		var waitType sql.NullString
		if err := db.QueryRowContext(ctx, `SELECT state, wait_event_type FROM pg_stat_activity WHERE pid = $1`, revokePID).Scan(&state, &waitType); err != nil {
			t.Fatalf("inspect workspace revoke wait: %v", err)
		}
		if state == "active" && waitType.Valid && waitType.String == "Lock" {
			revocationWaited = true
			break
		}
		select {
		case err := <-revokeDone:
			t.Fatalf("workspace revocation completed before RAG finalization: %v", err)
		default:
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !revocationWaited {
		t.Fatal("workspace revocation did not wait for RAG finalization's access lock")
	}
	select {
	case raceAnswer := <-answerDone:
		if raceAnswer.Code != http.StatusOK {
			t.Fatalf("finalization that acquired access first returned %d: %s", raceAnswer.Code, raceAnswer.Body.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("RAG finalization did not finish")
	}
	if err := <-revokeDone; err != nil {
		t.Fatalf("revoke workspace access after RAG finalization: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`, workspaceID, actorID); err != nil {
		t.Fatalf("restore workspace membership after finalization race: %v", err)
	}
	if deleted := request(http.MethodDelete, "/api/v1/rag/conversations/"+raceConversation.ID.String(), "", false); deleted.Code != http.StatusNoContent {
		t.Fatalf("delete race conversation status = %d, body = %s", deleted.Code, deleted.Body.String())
	}
	if _, err := db.ExecContext(ctx, `DROP TRIGGER rag_test_pause_finalization ON rag_messages`); err != nil {
		t.Fatalf("remove finalization race trigger: %v", err)
	}

	followUp := request(http.MethodPost, "/api/v1/rag/conversations/"+conversation.ID.String()+"/messages", `{"question":"What about that?","language":"en"}`, true)
	if followUp.Code != http.StatusOK {
		t.Fatalf("contextual follow-up status = %d, body = %s", followUp.Code, followUp.Body.String())
	}
	var followUpEnvelope ragChatEnvelope
	if err := json.Unmarshal(followUp.Body.Bytes(), &followUpEnvelope); err != nil {
		t.Fatalf("decode contextual follow-up response: %v", err)
	}
	var contextualAnswer appchat.Answer
	if err := json.Unmarshal(followUpEnvelope.Data, &contextualAnswer); err != nil || len(contextualAnswer.Citations) != 1 || contextualAnswer.Citations[0].NodeID != paragraphID {
		t.Fatalf("contextual follow-up answer = %+v, error = %v, want the paragraph found through prior-question context", contextualAnswer, err)
	}
	translated := request(http.MethodPost, "/api/v1/rag/conversations/"+conversation.ID.String()+"/messages", `{"question":"Apa yang dilakukan layanan setelah pemeriksaan kesehatan gagal?","language":"id"}`, true)
	if translated.Code != http.StatusOK {
		t.Fatalf("cross-language ask status = %d, body = %s", translated.Code, translated.Body.String())
	}
	var translatedEnvelope ragChatEnvelope
	if err := json.Unmarshal(translated.Body.Bytes(), &translatedEnvelope); err != nil {
		t.Fatalf("decode cross-language answer: %v", err)
	}
	var translatedAnswer appchat.Answer
	if err := json.Unmarshal(translatedEnvelope.Data, &translatedAnswer); err != nil || len(translatedAnswer.Citations) != 1 || translatedAnswer.Citations[0].NodeID != paragraphID {
		t.Fatalf("cross-language answer = %+v, error = %v, want English paragraph citation", translatedAnswer, err)
	}
	conflictDocumentID, conflictRootID, conflictParagraphID, conflictRunID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	if _, err := db.ExecContext(ctx, `INSERT INTO documents (id, workspace_id, title, type, author_id, visibility) VALUES ($1, $2, 'Incident guide', 'markdown', $3, 'workspace')`, conflictDocumentID, workspaceID, actorID); err != nil {
		t.Fatalf("create conflicting source document: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'owner')`, conflictDocumentID, actorID); err != nil {
		t.Fatalf("add conflicting document owner grant: %v", err)
	}
	conflictBody := documentbody.Body{DocumentID: conflictDocumentID, RootNodeID: conflictRootID, Nodes: []documentbody.Node{
		{DocumentID: conflictDocumentID, NodeID: conflictRootID, Type: "document", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: conflictDocumentID, NodeID: conflictParagraphID, ParentID: &conflictRootID, SiblingOrder: 0, Type: "paragraph", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: conflictDocumentID, NodeID: conflictRunID, ParentID: &conflictParagraphID, Type: "run", Content: "The service never restarts after a failed health check.", Attributes: []byte(`{}`), Version: 1},
	}}
	conflictEncoded, err := yjs.EncodeBodyV1(conflictBody)
	if err != nil {
		t.Fatalf("encode conflicting source body: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_nodes (document_id, node_id, parent_id, sibling_order, node_type, content, attributes, version) VALUES ($1, $2, NULL, 0, 'document', '', '{}', 1), ($1, $3, $2, 0, 'paragraph', '', '{}', 1), ($1, $4, $3, 0, 'run', $5, '{}', 1)`, conflictDocumentID, conflictRootID, conflictParagraphID, conflictRunID, conflictBody.Nodes[2].Content); err != nil {
		t.Fatalf("insert conflicting source nodes: %v", err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE documents SET root_node_id = $2 WHERE id = $1`, conflictDocumentID, conflictRootID); err != nil {
		t.Fatalf("set conflicting source root: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_collab_states (document_id, encoded_state, schema_version) VALUES ($1, $2, 1)`, conflictDocumentID, conflictEncoded); err != nil {
		t.Fatalf("insert conflicting source Yjs state: %v", err)
	}
	if _, err := repository.RebuildRAGIndex(ctx, conflictDocumentID); err != nil {
		t.Fatalf("index conflicting source body: %v", err)
	}
	conflictChunks, err := repository.ListRAGChunksMissingEmbeddings(ctx, embedder.Provider(), embedder.Model(), 20)
	if err != nil || len(conflictChunks) == 0 {
		t.Fatalf("list conflict embeddings: %v", err)
	}
	conflictVectors, err := embedder.Embed(ctx, []string{conflictChunks[0].Text})
	if err != nil {
		t.Fatalf("embed conflicting source: %v", err)
	}
	if err := repository.StoreRAGChunkEmbeddings(ctx, embedder.Provider(), embedder.Model(), []documentrepo.RAGChunkEmbedding{{
		ChunkID: conflictChunks[0].ChunkID, DocumentID: conflictChunks[0].DocumentID,
		BodyVersion: conflictChunks[0].BodyVersion, SourceFingerprint: conflictChunks[0].SourceFingerprint,
		Vector: conflictVectors[0],
	}}); err != nil {
		t.Fatalf("store conflicting source embedding: %v", err)
	}
	conflictConversationResponse := request(http.MethodPost, "/api/v1/rag/conversations", "{}", true)
	if conflictConversationResponse.Code != http.StatusCreated {
		t.Fatalf("create conflict conversation status = %d, body = %s", conflictConversationResponse.Code, conflictConversationResponse.Body.String())
	}
	var conflictConversationEnvelope ragChatEnvelope
	if err := json.Unmarshal(conflictConversationResponse.Body.Bytes(), &conflictConversationEnvelope); err != nil {
		t.Fatalf("decode conflict conversation: %v", err)
	}
	var conflictConversation model.RAGConversation
	if err := json.Unmarshal(conflictConversationEnvelope.Data, &conflictConversation); err != nil || conflictConversation.ID == uuid.Nil {
		t.Fatalf("conflict conversation = %+v, error = %v", conflictConversation, err)
	}
	conflictResponse := request(http.MethodPost, "/api/v1/rag/conversations/"+conflictConversation.ID.String()+"/messages", `{"question":"Do the documents conflict about service restarts?","language":"en"}`, true)
	if conflictResponse.Code != http.StatusOK {
		t.Fatalf("conflict ask status = %d, body = %s", conflictResponse.Code, conflictResponse.Body.String())
	}
	var conflictEnvelope ragChatEnvelope
	if err := json.Unmarshal(conflictResponse.Body.Bytes(), &conflictEnvelope); err != nil {
		t.Fatalf("decode conflict answer: %v", err)
	}
	var conflictAnswer appchat.Answer
	if err := json.Unmarshal(conflictEnvelope.Data, &conflictAnswer); err != nil || !strings.Contains(strings.ToLower(conflictAnswer.Text), "conflict") || len(conflictAnswer.Citations) != 2 {
		t.Fatalf("conflict answer = %+v, error = %v, want explicit disagreement and both citations", conflictAnswer, err)
	}
	conflictCitationDocuments := map[uuid.UUID]bool{}
	for _, citation := range conflictAnswer.Citations {
		conflictCitationDocuments[citation.DocumentID] = true
	}
	if !conflictCitationDocuments[documentID] || !conflictCitationDocuments[conflictDocumentID] {
		t.Fatalf("conflict citations = %+v, want both conflicting documents", conflictAnswer.Citations)
	}
	conflictHistoryResponse := request(http.MethodGet, "/api/v1/rag/conversations/"+conflictConversation.ID.String(), "", false)
	var conflictHistoryEnvelope ragChatEnvelope
	if conflictHistoryResponse.Code != http.StatusOK || json.Unmarshal(conflictHistoryResponse.Body.Bytes(), &conflictHistoryEnvelope) != nil {
		t.Fatalf("read conflict history status = %d, body = %s", conflictHistoryResponse.Code, conflictHistoryResponse.Body.String())
	}
	var conflictHistory model.RAGConversationHistory
	if err := json.Unmarshal(conflictHistoryEnvelope.Data, &conflictHistory); err != nil || len(conflictHistory.Messages) != 2 || !strings.Contains(strings.ToLower(conflictHistory.Messages[1].Content), "conflict") || len(conflictHistory.Messages[1].Citations) != 2 {
		t.Fatalf("conflict history = %+v, error = %v, want original disagreement and both source citations", conflictHistory, err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE documents SET deleted_at = NOW() WHERE id = $1`, conflictDocumentID); err != nil {
		t.Fatalf("remove conflict fixture from later retrieval: %v", err)
	}
	linkConversationResponse := request(http.MethodPost, "/api/v1/rag/conversations", "{}", true)
	if linkConversationResponse.Code != http.StatusCreated {
		t.Fatalf("create public-link conversation status = %d, body = %s", linkConversationResponse.Code, linkConversationResponse.Body.String())
	}
	var linkConversationEnvelope ragChatEnvelope
	if err := json.Unmarshal(linkConversationResponse.Body.Bytes(), &linkConversationEnvelope); err != nil {
		t.Fatalf("decode public-link conversation response: %v", err)
	}
	var linkConversation model.RAGConversation
	if err := json.Unmarshal(linkConversationEnvelope.Data, &linkConversation); err != nil || linkConversation.ID == uuid.Nil {
		t.Fatalf("public-link conversation = %+v, error = %v", linkConversation, err)
	}
	beforeAnswer = func() error {
		_, err := db.ExecContext(ctx, `UPDATE documents SET share_token = 'rotated-public-link-token' WHERE id = $1`, publicDocumentID)
		return err
	}
	rotatedTokenAnswer := request(http.MethodPost, "/api/v1/rag/conversations/"+linkConversation.ID.String()+"/messages", `{"question":"Where is the lunar archive stored?","language":"en","publicLinkTokens":["`+publicToken+`"]}`, true)
	if rotatedTokenAnswer.Code != http.StatusForbidden {
		t.Fatalf("answer finalized after public-link token rotation: status = %d, body = %s, want 403", rotatedTokenAnswer.Code, rotatedTokenAnswer.Body.String())
	}
	if _, err := db.ExecContext(ctx, `UPDATE documents SET share_token = $2 WHERE id = $1`, publicDocumentID, publicToken); err != nil {
		t.Fatalf("restore public-link token after race check: %v", err)
	}
	var rotatedTokenMessages int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM rag_messages WHERE conversation_id = $1`, linkConversation.ID).Scan(&rotatedTokenMessages); err != nil || rotatedTokenMessages != 0 {
		t.Fatalf("messages after public-link token rotation = %d, error = %v, want no partial turn", rotatedTokenMessages, err)
	}
	linkQuestion := "Where is the lunar archive stored?"
	withoutProof := request(http.MethodPost, "/api/v1/rag/conversations/"+linkConversation.ID.String()+"/messages", `{"question":"Where is the lunar archive stored?","language":"en"}`, true)
	if withoutProof.Code != http.StatusOK {
		t.Fatalf("public-link ask without proof status = %d, body = %s", withoutProof.Code, withoutProof.Body.String())
	}
	var withoutProofEnvelope ragChatEnvelope
	if err := json.Unmarshal(withoutProof.Body.Bytes(), &withoutProofEnvelope); err != nil {
		t.Fatalf("decode public-link no-proof answer: %v", err)
	}
	var noProofAnswer appchat.Answer
	if err := json.Unmarshal(withoutProofEnvelope.Data, &noProofAnswer); err != nil || len(noProofAnswer.Citations) != 0 {
		t.Fatalf("public-link answer without token proof = %+v, error = %v, want no citation", noProofAnswer, err)
	}
	withProof := request(http.MethodPost, "/api/v1/rag/conversations/"+linkConversation.ID.String()+"/messages", `{"question":"Where is the lunar archive stored?","language":"en","publicLinkTokens":["`+publicToken+`"]}`, true)
	if withProof.Code != http.StatusOK {
		t.Fatalf("public-link ask with proof status = %d, body = %s", withProof.Code, withProof.Body.String())
	}
	var withProofEnvelope ragChatEnvelope
	if err := json.Unmarshal(withProof.Body.Bytes(), &withProofEnvelope); err != nil {
		t.Fatalf("decode public-link proof answer: %v", err)
	}
	var proofAnswer appchat.Answer
	if err := json.Unmarshal(withProofEnvelope.Data, &proofAnswer); err != nil || len(proofAnswer.Citations) != 1 || proofAnswer.Citations[0].NodeID != publicParagraphID {
		t.Fatalf("public-link answer with proof = %+v, error = %v, want exact public block citation", proofAnswer, err)
	}
	var tokenMessageCount int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM rag_messages WHERE conversation_id = $1 AND content LIKE '%' || $2 || '%'`, linkConversation.ID, publicToken).Scan(&tokenMessageCount); err != nil || tokenMessageCount != 0 {
		t.Fatalf("public token persisted in chat messages = %d, error = %v, want 0", tokenMessageCount, err)
	}

	noEvidence := request(http.MethodPost, "/api/v1/rag/conversations/"+conversation.ID.String()+"/messages", `{"question":"Which planet is nearest?","language":"en"}`, true)
	if noEvidence.Code != http.StatusOK {
		t.Fatalf("no-evidence ask status = %d, body = %s", noEvidence.Code, noEvidence.Body.String())
	}
	var noEvidenceEnvelope ragChatEnvelope
	if err := json.Unmarshal(noEvidence.Body.Bytes(), &noEvidenceEnvelope); err != nil {
		t.Fatalf("decode no-evidence response: %v", err)
	}
	var unsupported appchat.Answer
	if err := json.Unmarshal(noEvidenceEnvelope.Data, &unsupported); err != nil || len(unsupported.Citations) != 0 || unsupported.Text != "I couldn't find supporting information in the workspace documents." || unsupported.SourcesMayBeIncomplete {
		t.Fatalf("no-evidence answer = %+v, error = %v", unsupported, err)
	}
	beforeAnswer = func() error {
		_, err := db.ExecContext(ctx, `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, workspaceID, actorID)
		return err
	}
	revokedDuringAnswer := request(http.MethodPost, "/api/v1/rag/conversations/"+conversation.ID.String()+"/messages", `{"question":"What happens after a failed health check?","language":"en"}`, true)
	if revokedDuringAnswer.Code != http.StatusForbidden {
		t.Fatalf("answer finalized after workspace access was revoked during model call: status = %d, body = %s, want 403", revokedDuringAnswer.Code, revokedDuringAnswer.Body.String())
	}
	var unfinalizedMessages int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM rag_messages WHERE conversation_id = $1`, conversation.ID).Scan(&unfinalizedMessages); err != nil || unfinalizedMessages != 8 {
		t.Fatalf("messages after access-revoked answer = %d, error = %v, want no partial turn", unfinalizedMessages, err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`, workspaceID, actorID); err != nil {
		t.Fatalf("restore workspace membership after access-revocation check: %v", err)
	}

	beforeAnswer = func() error {
		_, err := db.ExecContext(ctx, `UPDATE documents SET body_version = body_version + 1 WHERE id = $1`, documentID)
		return err
	}
	concurrentEdit := request(http.MethodPost, "/api/v1/rag/conversations/"+conversation.ID.String()+"/messages", `{"question":"What happens after a failed health check?","language":"en"}`, true)
	if concurrentEdit.Code != http.StatusConflict {
		t.Fatalf("answer finalized after source changed during model call: status = %d, body = %s, want 409", concurrentEdit.Code, concurrentEdit.Body.String())
	}
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM rag_messages WHERE conversation_id = $1`, conversation.ID).Scan(&unfinalizedMessages); err != nil || unfinalizedMessages != 8 {
		t.Fatalf("messages after conflicted answer = %d, error = %v, want no persisted partial turn", unfinalizedMessages, err)
	}
	stale := request(http.MethodPost, "/api/v1/rag/conversations/"+conversation.ID.String()+"/messages", `{"question":"What happens after a failed health check?","language":"en"}`, true)
	if stale.Code != http.StatusOK {
		t.Fatalf("stale-source ask status = %d, body = %s", stale.Code, stale.Body.String())
	}
	var staleEnvelope ragChatEnvelope
	if err := json.Unmarshal(stale.Body.Bytes(), &staleEnvelope); err != nil {
		t.Fatalf("decode stale-source response: %v", err)
	}
	var staleAnswer appchat.Answer
	if err := json.Unmarshal(staleEnvelope.Data, &staleAnswer); err != nil || len(staleAnswer.Citations) != 0 || staleAnswer.Text != unsupported.Text || !staleAnswer.SourcesMayBeIncomplete {
		t.Fatalf("stale-source answer = %+v, error = %v", staleAnswer, err)
	}
	if modelCalls != 9 || len(modelHistories) != 9 || len(modelHistories[0]) != 0 || len(modelHistories[1]) != 0 || len(modelHistories[2]) != 1 || modelHistories[2][0] != "What happens after a failed health check?" || len(modelHistories[3]) != 2 || modelHistories[3][0] != "What happens after a failed health check?" || len(modelHistories[4]) != 0 || len(modelHistories[5]) != 0 || len(modelHistories[6]) != 1 || modelHistories[6][0] != linkQuestion || len(modelHistories[7]) != 4 || len(modelHistories[8]) != 4 || modelHistories[7][2] != "Apa yang dilakukan layanan setelah pemeriksaan kesehatan gagal?" || modelHistories[7][3] != "Which planet is nearest?" {
		t.Fatalf("fake model calls/history = %d/%v, want prior user questions only and no historical answer evidence", modelCalls, modelHistories)
	}

	opaqueDocumentID, opaqueRootID, paragraphID2, runID2, opaqueInlineID, opaqueNodeID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	if _, err := db.ExecContext(ctx, `INSERT INTO documents (id, workspace_id, title, type, author_id, visibility) VALUES ($1, $2, 'Opaque coverage fixture', 'markdown', $3, 'workspace')`, opaqueDocumentID, workspaceID, actorID); err != nil {
		t.Fatalf("create opaque coverage fixture: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'owner')`, opaqueDocumentID, actorID); err != nil {
		t.Fatalf("grant opaque fixture ownership: %v", err)
	}
	opaqueMarker := "rareopalquartz99173"
	opaqueInlineMarker := "rareopalinline48102"
	opaqueBody := documentbody.Body{DocumentID: opaqueDocumentID, RootNodeID: opaqueRootID, Nodes: []documentbody.Node{
		{DocumentID: opaqueDocumentID, NodeID: opaqueRootID, Type: "document", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: opaqueDocumentID, NodeID: paragraphID2, ParentID: &opaqueRootID, SiblingOrder: 0, Type: "paragraph", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: opaqueDocumentID, NodeID: runID2, ParentID: &paragraphID2, Type: "run", Content: "The quartz valve opens after two minutes of cooling.", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: opaqueDocumentID, NodeID: opaqueInlineID, ParentID: &paragraphID2, SiblingOrder: 1, Type: "opaque-inline", Content: opaqueInlineMarker, Attributes: []byte(`{}`), Version: 1},
		{DocumentID: opaqueDocumentID, NodeID: opaqueNodeID, ParentID: &opaqueRootID, SiblingOrder: 1, Type: "opaque", Content: "Unsupported syntax: " + opaqueMarker, Attributes: []byte(`{}`), Version: 1},
	}}
	opaqueEncoded, err := yjs.EncodeBodyV1(opaqueBody)
	if err != nil {
		t.Fatalf("encode opaque coverage body: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_nodes (document_id, node_id, parent_id, sibling_order, node_type, content, attributes, version) VALUES ($1, $2, NULL, 0, 'document', '', '{}', 1), ($1, $3, $2, 0, 'paragraph', '', '{}', 1), ($1, $4, $3, 0, 'run', $5, '{}', 1), ($1, $6, $3, 1, 'opaque-inline', $7, '{}', 1), ($1, $8, $2, 1, 'opaque', $9, '{}', 1)`, opaqueDocumentID, opaqueRootID, paragraphID2, runID2, opaqueBody.Nodes[2].Content, opaqueInlineID, opaqueBody.Nodes[3].Content, opaqueNodeID, opaqueBody.Nodes[4].Content); err != nil {
		t.Fatalf("insert opaque coverage nodes: %v", err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE documents SET root_node_id = $2 WHERE id = $1`, opaqueDocumentID, opaqueRootID); err != nil {
		t.Fatalf("set opaque coverage body root: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_collab_states (document_id, encoded_state, schema_version) VALUES ($1, $2, 1)`, opaqueDocumentID, opaqueEncoded); err != nil {
		t.Fatalf("insert opaque coverage Yjs state: %v", err)
	}
	if _, err := repository.RebuildRAGIndex(ctx, opaqueDocumentID); err != nil {
		t.Fatalf("index opaque coverage body: %v", err)
	}
	var coverageStatus string
	var skippedNodeCount int
	if err := db.QueryRowContext(ctx, `SELECT coverage_status, skipped_node_count FROM rag_document_indexes WHERE document_id = $1`, opaqueDocumentID).Scan(&coverageStatus, &skippedNodeCount); err != nil || coverageStatus != "partial" || skippedNodeCount != 2 {
		t.Fatalf("opaque coverage = %q/%d, error = %v, want partial with two skipped nodes", coverageStatus, skippedNodeCount, err)
	}
	opaqueConversationResponse := request(http.MethodPost, "/api/v1/rag/conversations", "{}", true)
	var opaqueConversationEnvelope ragChatEnvelope
	if opaqueConversationResponse.Code != http.StatusCreated || json.Unmarshal(opaqueConversationResponse.Body.Bytes(), &opaqueConversationEnvelope) != nil {
		t.Fatalf("create opaque coverage conversation status = %d, body = %s", opaqueConversationResponse.Code, opaqueConversationResponse.Body.String())
	}
	var opaqueConversation model.RAGConversation
	if err := json.Unmarshal(opaqueConversationEnvelope.Data, &opaqueConversation); err != nil || opaqueConversation.ID == uuid.Nil {
		t.Fatalf("opaque coverage conversation = %+v, error = %v", opaqueConversation, err)
	}
	opaqueAnswerResponse := request(http.MethodPost, "/api/v1/rag/conversations/"+opaqueConversation.ID.String()+"/messages", `{"question":"When does the quartz valve open?","language":"en"}`, true)
	var opaqueAnswerEnvelope ragChatEnvelope
	var opaqueAnswer appchat.Answer
	if opaqueAnswerResponse.Code != http.StatusOK || json.Unmarshal(opaqueAnswerResponse.Body.Bytes(), &opaqueAnswerEnvelope) != nil || json.Unmarshal(opaqueAnswerEnvelope.Data, &opaqueAnswer) != nil || !opaqueAnswer.CoveragePartial || len(opaqueAnswer.Citations) != 1 || opaqueAnswer.Citations[0].NodeID != paragraphID2 || strings.Contains(opaqueAnswer.Text, opaqueMarker) {
		t.Fatalf("answer with opaque source = %+v, status = %d, body = %s, want partial coverage and only the renderable paragraph", opaqueAnswer, opaqueAnswerResponse.Code, opaqueAnswerResponse.Body.String())
	}
	modelCallsBeforeOpaqueSearch := modelCalls
	opaqueOnlyResponse := request(http.MethodPost, "/api/v1/rag/conversations/"+opaqueConversation.ID.String()+"/messages", `{"question":"Find `+opaqueMarker+" "+opaqueInlineMarker+`","language":"en"}`, true)
	var opaqueOnlyEnvelope ragChatEnvelope
	var opaqueOnlyAnswer appchat.Answer
	if opaqueOnlyResponse.Code != http.StatusOK || json.Unmarshal(opaqueOnlyResponse.Body.Bytes(), &opaqueOnlyEnvelope) != nil || json.Unmarshal(opaqueOnlyEnvelope.Data, &opaqueOnlyAnswer) != nil || len(opaqueOnlyAnswer.Citations) != 0 || opaqueOnlyAnswer.Text != "I couldn't find supporting information in the workspace documents." || modelCalls != modelCallsBeforeOpaqueSearch {
		t.Fatalf("opaque-only answer = %+v, status = %d, model calls = %d (before %d), body = %s, want no answer evidence and no model call", opaqueOnlyAnswer, opaqueOnlyResponse.Code, modelCalls, modelCallsBeforeOpaqueSearch, opaqueOnlyResponse.Body.String())
	}
	if deleted := request(http.MethodDelete, "/api/v1/rag/conversations/"+opaqueConversation.ID.String(), "", false); deleted.Code != http.StatusNoContent {
		t.Fatalf("delete opaque coverage conversation status = %d, body = %s", deleted.Code, deleted.Body.String())
	}

	if _, err := db.ExecContext(ctx, `UPDATE documents SET visibility = 'inherit', share_token = NULL, is_draft = FALSE WHERE id = $1`, publicDocumentID); err != nil {
		t.Fatalf("make source inherit workspace visibility: %v", err)
	}
	if _, err := db.ExecContext(ctx, `DELETE FROM document_accesses WHERE document_id = $1 AND user_id = $2`, publicDocumentID, actorID); err != nil {
		t.Fatalf("remove direct source grant: %v", err)
	}
	privateProjectDenied := request(http.MethodPost, "/api/v1/rag/conversations/"+linkConversation.ID.String()+"/messages", `{"question":"Where is the lunar archive stored?","language":"en"}`, true)
	var privateProjectDeniedEnvelope ragChatEnvelope
	var privateProjectDeniedAnswer appchat.Answer
	if privateProjectDenied.Code != http.StatusOK || json.Unmarshal(privateProjectDenied.Body.Bytes(), &privateProjectDeniedEnvelope) != nil || json.Unmarshal(privateProjectDeniedEnvelope.Data, &privateProjectDeniedAnswer) != nil || len(privateProjectDeniedAnswer.Citations) != 0 || privateProjectDeniedAnswer.Text != "I couldn't find supporting information in the workspace documents." {
		t.Fatalf("inherit source in private project without membership or grant = %+v, status = %d, body = %s, want no evidence", privateProjectDeniedAnswer, privateProjectDenied.Code, privateProjectDenied.Body.String())
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'viewer')`, publicProjectID, actorID); err != nil {
		t.Fatalf("grant private project viewer access: %v", err)
	}
	privateProjectMember := request(http.MethodPost, "/api/v1/rag/conversations/"+linkConversation.ID.String()+"/messages", `{"question":"Where is the lunar archive stored?","language":"en"}`, true)
	var privateProjectMemberEnvelope ragChatEnvelope
	var privateProjectMemberAnswer appchat.Answer
	if privateProjectMember.Code != http.StatusOK || json.Unmarshal(privateProjectMember.Body.Bytes(), &privateProjectMemberEnvelope) != nil || json.Unmarshal(privateProjectMemberEnvelope.Data, &privateProjectMemberAnswer) != nil || len(privateProjectMemberAnswer.Citations) != 1 || privateProjectMemberAnswer.Citations[0].DocumentID != publicDocumentID {
		t.Fatalf("inherit source for private-project viewer = %+v, status = %d, body = %s, want its cited block", privateProjectMemberAnswer, privateProjectMember.Code, privateProjectMember.Body.String())
	}
	if _, err := db.ExecContext(ctx, `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, publicProjectID, actorID); err != nil {
		t.Fatalf("remove private project membership: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'view')`, publicDocumentID, actorID); err != nil {
		t.Fatalf("grant direct read to private-project source: %v", err)
	}
	privateProjectGrant := request(http.MethodPost, "/api/v1/rag/conversations/"+linkConversation.ID.String()+"/messages", `{"question":"Where is the lunar archive stored?","language":"en"}`, true)
	var privateProjectGrantEnvelope ragChatEnvelope
	var privateProjectGrantAnswer appchat.Answer
	if privateProjectGrant.Code != http.StatusOK || json.Unmarshal(privateProjectGrant.Body.Bytes(), &privateProjectGrantEnvelope) != nil || json.Unmarshal(privateProjectGrantEnvelope.Data, &privateProjectGrantAnswer) != nil || len(privateProjectGrantAnswer.Citations) != 1 || privateProjectGrantAnswer.Citations[0].DocumentID != publicDocumentID {
		t.Fatalf("direct grant to inherit source in private project = %+v, status = %d, body = %s, want its cited block", privateProjectGrantAnswer, privateProjectGrant.Code, privateProjectGrant.Body.String())
	}
	var messagesBeforeGrantRevoke int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM rag_messages WHERE conversation_id = $1`, linkConversation.ID).Scan(&messagesBeforeGrantRevoke); err != nil {
		t.Fatalf("count messages before direct-grant revocation race: %v", err)
	}
	beforeAnswer = func() error {
		_, err := db.ExecContext(ctx, `DELETE FROM document_accesses WHERE document_id = $1 AND user_id = $2`, publicDocumentID, actorID)
		return err
	}
	grantRevokedDuringAnswer := request(http.MethodPost, "/api/v1/rag/conversations/"+linkConversation.ID.String()+"/messages", `{"question":"Where is the lunar archive stored?","language":"en"}`, true)
	if grantRevokedDuringAnswer.Code != http.StatusForbidden {
		t.Fatalf("answer finalized after its direct source grant was revoked: status = %d, body = %s, want 403", grantRevokedDuringAnswer.Code, grantRevokedDuringAnswer.Body.String())
	}
	var messagesAfterGrantRevoke int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM rag_messages WHERE conversation_id = $1`, linkConversation.ID).Scan(&messagesAfterGrantRevoke); err != nil || messagesAfterGrantRevoke != messagesBeforeGrantRevoke {
		t.Fatalf("messages after direct-grant revocation race = %d, error = %v, want unchanged count %d", messagesAfterGrantRevoke, err, messagesBeforeGrantRevoke)
	}
	if _, err := db.ExecContext(ctx, `DELETE FROM document_accesses WHERE document_id = $1 AND user_id = $2`, publicDocumentID, actorID); err != nil {
		t.Fatalf("remove private-project source grant before explicit visibility check: %v", err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE documents SET visibility = 'workspace' WHERE id = $1`, publicDocumentID); err != nil {
		t.Fatalf("make private-project source explicitly workspace-visible: %v", err)
	}
	explicitWorkspaceAnswer := request(http.MethodPost, "/api/v1/rag/conversations/"+linkConversation.ID.String()+"/messages", `{"question":"Where is the lunar archive stored?","language":"en"}`, true)
	var explicitWorkspaceEnvelope ragChatEnvelope
	var explicitWorkspaceAnswerData appchat.Answer
	if explicitWorkspaceAnswer.Code != http.StatusOK || json.Unmarshal(explicitWorkspaceAnswer.Body.Bytes(), &explicitWorkspaceEnvelope) != nil || json.Unmarshal(explicitWorkspaceEnvelope.Data, &explicitWorkspaceAnswerData) != nil || len(explicitWorkspaceAnswerData.Citations) != 1 || explicitWorkspaceAnswerData.Citations[0].DocumentID != publicDocumentID {
		t.Fatalf("workspace-visible source in private project = %+v, status = %d, body = %s, want its cited block", explicitWorkspaceAnswerData, explicitWorkspaceAnswer.Code, explicitWorkspaceAnswer.Body.String())
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'view')`, publicDocumentID, actorID); err != nil {
		t.Fatalf("restore source view grant: %v", err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE documents SET visibility = 'private', share_token = NULL, is_draft = FALSE WHERE id = $1`, publicDocumentID); err != nil {
		t.Fatalf("make direct-grant source private: %v", err)
	}
	privateGrantAnswer := request(http.MethodPost, "/api/v1/rag/conversations/"+linkConversation.ID.String()+"/messages", `{"question":"Where is the lunar archive stored?","language":"en"}`, true)
	var privateGrantEnvelope ragChatEnvelope
	var privateGrantAnswerData appchat.Answer
	if privateGrantAnswer.Code != http.StatusOK || json.Unmarshal(privateGrantAnswer.Body.Bytes(), &privateGrantEnvelope) != nil || json.Unmarshal(privateGrantEnvelope.Data, &privateGrantAnswerData) != nil || len(privateGrantAnswerData.Citations) != 1 || privateGrantAnswerData.Citations[0].DocumentID != publicDocumentID {
		t.Fatalf("direct view grant on private source answer = %+v, status = %d, body = %s, want its cited block without a public-link token", privateGrantAnswerData, privateGrantAnswer.Code, privateGrantAnswer.Body.String())
	}
	if _, err := db.ExecContext(ctx, `DELETE FROM document_accesses WHERE document_id = $1 AND user_id = $2`, publicDocumentID, actorID); err != nil {
		t.Fatalf("revoke direct source read grant: %v", err)
	}
	revokedGrantHistoryResponse := request(http.MethodGet, "/api/v1/rag/conversations/"+linkConversation.ID.String(), "", false)
	var revokedGrantHistoryEnvelope ragChatEnvelope
	var revokedGrantHistory model.RAGConversationHistory
	if revokedGrantHistoryResponse.Code != http.StatusOK || json.Unmarshal(revokedGrantHistoryResponse.Body.Bytes(), &revokedGrantHistoryEnvelope) != nil || json.Unmarshal(revokedGrantHistoryEnvelope.Data, &revokedGrantHistory) != nil {
		t.Fatalf("history after source grant revocation status = %d, body = %s", revokedGrantHistoryResponse.Code, revokedGrantHistoryResponse.Body.String())
	}
	historicalSourceAnswerVisible := false
	for _, message := range revokedGrantHistory.Messages {
		if message.Role != "assistant" || !strings.Contains(message.Content, "The lunar archive is stored in vault 314.") {
			continue
		}
		for _, citation := range message.Citations {
			if citation.DocumentID == publicDocumentID && citation.NodeID == publicParagraphID {
				historicalSourceAnswerVisible = true
			}
		}
	}
	if !historicalSourceAnswerVisible {
		t.Fatalf("history after source grant revocation = %+v, want original answer and citation to remain visible", revokedGrantHistory)
	}
	modelCallsBeforeRevokedGrantAsk := modelCalls
	revokedGrantAnswer := request(http.MethodPost, "/api/v1/rag/conversations/"+linkConversation.ID.String()+"/messages", `{"question":"Where is the lunar archive stored?","language":"en"}`, true)
	var revokedGrantAnswerEnvelope ragChatEnvelope
	var revokedGrantAnswerData appchat.Answer
	if revokedGrantAnswer.Code != http.StatusOK || json.Unmarshal(revokedGrantAnswer.Body.Bytes(), &revokedGrantAnswerEnvelope) != nil || json.Unmarshal(revokedGrantAnswerEnvelope.Data, &revokedGrantAnswerData) != nil || len(revokedGrantAnswerData.Citations) != 0 || revokedGrantAnswerData.Text != "I couldn't find supporting information in the workspace documents." || modelCalls != modelCallsBeforeRevokedGrantAsk {
		t.Fatalf("new answer after source grant revocation = %+v, status = %d, model calls = %d (before %d), body = %s, want no citation and no model call", revokedGrantAnswerData, revokedGrantAnswer.Code, modelCalls, modelCallsBeforeRevokedGrantAsk, revokedGrantAnswer.Body.String())
	}
	if _, err := db.ExecContext(ctx, `UPDATE documents SET is_draft = TRUE WHERE id = $1`, publicDocumentID); err != nil {
		t.Fatalf("make direct-view source a draft: %v", err)
	}
	draftViewAnswer := request(http.MethodPost, "/api/v1/rag/conversations/"+linkConversation.ID.String()+"/messages", `{"question":"Where is the lunar archive stored?","language":"en"}`, true)
	var draftViewEnvelope ragChatEnvelope
	var draftViewAnswerData appchat.Answer
	if draftViewAnswer.Code != http.StatusOK || json.Unmarshal(draftViewAnswer.Body.Bytes(), &draftViewEnvelope) != nil || json.Unmarshal(draftViewEnvelope.Data, &draftViewAnswerData) != nil || len(draftViewAnswerData.Citations) != 0 || draftViewAnswerData.Text != "I couldn't find supporting information in the workspace documents." {
		t.Fatalf("direct view grant on private draft answer = %+v, status = %d, body = %s, want no evidence", draftViewAnswerData, draftViewAnswer.Code, draftViewAnswer.Body.String())
	}
	if _, err := db.ExecContext(ctx, `UPDATE workspace_members SET role = 'admin' WHERE workspace_id = $1 AND user_id = $2`, workspaceID, actorID); err != nil {
		t.Fatalf("make actor workspace admin for draft read: %v", err)
	}
	adminDraftAnswer := request(http.MethodPost, "/api/v1/rag/conversations/"+linkConversation.ID.String()+"/messages", `{"question":"Where is the lunar archive stored?","language":"en"}`, true)
	var adminDraftEnvelope ragChatEnvelope
	var adminDraftAnswerData appchat.Answer
	if adminDraftAnswer.Code != http.StatusOK || json.Unmarshal(adminDraftAnswer.Body.Bytes(), &adminDraftEnvelope) != nil || json.Unmarshal(adminDraftEnvelope.Data, &adminDraftAnswerData) != nil || len(adminDraftAnswerData.Citations) != 1 || adminDraftAnswerData.Citations[0].DocumentID != publicDocumentID {
		t.Fatalf("workspace admin private-draft answer = %+v, status = %d, body = %s, want its cited block", adminDraftAnswerData, adminDraftAnswer.Code, adminDraftAnswer.Body.String())
	}
	if _, err := db.ExecContext(ctx, `UPDATE workspace_members SET role = 'member' WHERE workspace_id = $1 AND user_id = $2`, workspaceID, actorID); err != nil {
		t.Fatalf("restore actor workspace member role: %v", err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE documents SET visibility = 'public_link', share_token = $2, is_draft = FALSE WHERE id = $1`, publicDocumentID, publicToken); err != nil {
		t.Fatalf("restore public-link source before deletion-race check: %v", err)
	}
	var messagesBeforeHardDeleteRace int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM rag_messages WHERE conversation_id = $1`, linkConversation.ID).Scan(&messagesBeforeHardDeleteRace); err != nil {
		t.Fatalf("count public-link conversation messages before hard-delete race: %v", err)
	}
	beforeAnswer = func() error {
		result, err := db.ExecContext(ctx, `DELETE FROM documents WHERE id = $1`, publicDocumentID)
		if err != nil {
			return err
		}
		deleted, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if deleted != 1 {
			return fmt.Errorf("hard-delete race removed %d source documents, want 1", deleted)
		}
		return nil
	}
	hardDeleteRace := request(http.MethodPost, "/api/v1/rag/conversations/"+linkConversation.ID.String()+"/messages", `{"question":"Where is the lunar archive stored?","language":"en","publicLinkTokens":["`+publicToken+`"]}`, true)
	if hardDeleteRace.Code != http.StatusNotFound {
		t.Fatalf("answer finalized after source hard-delete: status = %d, body = %s, want 404", hardDeleteRace.Code, hardDeleteRace.Body.String())
	}
	var messagesAfterHardDeleteRace int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM rag_messages WHERE conversation_id = $1`, linkConversation.ID).Scan(&messagesAfterHardDeleteRace); err != nil || messagesAfterHardDeleteRace != messagesBeforeHardDeleteRace {
		t.Fatalf("messages after source hard-delete race = %d, error = %v, want unchanged count %d", messagesAfterHardDeleteRace, err, messagesBeforeHardDeleteRace)
	}

	historyResponse := request(http.MethodGet, "/api/v1/rag/conversations/"+conversation.ID.String(), "", false)
	if historyResponse.Code != http.StatusOK {
		t.Fatalf("history status = %d, body = %s", historyResponse.Code, historyResponse.Body.String())
	}
	var historyEnvelope ragChatEnvelope
	if err := json.Unmarshal(historyResponse.Body.Bytes(), &historyEnvelope); err != nil {
		t.Fatalf("decode history response: %v", err)
	}
	var history model.RAGConversationHistory
	if err := json.Unmarshal(historyEnvelope.Data, &history); err != nil || len(history.Messages) != 10 || history.Messages[0].Role != "user" || history.Messages[1].Role != "assistant" || len(history.Messages[1].Citations) != 1 || history.Messages[1].Citations[0].SourceFingerprint == "" || !bytes.Contains(historyEnvelope.Data, []byte(`"breadcrumb":"Operational checks"`)) {
		t.Fatalf("history = %+v, error = %v, want ordered Q+A pairs with original citation fingerprint", history, err)
	}
	var storedStatus struct {
		Messages []struct {
			Role                   string `json:"role"`
			SourcesMayBeIncomplete bool   `json:"sourcesMayBeIncomplete"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(historyEnvelope.Data, &storedStatus); err != nil || len(storedStatus.Messages) != 10 || !storedStatus.Messages[9].SourcesMayBeIncomplete {
		t.Fatalf("stored RAG message status = %+v, error = %v, want stale-index warning retained in history", storedStatus, err)
	}
	var storedCitation struct {
		Messages []struct {
			Citations []struct {
				DocumentTitle string `json:"documentTitle"`
				ProjectName   string `json:"projectName"`
				SourceChanged bool   `json:"sourceChanged"`
			} `json:"citations"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(historyEnvelope.Data, &storedCitation); err != nil || len(storedCitation.Messages) <= 1 || len(storedCitation.Messages[1].Citations) != 1 || storedCitation.Messages[1].Citations[0].DocumentTitle != "Operations runbook" || !storedCitation.Messages[1].Citations[0].SourceChanged {
		t.Fatalf("stored RAG citation = %+v, error = %v, want readable title and changed-source marker", storedCitation, err)
	}
	trashedSource := request(http.MethodDelete, "/api/v1/documents/"+documentID.String(), "", true)
	if trashedSource.Code != http.StatusOK {
		t.Fatalf("move cited source to trash status = %d, body = %s", trashedSource.Code, trashedSource.Body.String())
	}
	dbmlID, mermaidID := uuid.New(), uuid.New()
	dbmlMarker, mermaidMarker := "legacydbmlquantum3007", "legacymermaidquantum8812"
	if _, err := db.ExecContext(ctx, `INSERT INTO documents (id, workspace_id, title, type, content, author_id, visibility) VALUES ($1, $2, 'Legacy DBML', 'dbdiagram', $3, $4, 'workspace'), ($5, $2, 'Legacy Mermaid', 'mermaid', $6, $4, 'workspace')`, dbmlID, workspaceID, dbmlMarker, actorID, mermaidID, mermaidMarker); err != nil {
		t.Fatalf("create non-Markdown RAG exclusion fixtures: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $3, 'owner'), ($2, $3, 'owner')`, dbmlID, mermaidID, actorID); err != nil {
		t.Fatalf("grant non-Markdown fixture ownership: %v", err)
	}
	exclusionConversationResponse := request(http.MethodPost, "/api/v1/rag/conversations", "{}", true)
	var exclusionConversationEnvelope ragChatEnvelope
	if exclusionConversationResponse.Code != http.StatusCreated || json.Unmarshal(exclusionConversationResponse.Body.Bytes(), &exclusionConversationEnvelope) != nil {
		t.Fatalf("create exclusion conversation status = %d, body = %s", exclusionConversationResponse.Code, exclusionConversationResponse.Body.String())
	}
	var exclusionConversation model.RAGConversation
	if err := json.Unmarshal(exclusionConversationEnvelope.Data, &exclusionConversation); err != nil || exclusionConversation.ID == uuid.Nil {
		t.Fatalf("exclusion conversation = %+v, error = %v", exclusionConversation, err)
	}
	modelCallsBeforeExclusions := modelCalls
	for _, question := range []string{
		"What happens after a failed health check?",
		"Find " + dbmlMarker + " " + mermaidMarker,
	} {
		response := request(http.MethodPost, "/api/v1/rag/conversations/"+exclusionConversation.ID.String()+"/messages", `{"question":"`+question+`","language":"en"}`, true)
		var envelope ragChatEnvelope
		var answer appchat.Answer
		if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &envelope) != nil || json.Unmarshal(envelope.Data, &answer) != nil || len(answer.Citations) != 0 || answer.Text != "I couldn't find supporting information in the workspace documents." {
			t.Fatalf("excluded-source answer for %q = %+v, status = %d, body = %s, want no evidence", question, answer, response.Code, response.Body.String())
		}
	}
	if modelCalls != modelCallsBeforeExclusions {
		t.Fatalf("fake model calls after trash/DBML/Mermaid-only queries = %d, want unchanged at %d", modelCalls, modelCallsBeforeExclusions)
	}
	if deleted := request(http.MethodDelete, "/api/v1/rag/conversations/"+exclusionConversation.ID.String(), "", false); deleted.Code != http.StatusNoContent {
		t.Fatalf("delete exclusion conversation status = %d, body = %s", deleted.Code, deleted.Body.String())
	}
	deletedSource := request(http.MethodDelete, "/api/v1/documents/"+documentID.String()+"/permanent", "", true)
	if deletedSource.Code != http.StatusOK {
		t.Fatalf("permanently delete cited source status = %d, body = %s", deletedSource.Code, deletedSource.Body.String())
	}
	var sourceRows, citationRows int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM documents WHERE id = $1`, documentID).Scan(&sourceRows); err != nil {
		t.Fatalf("check hard-deleted document: %v", err)
	}
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM rag_message_citations WHERE document_id = $1`, documentID).Scan(&citationRows); err != nil {
		t.Fatalf("check deleted document citations: %v", err)
	}
	if sourceRows != 0 || citationRows != 0 {
		t.Fatalf("hard delete rows: source=%d citations=%d for document %s", sourceRows, citationRows, documentID)
	}
	historyResponse = request(http.MethodGet, "/api/v1/rag/conversations/"+conversation.ID.String(), "", false)
	if historyResponse.Code != http.StatusOK {
		t.Fatalf("read post-delete history status = %d, body = %s", historyResponse.Code, historyResponse.Body.String())
	}
	historyEnvelope = ragChatEnvelope{}
	if err := json.Unmarshal(historyResponse.Body.Bytes(), &historyEnvelope); err != nil {
		t.Fatalf("decode post-delete history: %v", err)
	}
	history = model.RAGConversationHistory{}
	if err := json.Unmarshal(historyEnvelope.Data, &history); err != nil || len(history.Messages) != 10 || !bytes.Contains([]byte(history.Messages[1].Content), []byte("service restarts after a failed health check")) || len(history.Messages[1].Citations) != 0 {
		t.Fatalf("history after source deletion = %+v, error = %v, want answer text retained and its source citation removed", history, err)
	}
	inheritedDocumentID, inheritedRootID, inheritedParagraphID, inheritedRunID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	if _, err := db.ExecContext(ctx, `INSERT INTO documents (id, workspace_id, title, type, author_id, visibility) VALUES ($1, $2, 'Workspace handbook', 'markdown', $3, 'inherit')`, inheritedDocumentID, workspaceID, otherUserID); err != nil {
		t.Fatalf("create no-project inherited source document: %v", err)
	}
	inheritedBody := documentbody.Body{DocumentID: inheritedDocumentID, RootNodeID: inheritedRootID, Nodes: []documentbody.Node{
		{DocumentID: inheritedDocumentID, NodeID: inheritedRootID, Type: "document", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: inheritedDocumentID, NodeID: inheritedParagraphID, ParentID: &inheritedRootID, Type: "paragraph", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: inheritedDocumentID, NodeID: inheritedRunID, ParentID: &inheritedParagraphID, Type: "run", Content: "The glacier protocol recovery code is stored in cabinet 27.", Attributes: []byte(`{}`), Version: 1},
	}}
	inheritedEncoded, err := yjs.EncodeBodyV1(inheritedBody)
	if err != nil {
		t.Fatalf("encode no-project inherited source body: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_nodes (document_id, node_id, parent_id, sibling_order, node_type, content, attributes, version) VALUES ($1, $2, NULL, 0, 'document', '', '{}', 1), ($1, $3, $2, 0, 'paragraph', '', '{}', 1), ($1, $4, $3, 0, 'run', $5, '{}', 1)`, inheritedDocumentID, inheritedRootID, inheritedParagraphID, inheritedRunID, inheritedBody.Nodes[2].Content); err != nil {
		t.Fatalf("insert no-project inherited source nodes: %v", err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE documents SET root_node_id = $2 WHERE id = $1`, inheritedDocumentID, inheritedRootID); err != nil {
		t.Fatalf("set no-project inherited source root: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_collab_states (document_id, encoded_state, schema_version) VALUES ($1, $2, 1)`, inheritedDocumentID, inheritedEncoded); err != nil {
		t.Fatalf("insert no-project inherited source Yjs state: %v", err)
	}
	if _, err := repository.RebuildRAGIndex(ctx, inheritedDocumentID); err != nil {
		t.Fatalf("index no-project inherited source: %v", err)
	}
	missingEmbeddings, err := repository.ListRAGChunksMissingEmbeddings(ctx, embedder.Provider(), embedder.Model(), 20)
	if err != nil {
		t.Fatalf("list no-project inherited source embeddings: %v", err)
	}
	var inheritedChunk *documentrepo.RAGChunkEmbedding
	for _, chunk := range missingEmbeddings {
		if chunk.DocumentID == inheritedDocumentID {
			vectors, err := embedder.Embed(ctx, []string{chunk.Text})
			if err != nil {
				t.Fatalf("embed no-project inherited source: %v", err)
			}
			inheritedChunk = &documentrepo.RAGChunkEmbedding{
				ChunkID: chunk.ChunkID, DocumentID: chunk.DocumentID, BodyVersion: chunk.BodyVersion,
				SourceFingerprint: chunk.SourceFingerprint, Vector: vectors[0],
			}
			break
		}
	}
	if inheritedChunk == nil {
		t.Fatal("no-project inherited source has no chunk awaiting an embedding")
	}
	if err := repository.StoreRAGChunkEmbeddings(ctx, embedder.Provider(), embedder.Model(), []documentrepo.RAGChunkEmbedding{*inheritedChunk}); err != nil {
		t.Fatalf("store no-project inherited source embedding: %v", err)
	}
	inheritedAnswerResponse := request(http.MethodPost, "/api/v1/rag/conversations/"+conversation.ID.String()+"/messages", `{"question":"Where is the glacier protocol recovery code?","language":"en"}`, true)
	var inheritedAnswerEnvelope ragChatEnvelope
	var inheritedAnswer appchat.Answer
	if inheritedAnswerResponse.Code != http.StatusOK || json.Unmarshal(inheritedAnswerResponse.Body.Bytes(), &inheritedAnswerEnvelope) != nil || json.Unmarshal(inheritedAnswerEnvelope.Data, &inheritedAnswer) != nil || len(inheritedAnswer.Citations) != 1 || inheritedAnswer.Citations[0].DocumentID != inheritedDocumentID || inheritedAnswer.Citations[0].NodeID != inheritedParagraphID {
		t.Fatalf("inherit source without project = %+v, status = %d, body = %s, want the exact cited block for a workspace member", inheritedAnswer, inheritedAnswerResponse.Code, inheritedAnswerResponse.Body.String())
	}

	if _, err := db.ExecContext(ctx, `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, workspaceID, actorID); err != nil {
		t.Fatalf("remove workspace membership: %v", err)
	}
	historyResponse = request(http.MethodGet, "/api/v1/rag/conversations/"+conversation.ID.String(), "", false)
	if historyResponse.Code != http.StatusOK {
		t.Fatalf("history after workspace exit status = %d, body = %s", historyResponse.Code, historyResponse.Body.String())
	}
	followUpAfterExit := request(http.MethodPost, "/api/v1/rag/conversations/"+conversation.ID.String()+"/messages", `{"question":"Follow up"}`, true)
	if followUpAfterExit.Code != http.StatusForbidden {
		t.Fatalf("ask after workspace exit status = %d, body = %s, want 403", followUpAfterExit.Code, followUpAfterExit.Body.String())
	}
	conversationList := request(http.MethodGet, "/api/v1/rag/conversations", "", false)
	if conversationList.Code != http.StatusOK {
		t.Fatalf("list private conversations after workspace exit status = %d, body = %s", conversationList.Code, conversationList.Body.String())
	}
	var listEnvelope ragChatEnvelope
	if err := json.Unmarshal(conversationList.Body.Bytes(), &listEnvelope); err != nil {
		t.Fatalf("decode conversation list: %v", err)
	}
	var conversations []model.RAGConversation
	if err := json.Unmarshal(listEnvelope.Data, &conversations); err != nil || len(conversations) != 3 {
		t.Fatalf("conversation list = %+v, error = %v, want all three saved personal conversations", conversations, err)
	}
	deleted := request(http.MethodDelete, "/api/v1/rag/conversations/"+conversation.ID.String(), "", false)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete private conversation status = %d, body = %s", deleted.Code, deleted.Body.String())
	}
	historyAfterDelete := request(http.MethodGet, "/api/v1/rag/conversations/"+conversation.ID.String(), "", false)
	if historyAfterDelete.Code != http.StatusNotFound {
		t.Fatalf("history after delete status = %d, body = %s, want 404", historyAfterDelete.Code, historyAfterDelete.Body.String())
	}
	deleted = request(http.MethodDelete, "/api/v1/rag/conversations/"+linkConversation.ID.String(), "", false)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete public-link conversation status = %d, body = %s", deleted.Code, deleted.Body.String())
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`, workspaceID, actorID); err != nil {
		t.Fatalf("restore workspace owner for deletion: %v", err)
	}
	deletedWorkspace := request(http.MethodDelete, "/api/v1/workspaces/"+workspaceID.String(), "", true)
	if deletedWorkspace.Code != http.StatusOK {
		t.Fatalf("delete workspace with saved RAG history status = %d, body = %s", deletedWorkspace.Code, deletedWorkspace.Body.String())
	}
	historyAfterWorkspaceDelete := request(http.MethodGet, "/api/v1/rag/conversations/"+conflictConversation.ID.String(), "", false)
	if historyAfterWorkspaceDelete.Code != http.StatusNotFound {
		t.Fatalf("history after workspace deletion status = %d, body = %s, want 404", historyAfterWorkspaceDelete.Code, historyAfterWorkspaceDelete.Body.String())
	}
	var remainingChats, remainingMessages int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM rag_conversations WHERE workspace_id = $1`, workspaceID).Scan(&remainingChats); err != nil {
		t.Fatalf("check conversations after workspace deletion: %v", err)
	}
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM rag_messages WHERE conversation_id = $1`, conflictConversation.ID).Scan(&remainingMessages); err != nil {
		t.Fatalf("check messages after workspace deletion: %v", err)
	}
	if remainingChats != 0 || remainingMessages != 0 {
		t.Fatalf("workspace deletion left RAG data: conversations=%d messages=%d", remainingChats, remainingMessages)
	}
}
