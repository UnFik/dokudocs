package htmlpage

import (
	"slices"
	"strings"

	"golang.org/x/net/html"
)

// Capabilities a page may ask for. A page declares them in
// <meta name="dokudocs-capabilities" content="theme, download">; one it did
// not declare is off, and one this version does not have is ignored.
const (
	CapabilityTheme    = "theme"
	CapabilityDownload = "download"
)

var supported = []string{CapabilityTheme, CapabilityDownload}

// DeclaredCapabilities reads what a page declares, without running it.
func DeclaredCapabilities(page string) []string {
	root, err := html.Parse(strings.NewReader(page))
	if err != nil {
		return []string{}
	}
	declared := []string{}
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "meta" {
			var name, content string
			for _, attr := range n.Attr {
				switch strings.ToLower(attr.Key) {
				case "name":
					name = strings.ToLower(strings.TrimSpace(attr.Val))
				case "content":
					content = attr.Val
				}
			}
			if name == "dokudocs-capabilities" {
				for _, item := range strings.FieldsFunc(content, func(r rune) bool { return r == ',' || r == ' ' || r == ';' }) {
					item = strings.ToLower(item)
					if slices.Contains(supported, item) && !slices.Contains(declared, item) {
						declared = append(declared, item)
					}
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(root)
	slices.Sort(declared)
	return declared
}
