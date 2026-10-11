package netguard

import (
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestOnlyPublicHttpsBaseURLsPass(t *testing.T) {
	cases := []struct {
		url          string
		allowPrivate bool
		want         string
		ok           bool
	}{
		{"https://api.openai.com/v1", false, "https://api.openai.com/v1", true},
		{"https://api.openai.com/v1/", false, "https://api.openai.com/v1", true},
		{"https://openrouter.ai/api/v1", false, "https://openrouter.ai/api/v1", true},
		{"http://api.openai.com/v1", false, "", false},
		{"ftp://api.openai.com/v1", false, "", false},
		{"https://user:pass@api.openai.com/v1", false, "", false},
		{"https://api.openai.com/v1?x=1", false, "", false},
		{"https://", false, "", false},
		{"api.openai.com/v1", false, "", false},
		{"https://localhost/v1", false, "", false},
		{"https://127.0.0.1/v1", false, "", false},
		{"https://[::1]/v1", false, "", false},
		{"https://10.0.0.5/v1", false, "", false},
		{"https://192.168.1.10/v1", false, "", false},
		{"https://172.16.0.1/v1", false, "", false},
		{"https://169.254.169.254/latest", false, "", false},
		{"https://metadata.internal/v1", false, "", false},
		{"http://localhost:11434/v1", true, "http://localhost:11434/v1", true},
		{"https://10.0.0.5/v1", true, "https://10.0.0.5/v1", true},
		{"ftp://localhost/v1", true, "", false},
	}
	for _, c := range cases {
		got, err := ValidateBaseURL(c.url, c.allowPrivate)
		if (err == nil) != c.ok || got != c.want {
			t.Errorf("ValidateBaseURL(%q, %v) = %q, %v; want %q ok=%v", c.url, c.allowPrivate, got, err, c.want, c.ok)
		}
	}
}

func TestTheClientRefusesToConnectToAPrivateAddress(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("ok")) }))
	defer server.Close()
	if _, err := NewClient(time.Second, false).Get(server.URL); err == nil {
		t.Fatal("the guarded client reached a loopback server")
	}
	res, err := NewClient(time.Second, true).Get(server.URL)
	if err != nil {
		t.Fatalf("the open client could not reach a loopback server: %v", err)
	}
	_ = res.Body.Close()
}

func TestTheClientDoesNotFollowRedirects(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("secret")) }))
	defer target.Close()
	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusFound)
	}))
	defer redirector.Close()
	res, err := NewClient(time.Second, true).Get(redirector.URL)
	if err != nil {
		t.Fatalf("Get(): %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusFound {
		t.Fatalf("status = %d, want the redirect itself (302)", res.StatusCode)
	}
}

func TestPrivateAddressClassification(t *testing.T) {
	for ip, private := range map[string]bool{
		"127.0.0.1": true, "10.1.2.3": true, "192.168.0.1": true, "172.31.0.1": true, "169.254.169.254": true,
		"::1": true, "fe80::1": true, "fc00::1": true, "0.0.0.0": true,
		"8.8.8.8": false, "1.1.1.1": false, "2606:4700::1111": false,
	} {
		if got := isPrivate(net.ParseIP(ip)); got != private {
			t.Errorf("isPrivate(%s) = %v, want %v", ip, got, private)
		}
	}
}
