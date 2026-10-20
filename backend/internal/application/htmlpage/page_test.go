package htmlpage

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"backend/constant"
	"backend/internal/application/collaboration"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

type fakeSource struct {
	doc     model.Document
	err     error
	reads   int
	lastUse uuid.UUID
}

func (f *fakeSource) GetDocument(_ context.Context, _, _, userID uuid.UUID) (model.Document, error) {
	f.reads++
	f.lastUse = userID
	return f.doc, f.err
}

const examplePage = `<!doctype html><html><head><meta name="dokudocs-capabilities" content="theme, download"><title>T</title></head><body><p>hi</p></body></html>`

type fakeAccess struct{ access collaboration.RoomAccess }

func (f fakeAccess) ReadPageAccess(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (collaboration.RoomAccess, error) {
	return f.access, nil
}

func newService(src Source) *Service {
	return NewService(src, fakeAccess{collaboration.RoomAccess{CanRead: true, CanEdit: true}}, NewSigner("secret", time.Minute), "https://usercontent.example.com", "https://app.example.com/")
}

func TestATokenNamesOneViewerAndOnePageAndExpires(t *testing.T) {
	signer := NewSigner("secret", time.Minute)
	now := time.Unix(1_000_000, 0)
	signer.SetNow(func() time.Time { return now })
	w, d, u := uuid.New(), uuid.New(), uuid.New()
	token, expires := signer.Issue(w, d, u)

	claims, err := signer.Verify(token)
	if err != nil || claims.WorkspaceID != w || claims.DocumentID != d || claims.UserID != u || !expires.Equal(now.Add(time.Minute)) {
		t.Fatalf("Verify = (%+v, %v)", claims, err)
	}

	now = now.Add(time.Minute + time.Second)
	if _, err := signer.Verify(token); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("expired token = %v, want ErrInvalidToken", err)
	}
}

func TestATokenFromAnotherKeyOrWithAChangedPayloadIsRefused(t *testing.T) {
	good, _ := NewSigner("secret", time.Minute).Issue(uuid.New(), uuid.New(), uuid.New())
	other, _ := NewSigner("another", time.Minute).Issue(uuid.New(), uuid.New(), uuid.New())
	payload, signature, _ := strings.Cut(good, ".")
	for name, token := range map[string]string{
		"other key":       other,
		"changed payload": "A" + payload[1:] + "." + signature,
		"no signature":    payload,
		"empty":           "",
		"login-looking":   "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig",
	} {
		if _, err := NewSigner("secret", time.Minute).Verify(token); !errors.Is(err, ErrInvalidToken) {
			t.Errorf("%s = %v, want ErrInvalidToken", name, err)
		}
	}
}

func TestIssueNeedsTheViewerToReadAnHTMLPageAndListsItsCapabilities(t *testing.T) {
	src := &fakeSource{doc: model.Document{Type: "html", Content: examplePage}}
	svc := newService(src)
	user := uuid.New()
	ticket, err := svc.Issue(context.Background(), uuid.New(), uuid.New(), user)
	if err != nil || src.lastUse != user {
		t.Fatalf("Issue = (%+v, %v), want a ticket read as the viewer", ticket, err)
	}
	if !strings.HasPrefix(ticket.URL, "https://usercontent.example.com/content/p/") || len(ticket.Capabilities) != 2 || !ticket.CanEdit || !ticket.CanComment {
		t.Fatalf("ticket = %+v", ticket)
	}

	src.err = constant.ErrDocumentNotFound
	if _, err := svc.Issue(context.Background(), uuid.New(), uuid.New(), user); !errors.Is(err, constant.ErrDocumentNotFound) {
		t.Fatalf("a viewer who cannot read the page got %v, want not found", err)
	}
	src.err, src.doc = nil, model.Document{Type: "markdown"}
	if _, err := svc.Issue(context.Background(), uuid.New(), uuid.New(), user); !errors.Is(err, ErrNotAPage) {
		t.Fatalf("a markdown document got %v, want ErrNotAPage", err)
	}
}

func TestRenderChecksTheViewersAccessAgainWhenTheFrameLoads(t *testing.T) {
	src := &fakeSource{doc: model.Document{Type: "html", Content: examplePage}}
	svc := newService(src)
	ticket, err := svc.Issue(context.Background(), uuid.New(), uuid.New(), uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	token := ticket.URL[strings.LastIndex(ticket.URL, "/")+1:]

	page, err := svc.Render(context.Background(), token)
	if err != nil || !strings.Contains(page.Body, "<p>hi</p>") || !strings.Contains(page.Body, "window.parent.postMessage") {
		t.Fatalf("Render = (%q, %v), want the page with the bridge", page.Body, err)
	}
	reads := src.reads

	// The viewer loses access after the ticket was issued.
	src.err = constant.ErrDocumentNotFound
	if _, err := svc.Render(context.Background(), token); !errors.Is(err, constant.ErrDocumentNotFound) {
		t.Fatalf("Render after access was lost = %v, want not found", err)
	}
	if src.reads != reads+1 {
		t.Fatalf("reads = %d, want the access checked again", src.reads)
	}
	if _, err := svc.Render(context.Background(), "forged.token"); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("forged token = %v, want ErrInvalidToken", err)
	}
}

func TestThePageIsClosedWithoutASeparateContentOrigin(t *testing.T) {
	src := &fakeSource{doc: model.Document{Type: "html", Content: examplePage}}
	for name, origin := range map[string]string{"none": "", "the application's own": "https://app.example.com"} {
		svc := NewService(src, fakeAccess{}, NewSigner("secret", time.Minute), origin, "https://app.example.com")
		if svc.Enabled() {
			t.Errorf("%s: enabled", name)
		}
		if _, err := svc.Issue(context.Background(), uuid.New(), uuid.New(), uuid.New()); !errors.Is(err, constant.ErrDocumentNotFound) {
			t.Errorf("%s: Issue = %v, want not found", name, err)
		}
		if _, err := svc.Render(context.Background(), "x.y"); !errors.Is(err, constant.ErrDocumentNotFound) {
			t.Errorf("%s: Render = %v, want not found", name, err)
		}
	}
}

func TestHeadersConfineThePage(t *testing.T) {
	h := ContentHeaders("https://app.example.com")
	csp := h["Content-Security-Policy"]
	for _, want := range []string{
		"sandbox allow-scripts;", "default-src 'none'", "connect-src 'none'", "form-action 'none'", "frame-src 'none'",
		"base-uri 'none'", "object-src 'none'", "worker-src 'none'", "img-src data:", "frame-ancestors https://app.example.com",
		"style-src 'unsafe-inline' https://fonts.googleapis.com",
	} {
		if !strings.Contains(csp, want) {
			t.Errorf("csp lacks %q: %s", want, csp)
		}
	}
	for _, banned := range []string{"allow-same-origin", "allow-top-navigation", "allow-popups", "allow-forms", "unsafe-eval", "script-src *", "http:"} {
		if strings.Contains(csp, banned) {
			t.Errorf("csp has %q: %s", banned, csp)
		}
	}
	if h["X-Content-Type-Options"] != "nosniff" || h["Referrer-Policy"] != "no-referrer" || h["Cache-Control"] != "no-store" {
		t.Errorf("headers = %v", h)
	}
}

func TestInjectKeepsTheDoctypeAndRunsFirst(t *testing.T) {
	origin := "https://app.example.com"
	cases := map[string]struct{ in, before string }{
		"with a head":    {`<!doctype html><html><head><title>x</title></head><body></body></html>`, "<title>"},
		"no head":        {`<!doctype html><html><body>x</body></html>`, "<body>"},
		"only a doctype": {`<!DOCTYPE html><p>x</p>`, "<p>"},
		"bare fragment":  {`<p>x</p>`, "<p>"},
	}
	for name, c := range cases {
		got := inject(c.in, []string{"theme"}, origin)
		script := strings.Index(got, "<script>")
		if script < 0 || script > strings.Index(got, c.before) {
			t.Errorf("%s: bridge not before %q: %.200s", name, c.before, got)
		}
		if strings.HasPrefix(strings.ToLower(c.in), "<!doctype") && !strings.HasPrefix(strings.ToLower(got), "<!doctype") {
			t.Errorf("%s: the doctype moved: %.80s", name, got)
		}
		if !strings.Contains(got, `["theme"]`) || !strings.Contains(got, `"https://app.example.com"`) {
			t.Errorf("%s: capabilities or app origin missing", name)
		}
	}
}

func TestOnlyDeclaredKnownCapabilitiesAreOn(t *testing.T) {
	cases := map[string][]string{
		`<meta name="dokudocs-capabilities" content="theme">`:                  {"theme"},
		`<meta name="Dokudocs-Capabilities" content="Download, THEME, theme">`: {"download", "theme"},
		`<meta name="dokudocs-capabilities" content="ask, state, viewer">`:     {},
		`<meta name="description" content="theme download">`:                   {},
		`<p>no declaration</p>`: {},
		``:                      {},
	}
	for page, want := range cases {
		got := DeclaredCapabilities(page)
		if strings.Join(got, ",") != strings.Join(want, ",") {
			t.Errorf("%q = %v, want %v", page, got, want)
		}
	}
}

// The browser tests in the frontend (page-sandbox.browser.test.ts) run hostile pages under
// this exact policy, read from testdata/content-csp.txt. A change to the policy must be a
// change to that file, so the tests below it follow. Regenerate it with UPDATE_GOLDEN=1.
func TestThePolicyTheBrowserTestsRunUnderIsTheOneServed(t *testing.T) {
	const path = "testdata/content-csp.txt"
	got := ContentHeaders("https://app.example.com")["Content-Security-Policy"] + "\n"
	if os.Getenv("UPDATE_GOLDEN") != "" {
		if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(want) != got {
		t.Fatalf("the served policy differs from %s; run the tests with UPDATE_GOLDEN=1 and rerun the frontend sandbox tests\n got: %s\nwant: %s", path, got, want)
	}
}
