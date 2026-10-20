package htmlpage

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"net/url"
	"regexp"
	"strings"
	"time"

	"backend/constant"
	"backend/internal/application/collaboration"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

//go:embed bootstrap.js
var bootstrap string

// ErrNotAPage means the document is not an HTML document.
var ErrNotAPage = errors.New("htmlpage: not an html document")

// Source reads a document under the viewer's own access: a viewer who cannot
// read it, or a trashed document, is not found.
type Source interface {
	GetDocument(ctx context.Context, id, workspaceID, userID uuid.UUID) (model.Document, error)
}

// Access says what a viewer may do with a page.
type Access interface {
	ReadPageAccess(ctx context.Context, workspaceID, documentID, userID uuid.UUID) (collaboration.RoomAccess, error)
}

// Service issues tickets to view a page and renders the page for the frame.
type Service struct {
	source        Source
	access        Access
	signer        *Signer
	contentOrigin string
	appOrigin     string
}

// NewService serves pages from contentOrigin (for example https://usercontent.example.com)
// to frames inside the application at appOrigin. With no content origin the feature is off.
func NewService(source Source, access Access, signer *Signer, contentOrigin, appOrigin string) *Service {
	return &Service{source: source, access: access, signer: signer, contentOrigin: strings.TrimRight(contentOrigin, "/"), appOrigin: originOf(appOrigin)}
}

func originOf(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

// Enabled says whether a content origin is configured, and is not the application's own:
// a page served from the application's origin would not be isolated from it.
func (s *Service) Enabled() bool {
	return s.contentOrigin != "" && s.appOrigin != "" && originOf(s.contentOrigin) != s.appOrigin
}

// ContentHost is the host the content origin answers on.
func (s *Service) ContentHost() string {
	u, err := url.Parse(s.contentOrigin)
	if err != nil {
		return ""
	}
	return u.Host
}

// Ticket is how the application opens a page in a frame.
type Ticket struct {
	URL          string    `json:"url"`
	ExpiresAt    time.Time `json:"expiresAt"`
	Capabilities []string  `json:"capabilities"`
	// CanEdit and CanComment say what the viewer may do beside reading, so the application
	// shows the right actions; the server still decides each one.
	CanEdit    bool `json:"canEdit"`
	CanComment bool `json:"canComment"`
}

func (s *Service) load(ctx context.Context, workspaceID, documentID, userID uuid.UUID) (model.Document, error) {
	doc, err := s.source.GetDocument(ctx, documentID, workspaceID, userID)
	if err != nil {
		return model.Document{}, err
	}
	if doc.Type != "html" {
		return model.Document{}, ErrNotAPage
	}
	return doc, nil
}

// Issue gives a viewer who can read the page a short-lived address for it.
func (s *Service) Issue(ctx context.Context, workspaceID, documentID, userID uuid.UUID) (Ticket, error) {
	if !s.Enabled() {
		return Ticket{}, constant.ErrDocumentNotFound
	}
	doc, err := s.load(ctx, workspaceID, documentID, userID)
	if err != nil {
		return Ticket{}, err
	}
	access, err := s.access.ReadPageAccess(ctx, workspaceID, documentID, userID)
	if err != nil {
		return Ticket{}, err
	}
	token, expires := s.signer.Issue(workspaceID, documentID, userID)
	return Ticket{
		URL: s.contentOrigin + "/content/p/" + token, ExpiresAt: expires, Capabilities: DeclaredCapabilities(doc.Content),
		CanEdit: access.CanEdit, CanComment: access.CanEdit || access.CanSuggest,
	}, nil
}

// Page is a response for the frame.
type Page struct {
	Body    string
	Headers map[string]string
}

// Render checks the token, checks again that the viewer can still read the page,
// and returns the page with its bridge script and the headers that confine it.
func (s *Service) Render(ctx context.Context, token string) (Page, error) {
	if !s.Enabled() {
		return Page{}, constant.ErrDocumentNotFound
	}
	claims, err := s.signer.Verify(token)
	if err != nil {
		return Page{}, err
	}
	doc, err := s.load(ctx, claims.WorkspaceID, claims.DocumentID, claims.UserID)
	if err != nil {
		return Page{}, err
	}
	return Page{Body: inject(doc.Content, DeclaredCapabilities(doc.Content), s.appOrigin), Headers: ContentHeaders(s.appOrigin)}, nil
}

// scriptHosts are the only places a page may load a script from.
var scriptHosts = []string{
	"https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net", "https://unpkg.com",
	"https://cdn.tailwindcss.com", "https://code.jquery.com",
}

// ContentHeaders confine the page: the sandbox gives it an opaque origin whatever
// address it is opened at, and nothing it loads or sends can leave except to a
// script CDN or the font host.
func ContentHeaders(appOrigin string) map[string]string {
	csp := strings.Join([]string{
		"sandbox allow-scripts",
		"default-src 'none'",
		"script-src 'unsafe-inline' " + strings.Join(scriptHosts, " "),
		"style-src 'unsafe-inline' https://fonts.googleapis.com",
		"font-src https://fonts.gstatic.com data:",
		"img-src data:",
		"connect-src 'none'",
		"form-action 'none'",
		"frame-src 'none'",
		"object-src 'none'",
		"worker-src 'none'",
		"manifest-src 'none'",
		"base-uri 'none'",
		"frame-ancestors " + appOrigin,
	}, "; ")
	return map[string]string{
		"Content-Type":            "text/html; charset=utf-8",
		"Content-Security-Policy": csp,
		"X-Content-Type-Options":  "nosniff",
		"Referrer-Policy":         "no-referrer",
		"Cache-Control":           "no-store",
	}
}

var (
	doctype = regexp.MustCompile(`(?is)^\s*(?:<!--.*?-->\s*)*<!doctype[^>]*>`)
	headTag = regexp.MustCompile(`(?i)<head(?:\s[^>]*)?>`)
	htmlTag = regexp.MustCompile(`(?i)<html(?:\s[^>]*)?>`)
)

// inject puts the bridge script where it runs first, without disturbing the doctype.
func inject(page string, capabilities []string, appOrigin string) string {
	caps, _ := json.Marshal(capabilities)
	origin, _ := json.Marshal(appOrigin)
	script := "<script>" + strings.NewReplacer("__CAPABILITIES__", string(caps), "__APP_ORIGIN__", string(origin)).Replace(bootstrap) + "</script>"
	if loc := headTag.FindStringIndex(page); loc != nil {
		return page[:loc[1]] + script + page[loc[1]:]
	}
	if loc := htmlTag.FindStringIndex(page); loc != nil {
		return page[:loc[1]] + script + page[loc[1]:]
	}
	if loc := doctype.FindStringIndex(page); loc != nil {
		return page[:loc[1]] + script + page[loc[1]:]
	}
	return script + page
}
