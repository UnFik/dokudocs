package document

import (
	"context"
	"database/sql"
	"errors"
	"sort"

	"backend/constant"
	"backend/internal/domain/model"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

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
		SELECT conversation_id, workspace_id, creator_id, title, created_at, updated_at
		FROM rag_conversations WHERE creator_id = $1
		ORDER BY updated_at DESC, conversation_id
	`, actorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	conversations := make([]model.RAGConversation, 0)
	for rows.Next() {
		var conversation model.RAGConversation
		if err := rows.Scan(&conversation.ID, &conversation.WorkspaceID, &conversation.CreatorID, &conversation.Title, &conversation.CreatedAt, &conversation.UpdatedAt); err != nil {
			return nil, err
		}
		conversations = append(conversations, conversation)
	}
	return conversations, rows.Err()
}

func (r *Repository) AuthorizeRAGQuestion(ctx context.Context, workspaceID, conversationID, actorID uuid.UUID) error {
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		if err := lockRAGWorkspaceMembership(ctx, tx, workspaceID, actorID); err != nil {
			return err
		}
		var actualWorkspaceID uuid.UUID
		err := tx.QueryRowContext(ctx, `
			SELECT workspace_id FROM rag_conversations
			WHERE conversation_id = $1 AND creator_id = $2
		`, conversationID, actorID).Scan(&actualWorkspaceID)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && actualWorkspaceID != workspaceID) {
			return constant.ErrDocumentNotFound
		}
		return err
	})
}

func (r *Repository) GetRAGConversation(ctx context.Context, conversationID, actorID uuid.UUID) (model.RAGConversationHistory, error) {
	var history model.RAGConversationHistory
	if err := r.db.QueryRowContext(ctx, `
		SELECT conversation_id, workspace_id, creator_id, title, created_at, updated_at
		FROM rag_conversations WHERE conversation_id = $1 AND creator_id = $2
	`, conversationID, actorID).Scan(
		&history.Conversation.ID, &history.Conversation.WorkspaceID, &history.Conversation.CreatorID,
		&history.Conversation.Title, &history.Conversation.CreatedAt, &history.Conversation.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return history, constant.ErrDocumentNotFound
		}
		return history, err
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT message_id, conversation_id, role, content, coverage_partial, sources_may_be_incomplete, created_at
		FROM rag_messages WHERE conversation_id = $1
		ORDER BY sequence_no
	`, conversationID)
	if err != nil {
		return history, err
	}
	defer rows.Close()
	history.Messages = make([]model.RAGMessage, 0)
	for rows.Next() {
		var message model.RAGMessage
		if err := rows.Scan(
			&message.ID, &message.ConversationID, &message.Role, &message.Content,
			&message.CoveragePartial, &message.SourcesMayBeIncomplete, &message.CreatedAt,
		); err != nil {
			return history, err
		}
		message.Citations = []model.RAGCitation{}
		if message.Role == "assistant" {
			citations, err := r.listRAGCitations(ctx, message.ID)
			if err != nil {
				return history, err
			}
			message.Citations = citations
		}
		history.Messages = append(history.Messages, message)
	}
	return history, rows.Err()
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
		if err := lockRAGWorkspaceMembership(ctx, tx, workspaceID, actorID); err != nil {
			return err
		}
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

		documentIDs := make([]uuid.UUID, 0, len(citations))
		seenDocuments := make(map[uuid.UUID]struct{}, len(citations))
		for _, citation := range citations {
			if _, exists := seenDocuments[citation.DocumentID]; !exists {
				seenDocuments[citation.DocumentID] = struct{}{}
				documentIDs = append(documentIDs, citation.DocumentID)
			}
		}
		sort.Slice(documentIDs, func(i, j int) bool { return documentIDs[i].String() < documentIDs[j].String() })
		for _, documentID := range documentIDs {
			doc, access, err := lockDocumentAccess(ctx, tx, documentID, workspaceID, actorID, false, nil)
			if err != nil {
				return err
			}
			if doc.Visibility == "public_link" && !doc.IsDraft {
				var currentToken sql.NullString
				if err := tx.QueryRowContext(ctx, "SELECT share_token FROM documents WHERE id = $1", documentID).Scan(&currentToken); err != nil {
					return err
				}
				for _, token := range publicLinkTokens {
					if currentToken.Valid && token == currentToken.String {
						access.PublicLinkTokenValid = true
						break
					}
				}
			}
			if doc.Visibility == "public_link" && !doc.IsDraft && !access.PublicLinkTokenValid {
				return constant.ErrForbidden
			}
			if !policy.CanReadDocument(doc, access) {
				return constant.ErrForbidden
			}
		}
		for _, citation := range citations {
			var currentVersion, indexedVersion, chunkVersion int64
			var currentFingerprint, chunkFingerprint string
			var nodeID uuid.UUID
			var quotedText string
			err := tx.QueryRowContext(ctx, `
				SELECT d.body_version, ri.indexed_body_version, ri.source_fingerprint,
				       c.body_version, c.source_fingerprint, c.node_id, c.text
				FROM documents d
				JOIN rag_document_indexes ri ON ri.document_id = d.id
				JOIN rag_chunks c ON c.document_id = d.id
				LEFT JOIN projects p ON p.id = d.project_id AND p.workspace_id = d.workspace_id AND p.deleted_at IS NULL
				WHERE d.id = $1 AND c.chunk_id = $2
				  AND ri.indexed_title = d.title
				  AND ri.indexed_project_id IS NOT DISTINCT FROM d.project_id
				  AND ri.indexed_project_name = COALESCE(p.name, '')
				  AND ri.renderer_version = 2
			`, citation.DocumentID, citation.ChunkID).Scan(
				&currentVersion, &indexedVersion, &currentFingerprint,
				&chunkVersion, &chunkFingerprint, &nodeID, &quotedText,
			)
			if err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					return constant.ErrDocumentConflict
				}
				return err
			}
			if currentVersion != citation.BodyVersion || indexedVersion != currentVersion || chunkVersion != currentVersion ||
				currentFingerprint != citation.SourceFingerprint || chunkFingerprint != citation.SourceFingerprint ||
				nodeID != citation.NodeID || quotedText != citation.QuotedText {
				return constant.ErrDocumentConflict
			}
		}

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
			`, answerID, citation.DocumentID, citation.ChunkID, citation.NodeID, citation.BodyVersion,
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
