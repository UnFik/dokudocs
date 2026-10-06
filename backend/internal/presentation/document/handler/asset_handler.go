package handler

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strconv"

	"backend/internal/application/asset"
	docrepo "backend/internal/infrastructure/repository/document"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

// AssetHandler takes uploads and serves the files back (ADR 0030).
type AssetHandler struct {
	service  *asset.Service
	maxBytes int64
}

func NewAssetHandler(service *asset.Service, maxBytes int64) *AssetHandler {
	return &AssetHandler{service: service, maxBytes: maxBytes}
}

func (h *AssetHandler) Upload(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, err := getUserAndWorkspace(r)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	documentID, err := parsePathUUID(r, "id")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid document id")
		return
	}
	// Uploads are slower than the default read deadline allows.
	controller := http.NewResponseController(w)
	_ = controller.SetReadDeadline(timeNowPlus(uploadDeadline))
	r.Body = http.MaxBytesReader(w, r.Body, h.maxBytes+(1<<20))
	reader, err := r.MultipartReader()
	if err != nil {
		response.Error(w, http.StatusBadRequest, "expected a multipart upload")
		return
	}
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			response.Error(w, http.StatusBadRequest, "missing file field")
			return
		}
		if err != nil {
			h.writeUploadError(w, err)
			return
		}
		if part.FormName() != "file" {
			continue
		}
		stored, err := h.service.Upload(r.Context(), workspaceID, documentID, userID, part.FileName(), part)
		if err != nil {
			h.writeUploadError(w, err)
			return
		}
		_ = response.Data(w, http.StatusCreated, stored)
		return
	}
}

func (h *AssetHandler) writeUploadError(w http.ResponseWriter, err error) {
	var tooBig *http.MaxBytesError
	switch {
	case errors.Is(err, asset.ErrTooLarge), errors.As(err, &tooBig):
		response.Error(w, http.StatusRequestEntityTooLarge, "file is too large")
	default:
		writeDocumentError(w, err)
	}
}

func (h *AssetHandler) Get(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, err := getUserAndWorkspace(r)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	documentID, err := parsePathUUID(r, "id")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid document id")
		return
	}
	assetID, err := parsePathUUID(r, "assetID")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid asset id")
		return
	}
	found, body, err := h.service.Open(r.Context(), workspaceID, documentID, assetID, userID)
	h.serve(w, found, body, err, "private")
}

func (h *AssetHandler) GetPublic(w http.ResponseWriter, r *http.Request) {
	assetID, err := uuid.Parse(r.PathValue("assetID"))
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid asset id")
		return
	}
	found, body, err := h.service.OpenPublic(r.Context(), r.PathValue("shareToken"), assetID)
	h.serve(w, found, body, err, "public")
}

func (h *AssetHandler) serve(w http.ResponseWriter, found asset.Asset, body io.ReadCloser, err error, cache string) {
	if err != nil {
		if errors.Is(err, asset.ErrNotFound) {
			response.Error(w, http.StatusNotFound, "asset not found")
			return
		}
		writeDocumentError(w, err)
		return
	}
	defer body.Close()
	header := w.Header()
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Content-Length", strconv.FormatInt(found.SizeBytes, 10))
	header.Set("Cache-Control", cache+", max-age=300")
	header.Set("Content-Security-Policy", "sandbox; default-src 'none'")
	if found.Inline {
		header.Set("Content-Type", found.ContentType)
		header.Set("Content-Disposition", "inline")
	} else {
		header.Set("Content-Type", "application/octet-stream")
		header.Set("Content-Disposition", attachment(found.FileName))
	}
	_, _ = io.Copy(w, body)
}

// BacklinkSource finds the pages that name a page.
type BacklinkSource interface {
	Backlinks(ctx context.Context, workspaceID, documentID, actorID uuid.UUID) ([]docrepo.Backlink, error)
}

type BacklinkHandler struct{ source BacklinkSource }

func NewBacklinkHandler(source BacklinkSource) *BacklinkHandler {
	return &BacklinkHandler{source: source}
}

func (h *BacklinkHandler) List(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, err := getUserAndWorkspace(r)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	documentID, err := parsePathUUID(r, "id")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid document id")
		return
	}
	links, err := h.source.Backlinks(r.Context(), workspaceID, documentID, userID)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, links)
}
