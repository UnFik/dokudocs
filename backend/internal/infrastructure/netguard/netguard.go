// Package netguard keeps calls to an operator-chosen provider URL away from internal services.
package netguard

import (
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"syscall"
	"time"
)

var errPrivateAddress = errors.New("the address is private and not allowed")

// ValidateBaseURL returns the URL without a trailing slash. Only https is allowed, and
// private hosts only when allowPrivate is set (then http is allowed too).
func ValidateBaseURL(raw string, allowPrivate bool) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" || parsed.Hostname() == "" {
		return "", errors.New("the base URL is not valid")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("the base URL cannot hold credentials, a query or a fragment")
	}
	scheme := parsed.Scheme
	if scheme != "https" && !(allowPrivate && scheme == "http") {
		return "", errors.New("the base URL must start with https://")
	}
	if !allowPrivate && isPrivateHost(parsed.Hostname()) {
		return "", errors.New("the base URL points at a private address")
	}
	return strings.TrimRight(parsed.String(), "/"), nil
}

func isPrivateHost(host string) bool {
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") ||
		strings.HasSuffix(host, ".internal") || !strings.Contains(host, ".") && net.ParseIP(host) == nil {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return isPrivate(ip)
	}
	return false
}

func isPrivate(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsUnspecified() || ip.IsMulticast()
}

// NewClient returns an HTTP client that never follows redirects and, unless allowPrivate is
// set, refuses to connect to a private address even when a public name resolves to one.
func NewClient(timeout time.Duration, allowPrivate bool) *http.Client {
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	if !allowPrivate {
		dialer.Control = func(_, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			if ip := net.ParseIP(host); ip == nil || isPrivate(ip) {
				return errPrivateAddress
			}
			return nil
		}
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = dialer.DialContext
	transport.Proxy = nil
	return &http.Client{
		Timeout:       timeout,
		Transport:     transport,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}
