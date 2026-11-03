// Package pdfrender talks to the headless-browser service that prints a page to PDF.
package pdfrender

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	"backend/internal/application/pdfexport"
)

// Config says where the service is and how much it may be asked to do at once.
// An empty URL switches printing off.
type Config struct {
	URL         string
	Timeout     time.Duration
	Concurrency int
}

// Client sends pages to the service. It uses a plain HTTP client: the service
// sits on a private network, which the SSRF guard in netguard would refuse.
type Client struct {
	url     string
	http    *http.Client
	timeout time.Duration
	slots   chan struct{}
}

// New returns a client for the service at cfg.URL.
func New(cfg Config) *Client {
	slots := max(cfg.Concurrency, 1)
	return &Client{
		url:     strings.TrimRight(cfg.URL, "/"),
		http:    &http.Client{},
		timeout: cfg.Timeout,
		slots:   make(chan struct{}, slots),
	}
}

// A4 in inches, with 20 mm margins.
var paper = map[string]string{
	"paperWidth":      "8.27",
	"paperHeight":     "11.7",
	"marginTop":       "0.79",
	"marginBottom":    "0.79",
	"marginLeft":      "0.79",
	"marginRight":     "0.79",
	"printBackground": "true",
}

// Convert prints page, a complete HTML document, to a PDF. It does not queue: with
// every slot taken it answers pdfexport.ErrBusy at once.
func (c *Client) Convert(ctx context.Context, page []byte) ([]byte, error) {
	if c.url == "" {
		return nil, pdfexport.ErrUnavailable
	}
	select {
	case c.slots <- struct{}{}:
		defer func() { <-c.slots }()
	default:
		return nil, pdfexport.ErrBusy
	}
	if c.timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.timeout)
		defer cancel()
	}
	pdf, err := c.print(ctx, page)
	if err != nil && errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return nil, pdfexport.ErrTimeout
	}
	return pdf, err
}

func (c *Client) print(ctx context.Context, page []byte) ([]byte, error) {
	var form bytes.Buffer
	writer := multipart.NewWriter(&form)
	file, err := writer.CreateFormFile("files", "index.html")
	if err != nil {
		return nil, err
	}
	if _, err := file.Write(page); err != nil {
		return nil, err
	}
	for name, value := range paper {
		if err := writer.WriteField(name, value); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url+"/forms/chromium/convert/html", &form)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := c.http.Do(request)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", pdfexport.ErrUnavailable, err)
	}
	defer func() { _ = response.Body.Close() }()
	switch {
	case response.StatusCode == http.StatusOK:
		pdf, err := io.ReadAll(response.Body)
		if err != nil {
			return nil, fmt.Errorf("%w: %v", pdfexport.ErrUnavailable, err)
		}
		return pdf, nil
	case response.StatusCode >= 400 && response.StatusCode < 500 &&
		response.StatusCode != http.StatusRequestTimeout && response.StatusCode != http.StatusTooManyRequests:
		return nil, fmt.Errorf("%w: the service answered %d", pdfexport.ErrRefused, response.StatusCode)
	default:
		return nil, fmt.Errorf("%w: the service answered %d", pdfexport.ErrUnavailable, response.StatusCode)
	}
}
