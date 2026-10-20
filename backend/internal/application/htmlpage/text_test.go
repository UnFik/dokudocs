package htmlpage

import (
	"strings"
	"testing"
)

func TestExtractTextKeepsWhatAVisitorReads(t *testing.T) {
	page := `<!doctype html><html><head><title>Sales report</title><style>p{color:red}</style><script>var secret = "token"</script></head>
<body><h1>Q3   results</h1><p>Revenue grew <b>12%</b> over Q2.</p><script>alert('x')</script><noscript>enable js</noscript>
<svg><text>chart label</text></svg><ul><li>One</li><li>Two</li></ul><template><p>hidden</p></template></body></html>`
	got := ExtractText(page)
	for _, want := range []string{"Sales report", "Q3 results", "Revenue grew 12% over Q2.", "One", "Two"} {
		if !strings.Contains(got, want) {
			t.Errorf("text lacks %q:\n%s", want, got)
		}
	}
	for _, banned := range []string{"secret", "alert", "color:red", "enable js", "chart label", "hidden", "<"} {
		if strings.Contains(got, banned) {
			t.Errorf("text has %q:\n%s", banned, got)
		}
	}
	if !strings.HasPrefix(got, "Sales report\n\nQ3 results") {
		t.Errorf("title and headings not first:\n%s", got)
	}
}

func TestExtractTextSurvivesBrokenAndHostileMarkup(t *testing.T) {
	deep := strings.Repeat("<div>", 5000) + "deep words" + strings.Repeat("</div>", 5000)
	cases := map[string]string{
		"unclosed":        "<p>one<p>two<b>three",
		"script in text":  `<p>a</p><script>document.write("<p>injected</p>")</script>`,
		"event handler":   `<p onclick="steal()">visible</p>`,
		"deeply nested":   deep,
		"entities":        "<p>fish &amp; chips &lt;b&gt;</p>",
		"empty":           "",
		"not html at all": "just words",
	}
	for name, page := range cases {
		got := ExtractText(page)
		if strings.Contains(got, "injected") || strings.Contains(got, "steal") {
			t.Errorf("%s: leaked code: %q", name, got)
		}
	}
	if got := ExtractText(cases["deeply nested"]); !strings.Contains(got, "deep words") {
		t.Errorf("deeply nested text lost: %.80q", got)
	}
	if got := ExtractText(cases["entities"]); got != "fish & chips <b>" {
		t.Errorf("entities = %q", got)
	}
	if got := ExtractText(cases["unclosed"]); !strings.Contains(got, "one") || !strings.Contains(got, "three") {
		t.Errorf("unclosed = %q", got)
	}
}

func TestIndexJSONHoldsTheText(t *testing.T) {
	if got := string(IndexJSON("<p>hi</p>")); got != `{"text":"hi"}` {
		t.Fatalf("IndexJSON = %s", got)
	}
}
