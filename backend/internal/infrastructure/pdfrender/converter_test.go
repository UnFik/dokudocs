package pdfrender_test

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"backend/internal/application/pdfexport"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/pdfrender"

	"github.com/google/uuid"
)

// These tests need the real PDF service. Set PDF_CONVERTER_TEST_URL to one started with the
// flags in docker-compose.yaml and on the host network, so that it can reach the
// listeners these tests open: that is what gives "no request arrived" its meaning.
// PDF_CONVERTER_TEST_UNPROTECTED_URL names a second one with default flags; it is the control
// that shows the listener does see requests when nothing stops the page.

func realClient(t *testing.T, variable string) *pdfrender.Client {
	t.Helper()
	url := os.Getenv(variable)
	if url == "" {
		t.Skipf("%s is not set", variable)
	}
	return pdfrender.New(pdfrender.Config{URL: url, Timeout: 60 * time.Second, Concurrency: 1})
}

type markdownDocuments struct{}

func (markdownDocuments) GetDocument(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (model.Document, error) {
	return model.Document{Type: "markdown"}, nil
}

// listener records every request that reaches it.
type listener struct {
	*httptest.Server
	mu   sync.Mutex
	seen []string
}

func newListener(t *testing.T) *listener {
	t.Helper()
	l := &listener{}
	l.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		l.mu.Lock()
		l.seen = append(l.seen, r.URL.Path)
		l.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(l.Close)
	return l
}

func (l *listener) requests() []string {
	time.Sleep(700 * time.Millisecond) // a request is made while the page is drawn
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.seen...)
}

// subresourcePage tries every way a page has of loading something from another address.
func subresourcePage(base string) string {
	return fmt.Sprintf(`<style>body{background:#fff}</style><h1>Quarterly plan</h1>
<img src="%[1]s/img">
<link rel="stylesheet" href="%[1]s/css">
<iframe src="%[1]s/frame"></iframe>
<script>new Image().src='%[1]s/script-image'; fetch('%[1]s/script-fetch'); navigator.sendBeacon('%[1]s/script-beacon')</script>
<img alt="inline" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==">`, base)
}

// refreshPage tries to send the page itself to another address. That is a navigation,
// which a page's policy does not stop, so it is the converter's flags that must.
func refreshPage(base string) string {
	return fmt.Sprintf(`<h1>Quarterly plan</h1><meta http-equiv="refresh" content="0;url=%s/refresh">`, base)
}

func TestTheRealConverterPrintsAPageWithAStyleAndADataImage(t *testing.T) {
	service := pdfexport.New(markdownDocuments{}, realClient(t, "PDF_CONVERTER_TEST_URL"))

	pdf, err := service.PDF(context.Background(), uuid.New(), uuid.New(), uuid.New(), pdfexport.Request{
		Title: "Plan",
		HTML:  `<style>h1{color:#123456}</style><h1>Hello</h1><img alt="dot" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==">`,
	})

	if err != nil {
		t.Fatalf("PDF() error = %v", err)
	}
	if !bytes.HasPrefix(pdf, []byte("%PDF-")) || len(pdf) < 1000 {
		t.Fatalf("not a PDF: %d bytes starting %q", len(pdf), pdf[:min(len(pdf), 12)])
	}
}

func TestAPageThatLoadsFromElsewhereStillPrintsAndMakesNoRequest(t *testing.T) {
	service := pdfexport.New(markdownDocuments{}, realClient(t, "PDF_CONVERTER_TEST_URL"))
	reached := newListener(t)

	pdf, err := service.PDF(context.Background(), uuid.New(), uuid.New(), uuid.New(), pdfexport.Request{
		Title: "Plan",
		HTML:  subresourcePage(reached.URL),
	})

	if err != nil {
		t.Fatalf("a page whose subresources are blocked must still print: %v", err)
	}
	if !bytes.HasPrefix(pdf, []byte("%PDF-")) {
		t.Fatalf("not a PDF: %q", pdf[:min(len(pdf), 12)])
	}
	if seen := reached.requests(); len(seen) != 0 {
		t.Fatalf("the page reached the listener: %v", seen)
	}
}

// Whether the converter prints or refuses a page that tries to navigate away depends
// on which comes first, the blocked navigation or the print, so either answer is fine.
// What must hold is that nothing reaches the address.
func TestAPageThatNavigatesAwayReachesNothing(t *testing.T) {
	service := pdfexport.New(markdownDocuments{}, realClient(t, "PDF_CONVERTER_TEST_URL"))
	reached := newListener(t)

	_, _ = service.PDF(context.Background(), uuid.New(), uuid.New(), uuid.New(), pdfexport.Request{
		Title: "Plan",
		HTML:  refreshPage(reached.URL),
	})

	if seen := reached.requests(); len(seen) != 0 {
		t.Fatalf("the page navigated to the listener: %v", seen)
	}
}

// Without this, the two tests above would pass just as well if the listener could not be
// reached by the service at all. Here nothing stops the page, so it must be seen.
func TestTheListenerDoesSeeAPageThatNothingStops(t *testing.T) {
	unprotected := os.Getenv("PDF_CONVERTER_TEST_UNPROTECTED_URL")
	if unprotected == "" {
		t.Skip("PDF_CONVERTER_TEST_UNPROTECTED_URL is not set")
	}
	reached := newListener(t)
	var form bytes.Buffer
	writer := multipart.NewWriter(&form)
	file, _ := writer.CreateFormFile("files", "index.html")
	_, _ = file.Write([]byte("<!doctype html><html><body>" + subresourcePage(reached.URL) + refreshPage(reached.URL) + "</body></html>"))
	_ = writer.Close()
	request, _ := http.NewRequest(http.MethodPost, strings.TrimRight(unprotected, "/")+"/forms/chromium/convert/html", &form)
	request.Header.Set("Content-Type", writer.FormDataContentType())

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("the unprotected service: %v", err)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	_ = response.Body.Close()

	if seen := reached.requests(); len(seen) == 0 {
		t.Fatal("the control page reached nothing, so the test above proves nothing")
	} else {
		t.Logf("the unprotected service made %d requests: %v", len(seen), seen)
	}
}
