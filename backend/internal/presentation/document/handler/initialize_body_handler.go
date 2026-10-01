package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"

	"backend/internal/application/collaboration"
	"backend/internal/domain/documentbody"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

type BodyHandler struct {
	initializer *collaboration.BodyInitializationUseCase
	reader      *collaboration.BodyReadUseCase
	mover       *collaboration.MoveNodeUseCase
	deleter     *collaboration.DeleteNodeUseCase
}

func NewBodyHandler(initializer *collaboration.BodyInitializationUseCase, reader *collaboration.BodyReadUseCase, mover *collaboration.MoveNodeUseCase, deleter *collaboration.DeleteNodeUseCase) *BodyHandler {
	return &BodyHandler{initializer: initializer, reader: reader, mover: mover, deleter: deleter}
}

type moveNodeRequest struct {
	CommandID         uuid.UUID  `json:"commandID"`
	BodyEpoch         int64      `json:"bodyEpoch"`
	BodySchemaVersion int        `json:"bodySchemaVersion"`
	NodeID            uuid.UUID  `json:"nodeID"`
	TargetParentID    uuid.UUID  `json:"targetParentID"`
	BeforeNodeID      *uuid.UUID `json:"beforeNodeID"`
}

type deleteNodeRequest struct {
	CommandID         uuid.UUID `json:"commandID"`
	BodyEpoch         int64     `json:"bodyEpoch"`
	BodySchemaVersion int       `json:"bodySchemaVersion"`
	NodeID            uuid.UUID `json:"nodeID"`
}

type bodyInitializationRequest struct {
	BaseBodyVersion   int64                    `json:"baseBodyVersion"`
	BodySchemaVersion int                      `json:"bodySchemaVersion"`
	SourceFingerprint string                   `json:"sourceFingerprint"`
	RootNodeID        uuid.UUID                `json:"rootNodeID"`
	Nodes             []bodyInitializationNode `json:"nodes"`
}

type bodyInitializationNode struct {
	NodeID       uuid.UUID       `json:"nodeID"`
	ParentID     *uuid.UUID      `json:"parentID"`
	SiblingOrder float64         `json:"siblingOrder"`
	Type         string          `json:"type"`
	Content      string          `json:"content"`
	Attributes   json.RawMessage `json:"attributes"`
}

// InitializeBody imports a parsed Markdown body against the source version the parser read.
// @Summary Initialize Markdown body
// @Description Atomically stores the AST and initial Yjs state for an uninitialized Markdown document.
// @Tags Document
// @Accept json
// @Security BearerAuth
// @Param X-Workspace-Id header string true "Workspace ID (UUID)"
// @Param id path string true "Document ID"
// @Param request body bodyInitializationRequest true "Parsed body and source fingerprint"
// @Success 204
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Failure 409 {object} response.ErrorEnvelope
// @Router /documents/{id}/body/initialize [post]
func (h *BodyHandler) InitializeBody(w http.ResponseWriter, r *http.Request) {
	actorID, workspaceID, err := getUserAndWorkspace(r)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	documentID, err := parsePathUUID(r, "id")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid document ID")
		return
	}
	var request bodyInitializationRequest
	if err := response.DecodeJSON(r, &request); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	fingerprint, err := hex.DecodeString(request.SourceFingerprint)
	if err != nil || len(fingerprint) != sha256.Size {
		response.Error(w, http.StatusBadRequest, "sourceFingerprint must be a SHA-256 hex digest")
		return
	}
	var sourceHash [sha256.Size]byte
	copy(sourceHash[:], fingerprint)

	body := documentbody.Body{DocumentID: documentID, RootNodeID: request.RootNodeID, Nodes: make([]documentbody.Node, len(request.Nodes))}
	for index, node := range request.Nodes {
		body.Nodes[index] = documentbody.Node{
			DocumentID: documentID, NodeID: node.NodeID, ParentID: node.ParentID,
			SiblingOrder: node.SiblingOrder, Type: node.Type, Content: node.Content,
			Attributes: node.Attributes, Version: 1,
		}
	}
	err = h.initializer.Initialize(r.Context(), collaboration.Actor{UserID: actorID}, collaboration.BodyInitialization{
		WorkspaceID: workspaceID, DocumentID: documentID, BaseBodyVersion: request.BaseBodyVersion,
		BodySchemaVersion: request.BodySchemaVersion, SourceFingerprint: sourceHash, Body: body,
	})
	if err != nil {
		switch {
		case errors.Is(err, collaboration.ErrInvalidBodyInitialization):
			response.Error(w, http.StatusBadRequest, "invalid document body")
		case errors.Is(err, collaboration.ErrBodySchemaMismatch):
			response.Error(w, http.StatusConflict, err.Error())
		default:
			writeDocumentError(w, err)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type bodySnapshotResponse struct {
	BodyVersion       int64              `json:"bodyVersion"`
	BodyEpoch         int64              `json:"bodyEpoch"`
	BodySchemaVersion int                `json:"bodySchemaVersion"`
	CanEdit           bool               `json:"canEdit"`
	CanSuggest        bool               `json:"canSuggest"`
	RootNodeID        uuid.UUID          `json:"rootNodeID"`
	Nodes             []bodyNodeResponse `json:"nodes"`
	EncodedState      []byte             `json:"encodedState"`
}

type bodyNodeResponse struct {
	NodeID       uuid.UUID       `json:"nodeID"`
	ParentID     *uuid.UUID      `json:"parentID"`
	SiblingOrder float64         `json:"siblingOrder"`
	Type         string          `json:"type"`
	Content      string          `json:"content"`
	Attributes   json.RawMessage `json:"attributes"`
	Version      int64           `json:"version"`
}

// GetBody returns the authorized AST and the matching durable Yjs snapshot.
// @Summary Get Markdown body
// @Description Returns the canonical AST and matching Yjs state for a Markdown document.
// @Tags Document
// @Produce json
// @Security BearerAuth
// @Param X-Workspace-Id header string true "Workspace ID (UUID)"
// @Param id path string true "Document ID"
// @Success 200 {object} response.Envelope{data=bodySnapshotResponse}
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Failure 409 {object} response.ErrorEnvelope
// @Router /documents/{id}/body [get]
func (h *BodyHandler) GetBody(w http.ResponseWriter, r *http.Request) {
	actorID, workspaceID, err := getUserAndWorkspace(r)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	documentID, err := parsePathUUID(r, "id")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid document ID")
		return
	}
	snapshot, err := h.reader.Read(r.Context(), collaboration.Actor{UserID: actorID}, workspaceID, documentID)
	if err != nil {
		if errors.Is(err, collaboration.ErrInvalidBodyRead) {
			response.Error(w, http.StatusBadRequest, "invalid document body request")
			return
		}
		writeDocumentError(w, err)
		return
	}
	body := bodySnapshotResponse{
		BodyVersion: snapshot.BodyVersion, BodyEpoch: snapshot.BodyEpoch,
		BodySchemaVersion: snapshot.BodySchemaVersion, CanEdit: snapshot.CanEdit, CanSuggest: snapshot.CanSuggest, RootNodeID: snapshot.Body.RootNodeID,
		EncodedState: snapshot.EncodedState, Nodes: make([]bodyNodeResponse, len(snapshot.Body.Nodes)),
	}
	for index, node := range snapshot.Body.Nodes {
		body.Nodes[index] = bodyNodeResponse{
			NodeID: node.NodeID, ParentID: node.ParentID, SiblingOrder: node.SiblingOrder,
			Type: node.Type, Content: node.Content, Attributes: node.Attributes, Version: node.Version,
		}
	}
	_ = response.Data(w, http.StatusOK, body)
}

// MoveNode changes an existing node's parent/order through a durable command.
// @Summary Move a Markdown block
// @Description Applies one idempotent structural move and returns the resulting body epoch/version.
// @Tags Document
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param X-Workspace-Id header string true "Workspace ID (UUID)"
// @Param id path string true "Document ID"
// @Param request body moveNodeRequest true "Move command"
// @Success 200 {object} response.Envelope{data=collaboration.MoveNodeResult}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Failure 409 {object} response.ErrorEnvelope
// @Router /documents/{id}/body/move [post]
func (h *BodyHandler) MoveNode(w http.ResponseWriter, r *http.Request) {
	actorID, workspaceID, err := getUserAndWorkspace(r)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	documentID, err := parsePathUUID(r, "id")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid document ID")
		return
	}
	var request moveNodeRequest
	if err := response.DecodeJSON(r, &request); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	result, err := h.mover.Move(r.Context(), collaboration.Actor{UserID: actorID}, collaboration.MoveNodeCommand{
		WorkspaceID: workspaceID, DocumentID: documentID, CommandID: request.CommandID,
		BodyEpoch: request.BodyEpoch, BodySchemaVersion: request.BodySchemaVersion,
		NodeID: request.NodeID, TargetParentID: request.TargetParentID, BeforeNodeID: request.BeforeNodeID,
	})
	if err != nil {
		switch {
		case errors.Is(err, collaboration.ErrInvalidMoveNode):
			response.Error(w, http.StatusBadRequest, "invalid MoveNode command")
		case errors.Is(err, collaboration.ErrMoveCommandReplay):
			response.Error(w, http.StatusConflict, err.Error())
		default:
			writeDocumentError(w, err)
		}
		return
	}
	_ = response.Data(w, http.StatusOK, result)
}

// DeleteNode removes a block through a durable structural command.
// @Summary Delete a Markdown block
// @Description Atomically deletes a block subtree and advances the document body epoch.
// @Tags Document
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param X-Workspace-Id header string true "Workspace ID (UUID)"
// @Param id path string true "Document ID"
// @Param request body deleteNodeRequest true "Delete command"
// @Success 200 {object} response.Envelope{data=collaboration.DeleteNodeResult}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Failure 409 {object} response.ErrorEnvelope
// @Router /documents/{id}/body/delete [post]
func (h *BodyHandler) DeleteNode(w http.ResponseWriter, r *http.Request) {
	actorID, workspaceID, err := getUserAndWorkspace(r)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	documentID, err := parsePathUUID(r, "id")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid document ID")
		return
	}
	var request deleteNodeRequest
	if err := response.DecodeJSON(r, &request); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	result, err := h.deleter.Delete(r.Context(), collaboration.Actor{UserID: actorID}, collaboration.DeleteNodeCommand{
		WorkspaceID: workspaceID, DocumentID: documentID, CommandID: request.CommandID,
		BodyEpoch: request.BodyEpoch, BodySchemaVersion: request.BodySchemaVersion, NodeID: request.NodeID,
	})
	if err != nil {
		switch {
		case errors.Is(err, collaboration.ErrInvalidDeleteNode):
			response.Error(w, http.StatusBadRequest, "invalid DeleteNode command")
		case errors.Is(err, collaboration.ErrDeleteCommandReplay):
			response.Error(w, http.StatusConflict, err.Error())
		default:
			writeDocumentError(w, err)
		}
		return
	}
	_ = response.Data(w, http.StatusOK, result)
}
