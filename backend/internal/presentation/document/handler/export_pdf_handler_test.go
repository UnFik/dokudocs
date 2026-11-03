package handler

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"backend/constant"
	authdto "backend/internal/application/auth/dto"
	"backend/internal/application/pdfexport"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/pdfrender"
	"backend/internal/presentation/middleware"

	"github.com/google/uuid"
)

const fakePDF = "%PDF-1.7 fake"

// converterFake stands in for the PDF service: it records what it was sent.
type converterFake struct {
	*httptest.Server
	mu      sync.Mutex
	calls   int
	page    string
	fields  map[string]string
	respond func(w http.ResponseWriter)
}

func newConverterFake(t *testing.T) *converterFake {
	t.Helper()
	c := &converterFake{fields: map[string]string{}}
	c.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c.mu.Lock()
		c.calls++
		c.mu.Unlock()
		if err := r.ParseMultipartForm(32 << 20); err == nil {
			for name, values := range r.MultipartForm.Value {
				c.fields[name] = values[0]
			}
			for _, files := range r.MultipartForm.File {
				for _, header := range files {
					if header.Filename != "index.html" {
						continue
					}
					file, _ := header.Open()
					body, _ := io.ReadAll(file)
					c.page = string(body)
				}
			}
		}
		if c.respond != nil {
			c.respond(w)
			return
		}
		w.Header().Set("Content-Type", "application/pdf")
		_, _ = w.Write([]byte(fakePDF))
	}))
	t.Cleanup(c.Server.Close)
	return c
}

func (c *converterFake) called() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.calls
}

type pdfDocumentsFake struct {
	doc model.Document
	err error
}

func (f *pdfDocumentsFake) GetDocument(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (model.Document, error) {
	return f.doc, f.err
}

func newExportPDFHandler(converterURL string, docs *pdfDocumentsFake) *ExportPDFHandler {
	renderer := pdfrender.New(pdfrender.Config{URL: converterURL, Timeout: 5 * time.Second, Concurrency: 2})
	return NewExportPDFHandler(pdfexport.New(docs, renderer), 1<<20, 30*time.Second)
}

func postPDF(t *testing.T, h *ExportPDFHandler, body string) *httptest.ResponseRecorder {
	t.Helper()
	documentID := uuid.New()
	r := httptest.NewRequest(http.MethodPost, "/documents/"+documentID.String()+"/export/pdf", strings.NewReader(body))
	r.SetPathValue("id", documentID.String())
	r.Header.Set("X-Workspace-Id", uuid.NewString())
	r = r.WithContext(middleware.ContextWithUser(r.Context(), authdto.ResponseUser{ID: uuid.NewString()}))
	rr := httptest.NewRecorder()
	middleware.RequireWorkspace(documentErrorWorkspaceStub{})(http.HandlerFunc(h.PDF)).ServeHTTP(rr, r)
	return rr
}

func TestExportPDFGivesAReaderTheConvertersPDF(t *testing.T) {
	converter := newConverterFake(t)
	h := newExportPDFHandler(converter.URL, &pdfDocumentsFake{doc: model.Document{Type: "markdown"}})

	rr := postPDF(t, h, `{"title":"Runbook","html":"<h1>Hello</h1>"}`)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", rr.Code, rr.Body.String())
	}
	if got := rr.Header().Get("Content-Type"); got != "application/pdf" {
		t.Fatalf("Content-Type = %q, want application/pdf", got)
	}
	if got := rr.Header().Get("Content-Disposition"); !strings.HasPrefix(got, "attachment") {
		t.Fatalf("Content-Disposition = %q, want an attachment", got)
	}
	if rr.Body.String() != fakePDF {
		t.Fatalf("body = %q, want the converter's PDF", rr.Body.String())
	}
	if !strings.Contains(converter.page, "<h1>Hello</h1>") {
		t.Fatalf("the converter was not sent the document's HTML: %q", converter.page)
	}
	if converter.fields["paperWidth"] != "8.27" || converter.fields["paperHeight"] != "11.7" {
		t.Fatalf("paper = %sx%s, want A4 in inches", converter.fields["paperWidth"], converter.fields["paperHeight"])
	}
}

func TestExportPDFRendersNothingForSomeoneWhoCannotReadTheDocument(t *testing.T) {
	for name, tc := range map[string]struct {
		err  error
		want int
	}{
		"forbidden": {constant.ErrForbidden, http.StatusForbidden},
		"not found": {constant.ErrDocumentNotFound, http.StatusNotFound},
	} {
		t.Run(name, func(t *testing.T) {
			converter := newConverterFake(t)
			h := newExportPDFHandler(converter.URL, &pdfDocumentsFake{err: tc.err})

			rr := postPDF(t, h, `{"title":"Runbook","html":"<p>secret</p>"}`)

			if rr.Code != tc.want {
				t.Fatalf("status = %d, want %d", rr.Code, tc.want)
			}
			if converter.called() != 0 {
				t.Fatalf("the converter was called %d times for a caller with no access", converter.called())
			}
		})
	}
}

func TestExportPDFOnlyPrintsMarkdownDocuments(t *testing.T) {
	for _, kind := range []string{"mermaid", "dbdiagram", "architecture", "html"} {
		t.Run(kind, func(t *testing.T) {
			converter := newConverterFake(t)
			h := newExportPDFHandler(converter.URL, &pdfDocumentsFake{doc: model.Document{Type: kind}})

			rr := postPDF(t, h, `{"title":"x","html":"<p>x</p>"}`)

			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", rr.Code)
			}
			if converter.called() != 0 {
				t.Fatal("the converter was called for a document that is not Markdown")
			}
		})
	}
}

func TestExportPDFRefusesABodyThatIsNotTheExpectedJSON(t *testing.T) {
	converter := newConverterFake(t)
	h := newExportPDFHandler(converter.URL, &pdfDocumentsFake{doc: model.Document{Type: "markdown"}})

	for _, body := range []string{``, `not json`, `{"title":1,"html":2}`} {
		if rr := postPDF(t, h, body); rr.Code != http.StatusBadRequest {
			t.Fatalf("body %q: status = %d, want 400", body, rr.Code)
		}
	}
	if converter.called() != 0 {
		t.Fatal("the converter was called for a malformed request")
	}
}

func TestExportPDFRefusesABodyOverTheLimitWithoutPrinting(t *testing.T) {
	converter := newConverterFake(t)
	h := newExportPDFHandler(converter.URL, &pdfDocumentsFake{doc: model.Document{Type: "markdown"}})
	body := `{"title":"big","html":"` + strings.Repeat("a", 2<<20) + `"}`

	rr := postPDF(t, h, body)

	assertFailure(t, rr, http.StatusRequestEntityTooLarge, "limit is 1 MB")
	if converter.called() != 0 {
		t.Fatal("the converter was called for a body over the limit")
	}
}

func TestExportPDFPrintsThePageUnderThePolicyOfTheServerWhateverTheBrowserSent(t *testing.T) {
	converter := newConverterFake(t)
	h := newExportPDFHandler(converter.URL, &pdfDocumentsFake{doc: model.Document{Type: "markdown"}})
	hostile := `<meta http-equiv=\"Content-Security-Policy\" content=\"default-src *\"><script>fetch('http://internal')</script><img src=\"http://internal/x\">`

	rr := postPDF(t, h, `{"title":"A <b>title</b>","html":"`+hostile+`"}`)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", rr.Code, rr.Body.String())
	}
	const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'">`
	if !strings.HasPrefix(converter.page, "<!doctype html><html><head>"+policy) {
		t.Fatalf("the page does not open with the server's policy: %.200q", converter.page)
	}
	if strings.Contains(converter.page, "<title>A <b>") {
		t.Fatal("the title was not escaped")
	}
}

func newExportPDFHandlerWith(cfg pdfrender.Config) *ExportPDFHandler {
	docs := &pdfDocumentsFake{doc: model.Document{Type: "markdown"}}
	return NewExportPDFHandler(pdfexport.New(docs, pdfrender.New(cfg)), 1<<20, 30*time.Second)
}

func TestExportPDFSaysWhyThePDFServiceCouldNotPrint(t *testing.T) {
	const page = `{"title":"x","html":"<p>x</p>"}`
	cfg := func(url string) pdfrender.Config {
		return pdfrender.Config{URL: url, Timeout: 5 * time.Second, Concurrency: 2}
	}
	t.Run("it is switched off", func(t *testing.T) {
		rr := postPDF(t, newExportPDFHandlerWith(cfg("")), page)
		assertFailure(t, rr, http.StatusServiceUnavailable, "unavailable")
	})
	t.Run("it cannot be reached", func(t *testing.T) {
		converter := newConverterFake(t)
		converter.Close()
		rr := postPDF(t, newExportPDFHandlerWith(cfg(converter.URL)), page)
		assertFailure(t, rr, http.StatusServiceUnavailable, "unavailable")
	})
	t.Run("it fails", func(t *testing.T) {
		converter := newConverterFake(t)
		converter.respond = func(w http.ResponseWriter) { w.WriteHeader(http.StatusInternalServerError) }
		rr := postPDF(t, newExportPDFHandlerWith(cfg(converter.URL)), page)
		assertFailure(t, rr, http.StatusServiceUnavailable, "unavailable")
	})
	t.Run("it refuses the page", func(t *testing.T) {
		converter := newConverterFake(t)
		converter.respond = func(w http.ResponseWriter) { w.WriteHeader(http.StatusBadRequest) }
		rr := postPDF(t, newExportPDFHandlerWith(cfg(converter.URL)), page)
		assertFailure(t, rr, http.StatusBadGateway, "could not be printed")
	})
	t.Run("it takes longer than the limit", func(t *testing.T) {
		converter := newConverterFake(t)
		converter.respond = func(w http.ResponseWriter) { time.Sleep(400 * time.Millisecond) }
		slow := cfg(converter.URL)
		slow.Timeout = 50 * time.Millisecond
		rr := postPDF(t, newExportPDFHandlerWith(slow), page)
		assertFailure(t, rr, http.StatusGatewayTimeout, "too long")
	})
}

func TestExportPDFAnswersBusyInsteadOfQueueingBehindTheLimit(t *testing.T) {
	const page = `{"title":"x","html":"<p>x</p>"}`
	converter := newConverterFake(t)
	started, release := make(chan struct{}), make(chan struct{})
	converter.respond = func(w http.ResponseWriter) {
		started <- struct{}{}
		<-release
		_, _ = w.Write([]byte(fakePDF))
	}
	h := newExportPDFHandlerWith(pdfrender.Config{URL: converter.URL, Timeout: 5 * time.Second, Concurrency: 1})

	first := make(chan *httptest.ResponseRecorder, 1)
	go func() { first <- postPDF(t, h, page) }()
	<-started

	assertFailure(t, postPDF(t, h, page), http.StatusServiceUnavailable, "busy")

	release <- struct{}{}
	if rr := <-first; rr.Code != http.StatusOK {
		t.Fatalf("the print that was running: status = %d, want 200", rr.Code)
	}
}

func assertFailure(t *testing.T, rr *httptest.ResponseRecorder, status int, message string) {
	t.Helper()
	if rr.Code != status {
		t.Fatalf("status = %d, want %d; body: %s", rr.Code, status, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), message) {
		t.Fatalf("body %q does not say %q", rr.Body.String(), message)
	}
}

func TestExportPDFLogsTheSizeTimeAndOutcomeButNeverTheDocument(t *testing.T) {
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })
	converter := newConverterFake(t)
	h := newExportPDFHandler(converter.URL, &pdfDocumentsFake{doc: model.Document{Type: "markdown"}})

	rr := postPDF(t, h, `{"title":"Quarterly secrets","html":"<p>the launch date is classified</p>"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}

	line := logs.String()
	for _, want := range []string{`"msg":"pdf export"`, `"outcome":"printed"`, `"bytes":`, `"duration_ms":`} {
		if !strings.Contains(line, want) {
			t.Fatalf("the log does not hold %s: %s", want, line)
		}
	}
	for _, secret := range []string{"Quarterly secrets", "classified", "<p>"} {
		if strings.Contains(line, secret) {
			t.Fatalf("the log holds the document (%q): %s", secret, line)
		}
	}
}

// deadlineWriter records the deadlines a handler asks of the connection.
type deadlineWriter struct {
	*httptest.ResponseRecorder
	read, write time.Time
}

func (w *deadlineWriter) SetReadDeadline(t time.Time) error  { w.read = t; return nil }
func (w *deadlineWriter) SetWriteDeadline(t time.Time) error { w.write = t; return nil }

func TestExportPDFGivesItselfTimeToReceiveAPageAndToPrintItOnAServerWithShortDeadlines(t *testing.T) {
	converter := newConverterFake(t)
	h := newExportPDFHandler(converter.URL, &pdfDocumentsFake{doc: model.Document{Type: "markdown"}})
	documentID := uuid.New()
	r := httptest.NewRequest(http.MethodPost, "/documents/"+documentID.String()+"/export/pdf", strings.NewReader(`{"title":"x","html":"<p>x</p>"}`))
	r.SetPathValue("id", documentID.String())
	r.Header.Set("X-Workspace-Id", uuid.NewString())
	r = r.WithContext(middleware.ContextWithUser(r.Context(), authdto.ResponseUser{ID: uuid.NewString()}))
	w := &deadlineWriter{ResponseRecorder: httptest.NewRecorder()}
	before := time.Now()

	middleware.RequireWorkspace(documentErrorWorkspaceStub{})(http.HandlerFunc(h.PDF)).ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if w.read.Before(before.Add(30 * time.Second)) {
		t.Fatalf("the read deadline %v leaves no time to receive a large page", w.read.Sub(before))
	}
	if w.write.Before(before.Add(30 * time.Second)) {
		t.Fatalf("the write deadline %v leaves no time to print", w.write.Sub(before))
	}
}
