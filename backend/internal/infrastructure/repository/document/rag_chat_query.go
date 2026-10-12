package document

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"backend/constant"
	"backend/internal/domain/mention"
	"backend/internal/domain/model"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

// conversationListOrder puts pinned Conversations first and archived ones last.
const conversationListOrder = `(archived_at IS NOT NULL), pinned_at DESC NULLS LAST, updated_at DESC, conversation_id`

// MaxPinnedConversations is how many Conversations one User may pin in one scope
// (the workspace scope, or one document).
const MaxPinnedConversations = 5

// UpdateRAGConversation renames, pins, unpins, archives or restores one of the
// actor's own Conversations and returns it as stored. Pinning past
// MaxPinnedConversations in the Conversation's scope fails with
// constant.ErrConversationPinLimit.
func (r *Repository) UpdateRAGConversation(ctx context.Context, conversationID, actorID uuid.UUID, patch model.RAGConversationPatch) (model.RAGConversation, error) {
	var conversation model.RAGConversation
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		var documentID *uuid.UUID
		var alreadyPinned bool
		if err := tx.QueryRowContext(ctx, `
			SELECT document_id, pinned_at IS NOT NULL FROM rag_conversations
			WHERE conversation_id = $1 AND creator_id = $2
		`, conversationID, actorID).Scan(&documentID, &alreadyPinned); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return constant.ErrDocumentNotFound
			}
			return err
		}
		if patch.Pinned != nil && *patch.Pinned && !alreadyPinned {
			// One pin at a time per User, or two pins could both see room.
			if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, "rag-pins:"+actorID.String()); err != nil {
				return err
			}
			var pinned int
			if err := tx.QueryRowContext(ctx, `
				SELECT count(*) FROM rag_conversations
				WHERE creator_id = $1 AND document_id IS NOT DISTINCT FROM $2 AND pinned_at IS NOT NULL
			`, actorID, documentID).Scan(&pinned); err != nil {
				return err
			}
			if pinned >= MaxPinnedConversations {
				return constant.ErrConversationPinLimit
			}
		}
		return tx.QueryRowContext(ctx, `
			UPDATE rag_conversations SET
				title = COALESCE($3, title),
				title_generated = title_generated OR $3::text IS NOT NULL,
				pinned_at = CASE WHEN $4::boolean IS NULL THEN pinned_at WHEN $4 THEN COALESCE(pinned_at, NOW()) ELSE NULL END,
				archived_at = CASE WHEN $5::boolean IS NULL THEN archived_at WHEN $5 THEN COALESCE(archived_at, NOW()) ELSE NULL END
			WHERE conversation_id = $1 AND creator_id = $2
			RETURNING conversation_id, workspace_id, creator_id, document_id, title, pinned_at, archived_at, created_at, updated_at, EXISTS (SELECT 1 FROM rag_messages m WHERE m.conversation_id = rag_conversations.conversation_id AND m.role = 'assistant' AND m.created_at > rag_conversations.last_read_at)
		`, conversationID, actorID, patch.Title, patch.Pinned, patch.Archived).Scan(
			&conversation.ID, &conversation.WorkspaceID, &conversation.CreatorID, &conversation.DocumentID,
			&conversation.Title, &conversation.PinnedAt, &conversation.ArchivedAt, &conversation.CreatedAt, &conversation.UpdatedAt, &conversation.Unread)
	})
	return conversation, err
}

// RAGTitleSource reads the first question and first answer of a Conversation
// whose title the model has not yet written. ok is false when there is nothing
// to do: the title was already written or renamed, or no answer exists yet.
func (r *Repository) RAGTitleSource(ctx context.Context, conversationID, actorID uuid.UUID) (question, answer string, ok bool, err error) {
	err = r.db.QueryRowContext(ctx, `
		SELECT
			COALESCE((SELECT content FROM rag_messages WHERE conversation_id = c.conversation_id AND role = 'user' ORDER BY sequence_no LIMIT 1), ''),
			COALESCE((SELECT content FROM rag_messages WHERE conversation_id = c.conversation_id AND role = 'assistant' ORDER BY sequence_no LIMIT 1), '')
		FROM rag_conversations c
		WHERE c.conversation_id = $1 AND c.creator_id = $2 AND NOT c.title_generated
	`, conversationID, actorID).Scan(&question, &answer)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", false, nil
	}
	return question, answer, err == nil && question != "" && answer != "", err
}

// SetGeneratedRAGTitle stores the model's title unless the User renamed the
// Conversation, or it was titled, in the meantime.
func (r *Repository) SetGeneratedRAGTitle(ctx context.Context, conversationID, actorID uuid.UUID, title string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE rag_conversations SET title = $3, title_generated = true
		WHERE conversation_id = $1 AND creator_id = $2 AND NOT title_generated
	`, conversationID, actorID, title)
	return err
}

// MarkRAGConversationRead records that the actor has seen the Conversation up to now.
func (r *Repository) MarkRAGConversationRead(ctx context.Context, conversationID, actorID uuid.UUID) error {
	result, err := r.db.ExecContext(ctx, `
		UPDATE rag_conversations SET last_read_at = NOW() WHERE conversation_id = $1 AND creator_id = $2
	`, conversationID, actorID)
	if err != nil {
		return err
	}
	if updated, err := result.RowsAffected(); err != nil {
		return err
	} else if updated == 0 {
		return constant.ErrDocumentNotFound
	}
	return nil
}

func (r *Repository) CreateRAGConversation(ctx context.Context, workspaceID, actorID uuid.UUID) (model.RAGConversation, error) {
	var conversation model.RAGConversation
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		if err := lockRAGWorkspaceMembership(ctx, tx, workspaceID, actorID); err != nil {
			return err
		}
		return tx.QueryRowContext(ctx, `
			INSERT INTO rag_conversations (workspace_id, creator_id)
			VALUES ($1, $2)
			RETURNING conversation_id, workspace_id, creator_id, title, created_at, updated_at
		`, workspaceID, actorID).Scan(&conversation.ID, &conversation.WorkspaceID, &conversation.CreatorID, &conversation.Title, &conversation.CreatedAt, &conversation.UpdatedAt)
	})
	return conversation, err
}

func (r *Repository) ListRAGConversations(ctx context.Context, actorID uuid.UUID) ([]model.RAGConversation, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT conversation_id, workspace_id, creator_id, document_id, title, pinned_at, archived_at, created_at, updated_at, EXISTS (SELECT 1 FROM rag_messages m WHERE m.conversation_id = rag_conversations.conversation_id AND m.role = 'assistant' AND m.created_at > rag_conversations.last_read_at)
		FROM rag_conversations WHERE creator_id = $1 AND document_id IS NULL
		ORDER BY `+conversationListOrder+`
	`, actorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	conversations := make([]model.RAGConversation, 0)
	for rows.Next() {
		var conversation model.RAGConversation
		if err := rows.Scan(&conversation.ID, &conversation.WorkspaceID, &conversation.CreatorID, &conversation.DocumentID, &conversation.Title, &conversation.PinnedAt, &conversation.ArchivedAt, &conversation.CreatedAt, &conversation.UpdatedAt, &conversation.Unread); err != nil {
			return nil, err
		}
		conversations = append(conversations, conversation)
	}
	return conversations, rows.Err()
}

// CreateDocumentRAGConversation opens a Conversation on one document the actor may read.
func (r *Repository) CreateDocumentRAGConversation(ctx context.Context, workspaceID, actorID, documentID uuid.UUID) (model.RAGConversation, error) {
	var conversation model.RAGConversation
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		if err := lockRAGWorkspaceMembership(ctx, tx, workspaceID, actorID); err != nil {
			return err
		}
		if err := requireDocumentRead(ctx, tx, documentID, workspaceID, actorID); err != nil {
			return err
		}
		return tx.QueryRowContext(ctx, `
			INSERT INTO rag_conversations (workspace_id, creator_id, document_id)
			VALUES ($1, $2, $3)
			RETURNING conversation_id, workspace_id, creator_id, document_id, title, created_at, updated_at
		`, workspaceID, actorID, documentID).Scan(&conversation.ID, &conversation.WorkspaceID, &conversation.CreatorID, &conversation.DocumentID, &conversation.Title, &conversation.CreatedAt, &conversation.UpdatedAt)
	})
	return conversation, err
}

// ListDocumentRAGConversations lists the actor's own Conversations on one document.
func (r *Repository) ListDocumentRAGConversations(ctx context.Context, actorID, documentID uuid.UUID) ([]model.RAGConversation, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT conversation_id, workspace_id, creator_id, document_id, title, pinned_at, archived_at, created_at, updated_at, EXISTS (SELECT 1 FROM rag_messages m WHERE m.conversation_id = rag_conversations.conversation_id AND m.role = 'assistant' AND m.created_at > rag_conversations.last_read_at)
		FROM rag_conversations WHERE creator_id = $1 AND document_id = $2
		ORDER BY `+conversationListOrder+`
	`, actorID, documentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	conversations := make([]model.RAGConversation, 0)
	for rows.Next() {
		var conversation model.RAGConversation
		if err := rows.Scan(&conversation.ID, &conversation.WorkspaceID, &conversation.CreatorID, &conversation.DocumentID, &conversation.Title, &conversation.PinnedAt, &conversation.ArchivedAt, &conversation.CreatedAt, &conversation.UpdatedAt, &conversation.Unread); err != nil {
			return nil, err
		}
		conversations = append(conversations, conversation)
	}
	return conversations, rows.Err()
}

func requireDocumentRead(ctx context.Context, tx database.Queryer, documentID, workspaceID, actorID uuid.UUID) error {
	doc, access, err := lockDocumentAccess(ctx, tx, documentID, workspaceID, actorID, false, nil)
	if err != nil {
		return err
	}
	if !policy.CanReadDocument(doc, access) {
		return constant.ErrForbidden
	}
	return nil
}

// ListRAGChunksForDocument returns the current chunks of one document the actor may read, in order.
func (r *Repository) ListRAGChunksForDocument(ctx context.Context, workspaceID, actorID, documentID uuid.UUID, limit int) ([]model.RAGChunk, error) {
	if limit <= 0 || limit > 200 {
		limit = 40
	}
	var chunks []model.RAGChunk
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		if err := lockRAGWorkspaceMembership(ctx, tx, workspaceID, actorID); err != nil {
			return err
		}
		if err := requireDocumentRead(ctx, tx, documentID, workspaceID, actorID); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `
			SELECT c.chunk_id, c.document_id, c.node_id, c.text, c.title, c.breadcrumb,
			       c.body_version, c.source_fingerprint, ri.coverage_status
			FROM rag_chunks c
			JOIN documents d ON d.id = c.document_id
			JOIN rag_document_indexes ri ON ri.document_id = d.id
			WHERE c.document_id = $1 AND d.workspace_id = $2 AND d.deleted_at IS NULL
			  AND ri.indexed_body_version = d.body_version AND ri.source_fingerprint = c.source_fingerprint
			ORDER BY c.ordinal
			LIMIT $3
		`, documentID, workspaceID, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var c model.RAGChunk
			if err := rows.Scan(&c.ChunkID, &c.DocumentID, &c.NodeID, &c.Text, &c.Title, &c.Breadcrumb, &c.BodyVersion, &c.SourceFingerprint, &c.CoverageStatus); err != nil {
				return err
			}
			chunks = append(chunks, c)
		}
		return rows.Err()
	})
	return chunks, err
}

// StoreAgentAnswer keeps a question and the Agent's answer, with what it did in meta.
func (r *Repository) StoreAgentAnswer(ctx context.Context, workspaceID, conversationID, actorID uuid.UUID, question, answer string, meta json.RawMessage) error {
	if len(meta) == 0 {
		meta = json.RawMessage(`{}`)
	}
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		if err := lockRAGWorkspaceMembership(ctx, tx, workspaceID, actorID); err != nil {
			return err
		}
		var actualWorkspaceID uuid.UUID
		if err := tx.QueryRowContext(ctx, `
			SELECT workspace_id FROM rag_conversations WHERE conversation_id = $1 AND creator_id = $2 FOR UPDATE
		`, conversationID, actorID).Scan(&actualWorkspaceID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return constant.ErrDocumentNotFound
			}
			return err
		}
		if actualWorkspaceID != workspaceID {
			return constant.ErrDocumentNotFound
		}
		var last int64
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(sequence_no), 0) FROM rag_messages WHERE conversation_id = $1`, conversationID).Scan(&last); err != nil {
			return err
		}
		if strings.TrimSpace(question) != "" {
			if _, err := tx.ExecContext(ctx, `INSERT INTO rag_messages (conversation_id, sequence_no, role, content) VALUES ($1, $2, 'user', $3)`, conversationID, last+1, question); err != nil {
				return err
			}
			last++
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO rag_messages (conversation_id, sequence_no, role, content, meta) VALUES ($1, $2, 'assistant', $3, $4)
		`, conversationID, last+1, answer, []byte(meta)); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE rag_conversations SET updated_at = NOW(),
			title = CASE WHEN title = '' THEN left($2, 80) ELSE title END WHERE conversation_id = $1`, conversationID, question)
		return err
	})
}

func (r *Repository) AuthorizeRAGQuestion(ctx context.Context, workspaceID, conversationID, actorID uuid.UUID) error {
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		if err := lockRAGWorkspaceMembership(ctx, tx, workspaceID, actorID); err != nil {
			return err
		}
		var actualWorkspaceID uuid.UUID
		var documentID *uuid.UUID
		err := tx.QueryRowContext(ctx, `
			SELECT workspace_id, document_id FROM rag_conversations
			WHERE conversation_id = $1 AND creator_id = $2
		`, conversationID, actorID).Scan(&actualWorkspaceID, &documentID)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && actualWorkspaceID != workspaceID) {
			return constant.ErrDocumentNotFound
		}
		if err != nil || documentID == nil {
			return err
		}
		// A document Conversation can be read after access ends, but not asked anything (ADR 0004).
		return requireDocumentRead(ctx, tx, *documentID, workspaceID, actorID)
	})
}

func (r *Repository) GetRAGConversation(ctx context.Context, conversationID, actorID uuid.UUID) (model.RAGConversationHistory, error) {
	history, err := r.ragConversation(ctx, conversationID, actorID)
	if err != nil {
		return history, err
	}
	history.Messages, _, err = r.ragMessages(ctx, conversationID, 0, 0)
	return history, err
}

// GetRAGConversationPage returns the newest limit messages that come before
// the sequence number `before` (0 means from the newest), oldest first. The
// second result is the sequence to pass as `before` for the next older page,
// or 0 when this page reaches the first message.
func (r *Repository) GetRAGConversationPage(ctx context.Context, conversationID, actorID uuid.UUID, before int64, limit int) (model.RAGConversationHistory, int64, error) {
	history, err := r.ragConversation(ctx, conversationID, actorID)
	if err != nil {
		return history, 0, err
	}
	var next int64
	history.Messages, next, err = r.ragMessages(ctx, conversationID, before, limit)
	if err != nil {
		return history, 0, err
	}
	return history, next, r.attachMentions(ctx, history.Conversation.WorkspaceID, actorID, history.Messages)
}

// ReadableDocumentTitles returns the current title of each listed document the
// actor may read in the workspace. Documents that are missing, trashed, in
// another workspace or not readable are left out.
func (r *Repository) ReadableDocumentTitles(ctx context.Context, workspaceID, actorID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]string, error) {
	titles := make(map[uuid.UUID]string, len(ids))
	if len(ids) == 0 {
		return titles, nil
	}
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		for _, id := range ids {
			doc, access, err := lockDocumentAccess(ctx, tx, id, workspaceID, actorID, false, nil)
			if errors.Is(err, constant.ErrDocumentNotFound) || errors.Is(err, constant.ErrForbidden) {
				continue
			}
			if err != nil {
				return err
			}
			if !policy.CanReadDocument(doc, access) {
				continue
			}
			var title string
			if err := tx.QueryRowContext(ctx, `SELECT title FROM documents WHERE id = $1`, id).Scan(&title); err != nil {
				return err
			}
			titles[id] = title
		}
		return nil
	})
	return titles, err
}

// attachMentions lists, on each question, the documents it names and whether
// the actor can still read them.
func (r *Repository) attachMentions(ctx context.Context, workspaceID, actorID uuid.UUID, messages []model.RAGMessage) error {
	var ids []uuid.UUID
	seen := map[uuid.UUID]bool{}
	for _, message := range messages {
		if message.Role != "user" {
			continue
		}
		for _, found := range mention.ParseDocuments(message.Content) {
			if !seen[found.DocumentID] {
				seen[found.DocumentID] = true
				ids = append(ids, found.DocumentID)
			}
		}
	}
	titles, err := r.ReadableDocumentTitles(ctx, workspaceID, actorID, ids)
	if err != nil {
		return err
	}
	for i := range messages {
		if messages[i].Role != "user" {
			continue
		}
		listed := map[uuid.UUID]bool{}
		for _, found := range mention.ParseDocuments(messages[i].Content) {
			if listed[found.DocumentID] {
				continue
			}
			listed[found.DocumentID] = true
			title, available := titles[found.DocumentID]
			if !available {
				title = found.Label
			}
			messages[i].Mentions = append(messages[i].Mentions, model.RAGMention{DocumentID: found.DocumentID, Title: title, Available: available})
		}
	}
	return nil
}

func (r *Repository) ragConversation(ctx context.Context, conversationID, actorID uuid.UUID) (model.RAGConversationHistory, error) {
	var history model.RAGConversationHistory
	if err := r.db.QueryRowContext(ctx, `
		SELECT conversation_id, workspace_id, creator_id, document_id, title, created_at, updated_at
		FROM rag_conversations WHERE conversation_id = $1 AND creator_id = $2
	`, conversationID, actorID).Scan(
		&history.Conversation.ID, &history.Conversation.WorkspaceID, &history.Conversation.CreatorID,
		&history.Conversation.DocumentID, &history.Conversation.Title, &history.Conversation.CreatedAt, &history.Conversation.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return history, constant.ErrDocumentNotFound
		}
		return history, err
	}
	return history, nil
}

// ragMessages reads a conversation's messages oldest first. A limit of 0 reads
// all of them; otherwise it reads the newest `limit` before the sequence number
// `before` (0 means no upper bound) and reports where the older ones start.
func (r *Repository) ragMessages(ctx context.Context, conversationID uuid.UUID, before int64, limit int) ([]model.RAGMessage, int64, error) {
	query := `
		SELECT message_id, conversation_id, role, content, coverage_partial, sources_may_be_incomplete, meta, created_at, sequence_no
		FROM rag_messages WHERE conversation_id = $1 AND ($2 = 0 OR sequence_no < $2)
		ORDER BY sequence_no`
	args := []any{conversationID, before}
	if limit > 0 {
		// One extra row tells whether an older page exists.
		query = strings.Replace(query, "ORDER BY sequence_no", "ORDER BY sequence_no DESC LIMIT $3", 1)
		args = append(args, limit+1)
	}
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	messages := make([]model.RAGMessage, 0)
	sequences := make([]int64, 0)
	for rows.Next() {
		var message model.RAGMessage
		var meta []byte
		var sequence int64
		if err := rows.Scan(
			&message.ID, &message.ConversationID, &message.Role, &message.Content,
			&message.CoveragePartial, &message.SourcesMayBeIncomplete, &meta, &message.CreatedAt, &sequence,
		); err != nil {
			return nil, 0, err
		}
		if string(meta) != "{}" && len(meta) > 0 {
			message.Meta = meta
		}
		message.Citations = []model.RAGCitation{}
		messages = append(messages, message)
		sequences = append(sequences, sequence)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	var next int64
	if limit > 0 {
		if len(messages) > limit {
			// The extra row only proved an older page exists. The cursor is the
			// oldest sequence kept, so the next page is everything before it.
			messages, sequences = messages[:limit], sequences[:limit]
			next = sequences[limit-1]
		}
		for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
			messages[i], messages[j] = messages[j], messages[i]
			sequences[i], sequences[j] = sequences[j], sequences[i]
		}
	}
	for i := range messages {
		if messages[i].Role != "assistant" {
			continue
		}
		citations, err := r.listRAGCitations(ctx, messages[i].ID)
		if err != nil {
			return nil, 0, err
		}
		messages[i].Citations = citations
	}
	return messages, next, nil
}

func (r *Repository) DeleteRAGConversation(ctx context.Context, conversationID, actorID uuid.UUID) error {
	result, err := r.db.ExecContext(ctx, `
		DELETE FROM rag_conversations WHERE conversation_id = $1 AND creator_id = $2
	`, conversationID, actorID)
	if err != nil {
		return err
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if deleted == 0 {
		return constant.ErrDocumentNotFound
	}
	return nil
}

func (r *Repository) StoreRAGAnswer(ctx context.Context, workspaceID, conversationID, actorID uuid.UUID, question, answer string, coveragePartial, sourcesMayBeIncomplete bool, citations []model.RAGCitation, publicLinkTokens []string) error {
	if r.tx == nil {
		return errors.New("storing RAG answer requires a transaction-capable database")
	}
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		// The answer was made from the sources readable when the question was
		// asked (ADR-0046). Access revoked or a body edited since then does not
		// discard it, so only the conversation itself is checked here.
		var actualWorkspaceID uuid.UUID
		if err := tx.QueryRowContext(ctx, `
			SELECT workspace_id FROM rag_conversations
			WHERE conversation_id = $1 AND creator_id = $2 FOR UPDATE
		`, conversationID, actorID).Scan(&actualWorkspaceID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return constant.ErrDocumentNotFound
			}
			return err
		}
		if actualWorkspaceID != workspaceID {
			return constant.ErrDocumentNotFound
		}
		var lastSequence int64
		if err := tx.QueryRowContext(ctx, `
			SELECT COALESCE(MAX(sequence_no), 0) FROM rag_messages WHERE conversation_id = $1
		`, conversationID).Scan(&lastSequence); err != nil {
			return err
		}

		// A source deleted since the snapshot cannot be cited: its row is held
		// against deletion until this commits, and a missing one is left out.
		kept := make([]model.RAGCitation, 0, len(citations))
		chunkExists := make(map[uuid.UUID]bool, len(citations))
		documentIDs := make([]uuid.UUID, 0, len(citations))
		seenDocuments := make(map[uuid.UUID]bool, len(citations))
		for _, citation := range citations {
			if !seenDocuments[citation.DocumentID] {
				seenDocuments[citation.DocumentID] = true
				documentIDs = append(documentIDs, citation.DocumentID)
			}
		}
		sort.Slice(documentIDs, func(i, j int) bool { return documentIDs[i].String() < documentIDs[j].String() })
		present := make(map[uuid.UUID]bool, len(documentIDs))
		for _, documentID := range documentIDs {
			var found int
			err := tx.QueryRowContext(ctx, `SELECT 1 FROM documents WHERE id = $1 FOR KEY SHARE`, documentID).Scan(&found)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
			present[documentID] = err == nil
		}
		for _, citation := range citations {
			if !present[citation.DocumentID] {
				continue
			}
			if _, known := chunkExists[citation.ChunkID]; !known {
				var found int
				err := tx.QueryRowContext(ctx, `SELECT 1 FROM rag_chunks WHERE chunk_id = $1 FOR KEY SHARE`, citation.ChunkID).Scan(&found)
				if err != nil && !errors.Is(err, sql.ErrNoRows) {
					return err
				}
				chunkExists[citation.ChunkID] = err == nil
			}
			kept = append(kept, citation)
		}
		citations = kept

		if _, err := tx.ExecContext(ctx, `
			INSERT INTO rag_messages (conversation_id, sequence_no, role, content) VALUES ($1, $2, 'user', $3)
		`, conversationID, lastSequence+1, question); err != nil {
			return err
		}
		var answerID uuid.UUID
		if err := tx.QueryRowContext(ctx, `
			INSERT INTO rag_messages (conversation_id, sequence_no, role, content, coverage_partial, sources_may_be_incomplete)
			VALUES ($1, $2, 'assistant', $3, $4, $5)
			RETURNING message_id
		`, conversationID, lastSequence+2, answer, coveragePartial, sourcesMayBeIncomplete).Scan(&answerID); err != nil {
			return err
		}
		for ordinal, citation := range citations {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO rag_message_citations (
					message_id, document_id, chunk_id, node_id, body_version,
					source_fingerprint, quoted_text, breadcrumb, ordinal, document_title, project_name
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			`, answerID, citation.DocumentID, nullableChunk(citation.ChunkID, chunkExists), citation.NodeID, citation.BodyVersion,
				citation.SourceFingerprint, citation.QuotedText, citation.Breadcrumb, ordinal,
				citation.DocumentTitle, citation.ProjectName); err != nil {
				return err
			}
		}
		_, err := tx.ExecContext(ctx, `UPDATE rag_conversations SET updated_at = NOW() WHERE conversation_id = $1`, conversationID)
		return err
	})
}

func (r *Repository) listRAGCitations(ctx context.Context, messageID uuid.UUID) ([]model.RAGCitation, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT c.document_id, c.chunk_id, c.node_id, c.body_version, c.source_fingerprint,
		       c.quoted_text, c.breadcrumb, c.ordinal, c.document_title, c.project_name,
		       (
				 d.id IS NULL OR d.body_version <> c.body_version OR ri.document_id IS NULL
				 OR ri.source_fingerprint IS DISTINCT FROM c.source_fingerprint
				 OR ri.indexed_title IS DISTINCT FROM d.title
				 OR ri.indexed_project_id IS DISTINCT FROM d.project_id
				 OR ri.indexed_project_name IS DISTINCT FROM COALESCE(p.name, '')
				 OR ri.renderer_version <> 2
		       ) AS source_changed
		FROM rag_message_citations c
		LEFT JOIN documents d ON d.id = c.document_id
		LEFT JOIN rag_document_indexes ri ON ri.document_id = d.id
		LEFT JOIN projects p ON p.id = d.project_id AND p.workspace_id = d.workspace_id AND p.deleted_at IS NULL
		WHERE c.message_id = $1 ORDER BY c.ordinal
	`, messageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	citations := make([]model.RAGCitation, 0)
	for rows.Next() {
		var citation model.RAGCitation
		var chunkID sql.NullString
		if err := rows.Scan(
			&citation.DocumentID, &chunkID, &citation.NodeID, &citation.BodyVersion,
			&citation.SourceFingerprint, &citation.QuotedText, &citation.Breadcrumb,
			&citation.Ordinal, &citation.DocumentTitle, &citation.ProjectName, &citation.SourceChanged,
		); err != nil {
			return nil, err
		}
		if chunkID.Valid {
			parsed, err := uuid.Parse(chunkID.String)
			if err != nil {
				return nil, err
			}
			citation.ChunkID = parsed
		}
		citations = append(citations, citation)
	}
	return citations, rows.Err()
}

// nullableChunk is the chunk to cite, or nil when it was replaced by a re-index
// after the snapshot; the quoted text is kept in the citation either way.
func nullableChunk(id uuid.UUID, exists map[uuid.UUID]bool) any {
	if exists[id] {
		return id
	}
	return nil
}

func lockRAGWorkspaceMembership(ctx context.Context, tx database.Queryer, workspaceID, actorID uuid.UUID) error {
	var role string
	err := tx.QueryRowContext(ctx, `
		SELECT role::text FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 FOR SHARE
	`, workspaceID, actorID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return constant.ErrForbidden
	}
	return err
}

// SearchDocumentTitles lists the documents the actor may read in the workspace
// whose title contains the text, newest change first. An empty text lists the
// most recently changed ones. Only titles are searched, never document text.
func (r *Repository) SearchDocumentTitles(ctx context.Context, workspaceID, actorID uuid.UUID, text string, limit int) ([]model.RAGDocumentHit, error) {
	escaped := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(strings.TrimSpace(text))
	rows, err := r.db.QueryContext(ctx, `
		SELECT d.id, d.title, d.type::text,
		       CASE WHEN p.id IS NOT NULL AND `+projectMetadataPredicate("$2", "p")+` THEN p.name ELSE '' END
		FROM documents d
		LEFT JOIN projects p ON p.id = d.project_id AND p.workspace_id = d.workspace_id AND p.deleted_at IS NULL
		WHERE d.workspace_id = $1
		  AND d.deleted_at IS NULL
		  AND d.title ILIKE '%' || $3 || '%'
	`+documentReadPredicate+`
		ORDER BY d.updated_at DESC, d.id
		LIMIT $4
	`, workspaceID, actorID, escaped, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	hits := make([]model.RAGDocumentHit, 0)
	for rows.Next() {
		var hit model.RAGDocumentHit
		if err := rows.Scan(&hit.ID, &hit.Title, &hit.Type, &hit.ProjectName); err != nil {
			return nil, err
		}
		hit.Categories = []string{}
		hits = append(hits, hit)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(hits) == 0 {
		return hits, nil
	}
	ids := make([]uuid.UUID, len(hits))
	for i, hit := range hits {
		ids[i] = hit.ID
	}
	categories, err := r.fetchCategoriesForDocuments(ctx, ids, actorID)
	if err != nil {
		return nil, err
	}
	for i := range hits {
		if names := categories[hits[i].ID]; len(names) > 0 {
			hits[i].Categories = names
		}
	}
	return hits, nil
}
