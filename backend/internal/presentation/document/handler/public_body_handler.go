package handler

import (
	"errors"
	"net/http"

	"backend/internal/application/collaboration"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

type PublicBodyHandler struct {
	reader *collaboration.PublicBodyReadUseCase
}

func NewPublicBodyHandler(reader *collaboration.PublicBodyReadUseCase) *PublicBodyHandler {
	return &PublicBodyHandler{reader: reader}
}

type publicBodySnapshotResponse struct {
	BodyVersion       int64              `json:"bodyVersion"`
	BodySchemaVersion int                `json:"bodySchemaVersion"`
	RootNodeID        uuid.UUID          `json:"rootNodeID"`
	Nodes             []bodyNodeResponse `json:"nodes"`
}

// GetBody returns the canonical Markdown AST for a valid public share token.
// @Summary Get public Markdown body
// @Description Returns a shared document's canonical AST without exposing its CRDT state.
// @Tags Document
// @Produce json
// @Param shareToken path string true "Document Share Token"
// @Success 200 {object} response.Envelope{data=publicBodySnapshotResponse}
// @Failure 404 {object} response.ErrorEnvelope
// @Failure 409 {object} response.ErrorEnvelope
// @Router /public/documents/{shareToken}/body [get]
func (h *PublicBodyHandler) GetBody(w http.ResponseWriter, r *http.Request) {
	snapshot, err := h.reader.Read(r.Context(), r.PathValue("shareToken"))
	if err != nil {
		if errors.Is(err, collaboration.ErrInvalidPublicBodyRead) {
			response.Error(w, http.StatusNotFound, "document not found")
			return
		}
		writeDocumentError(w, err)
		return
	}
	body := publicBodySnapshotResponse{
		BodyVersion: snapshot.BodyVersion, BodySchemaVersion: snapshot.BodySchemaVersion,
		RootNodeID: snapshot.Body.RootNodeID, Nodes: make([]bodyNodeResponse, len(snapshot.Body.Nodes)),
	}
	for index, node := range snapshot.Body.Nodes {
		body.Nodes[index] = bodyNodeResponse{
			NodeID: node.NodeID, ParentID: node.ParentID, SiblingOrder: node.SiblingOrder,
			Type: node.Type, Content: node.Content, Attributes: node.Attributes, Version: node.Version,
		}
	}
	_ = response.Data(w, http.StatusOK, body)
}
