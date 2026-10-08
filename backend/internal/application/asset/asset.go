// Package asset holds the files people add to a page: images, video, PDFs and
// other files. The bytes live in a Store; what is known about them is in a
// Repository (ADR 0030).
package asset

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/google/uuid"
)

var (
	ErrTooLarge = errors.New("asset: file is too large")
	ErrNotFound = errors.New("asset: not found")
)

// Asset is what is known about one stored file.
type Asset struct {
	ID          uuid.UUID `json:"id"`
	DocumentID  uuid.UUID `json:"documentId"`
	WorkspaceID uuid.UUID `json:"workspaceId"`
	FileName    string    `json:"fileName"`
	ContentType string    `json:"contentType"`
	SizeBytes   int64     `json:"sizeBytes"`
	SHA256      string    `json:"sha256"`
	StoreKey    string    `json:"-"`
	CreatedAt   time.Time `json:"createdAt"`
	// Inline is true when the browser may show it in the page (image, video, PDF).
	Inline bool `json:"inline"`
	// URL is where the document reads it; the page keeps this.
	URL string `json:"url"`
}

// Store keeps the bytes. Keys are `workspaceID/documentID/assetID`.
type Store interface {
	Put(ctx context.Context, key string, body io.Reader) error
	Open(ctx context.Context, key string) (io.ReadCloser, error)
	// Delete removes a file; one that is not there is not an error.
	Delete(ctx context.Context, key string) error
}

// Repository knows the files and who may reach them.
type Repository interface {
	// Create records a file for a document the actor may edit.
	Create(ctx context.Context, asset Asset, actorID uuid.UUID) error
	// ForRead finds a file of a document the actor may read.
	ForRead(ctx context.Context, workspaceID, documentID, assetID, actorID uuid.UUID) (Asset, error)
	// ForPublicLink finds a file of the page a share token opens.
	ForPublicLink(ctx context.Context, shareToken string, assetID uuid.UUID) (Asset, error)
	// Orphans are files older than `olderThan` that no page or revision refers to.
	Orphans(ctx context.Context, olderThan time.Duration) ([]Asset, error)
	Remove(ctx context.Context, assetID uuid.UUID) error
}

// inlineTypes may be shown in the page; SVG is left out because it can carry script.
var inlineTypes = map[string]bool{
	"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true,
	"video/mp4": true, "video/webm": true, "application/pdf": true,
}

type Service struct {
	repository Repository
	store      Store
	maxBytes   int64
}

func NewService(repository Repository, store Store, maxBytes int64) *Service {
	return &Service{repository: repository, store: store, maxBytes: maxBytes}
}

func (s *Service) withURL(asset Asset) Asset {
	asset.URL = "/api/v1/documents/" + asset.DocumentID.String() + "/assets/" + asset.ID.String()
	asset.Inline = inlineTypes[asset.ContentType]
	return asset
}

// Upload stores a file for a document the actor may edit. The type is taken from
// the bytes, not from what the request says.
func (s *Service) Upload(ctx context.Context, workspaceID, documentID, actorID uuid.UUID, fileName string, body io.Reader) (Asset, error) {
	limited := io.LimitReader(body, s.maxBytes+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return Asset{}, err
	}
	if int64(len(data)) > s.maxBytes {
		return Asset{}, ErrTooLarge
	}
	contentType := detectType(data)
	id := uuid.New()
	asset := Asset{
		ID: id, DocumentID: documentID, WorkspaceID: workspaceID,
		FileName: cleanName(fileName), ContentType: contentType, SizeBytes: int64(len(data)),
		SHA256:   hashOf(data),
		StoreKey: workspaceID.String() + "/" + documentID.String() + "/" + id.String(),
	}
	// Record first: it checks that the actor may edit, before any bytes are kept.
	if err := s.repository.Create(ctx, asset, actorID); err != nil {
		return Asset{}, err
	}
	if err := s.store.Put(ctx, asset.StoreKey, bytes.NewReader(data)); err != nil {
		_ = s.repository.Remove(ctx, id)
		return Asset{}, err
	}
	return s.withURL(asset), nil
}

func (s *Service) Open(ctx context.Context, workspaceID, documentID, assetID, actorID uuid.UUID) (Asset, io.ReadCloser, error) {
	asset, err := s.repository.ForRead(ctx, workspaceID, documentID, assetID, actorID)
	if err != nil {
		return Asset{}, nil, err
	}
	return s.open(ctx, asset)
}

func (s *Service) OpenPublic(ctx context.Context, shareToken string, assetID uuid.UUID) (Asset, io.ReadCloser, error) {
	asset, err := s.repository.ForPublicLink(ctx, shareToken, assetID)
	if err != nil {
		return Asset{}, nil, err
	}
	return s.open(ctx, asset)
}

func (s *Service) open(ctx context.Context, asset Asset) (Asset, io.ReadCloser, error) {
	reader, err := s.store.Open(ctx, asset.StoreKey)
	if err != nil {
		return Asset{}, nil, ErrNotFound
	}
	return s.withURL(asset), reader, nil
}

// Sweep removes files older than `olderThan` that nothing refers to, and
// returns how many it removed.
func (s *Service) Sweep(ctx context.Context, olderThan time.Duration) (int, error) {
	orphans, err := s.repository.Orphans(ctx, olderThan)
	if err != nil {
		return 0, err
	}
	removed := 0
	for _, asset := range orphans {
		if err := s.repository.Remove(ctx, asset.ID); err != nil {
			return removed, err
		}
		_ = s.store.Delete(ctx, asset.StoreKey)
		removed++
	}
	return removed, nil
}

// detectType reads the type from the first bytes. Anything that is not media
// stays an opaque download.
func detectType(data []byte) string {
	head := data
	if len(head) > 512 {
		head = head[:512]
	}
	detected := strings.ToLower(strings.TrimSpace(strings.SplitN(http.DetectContentType(head), ";", 2)[0]))
	if inlineTypes[detected] {
		return detected
	}
	if bytes.HasPrefix(head, []byte("%PDF-")) {
		return "application/pdf"
	}
	if len(head) > 12 && string(head[4:8]) == "ftyp" {
		return "video/mp4"
	}
	return "application/octet-stream"
}

func cleanName(name string) string {
	base := path.Base(strings.ReplaceAll(name, "\\", "/"))
	base = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 || r == '"' {
			return -1
		}
		return r
	}, base)
	if base == "." || base == "/" || base == "" {
		return "file"
	}
	if len(base) > 200 {
		base = base[len(base)-200:]
	}
	return base
}
